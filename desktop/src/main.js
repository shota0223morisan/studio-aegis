// Studio Aegis — Mac app.
//
// Everything runs on this Mac: a small local server (127.0.0.1 only) keeps projects in SQLite and
// files on disk under ~/Library/Application Support/Studio Aegis/data, and serves the UI.
// The window also shows Splice in a side panel (splice.com refuses iframes, but a separate web
// view is a normal top-level page).
const { app, BaseWindow, WebContentsView, Menu, shell, ipcMain, nativeTheme, dialog, session } = require("electron");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { openDatabase } = require("./server/db");
const { createServer } = require("./server/server");

const PORT = Number(process.env.AEGIS_PORT) || 47823; // fixed: the Spotify redirect URI includes it
const ORIGIN = `http://127.0.0.1:${PORT}`;
const PRELOAD = path.join(__dirname, "preload.js");
const RELEASES_API = "https://api.github.com/repos/shota0223morisan/studio-aegis/releases/latest";
const SPLICE_HOST = /(^|\.)splice\.com$/;
// OAuth / login pages that must stay inside the window so the redirect back to the app works.
const AUTH_HOSTS = /(^|\.)(spotify\.com|google\.com|apple\.com|facebook\.com|splice\.com)$/;

const dataDir = () => path.join(app.getPath("userData"), "data");
const webDir = () => (app.isPackaged ? path.join(process.resourcesPath, "web") : path.join(__dirname, "../../web/dist"));

let store = null;

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function openExternal(url) {
  if (/^https?:\/\//.test(url)) void shell.openExternal(url);
}

// ---- Window state ------------------------------------------------------------

const statePath = () => path.join(app.getPath("userData"), "window-state.json");

function readBounds() {
  try {
    return JSON.parse(fs.readFileSync(statePath(), "utf8"));
  } catch {
    return undefined;
  }
}

// ---- Window & views --------------------------------------------------------

let win = null;
let appView = null;
let spliceView = null;
let spliceOpen = false;
const SPLICE_RATIO = 0.42;
const SPLICE_MIN = 380;

function layout() {
  if (!win || !appView) return;
  const { width, height } = win.getContentBounds();
  if (spliceOpen && spliceView) {
    const panel = Math.min(width - 420, Math.max(SPLICE_MIN, Math.round(width * SPLICE_RATIO)));
    appView.setBounds({ x: 0, y: 0, width: width - panel, height });
    spliceView.setBounds({ x: width - panel, y: 0, width: panel, height });
  } else {
    appView.setBounds({ x: 0, y: 0, width, height });
  }
}

function addContextMenu(contents) {
  contents.on("context-menu", (_e, params) => {
    const items = [];
    if (params.isEditable) items.push({ role: "cut" }, { role: "copy" }, { role: "paste" }, { type: "separator" }, { role: "selectAll" });
    else if (params.selectionText) items.push({ role: "copy" });
    if (params.linkURL) items.push({ label: "リンクをブラウザで開く", click: () => openExternal(params.linkURL) });
    if (items.length) Menu.buildFromTemplate(items).popup();
  });
}

const loadApp = () => void appView?.webContents.loadURL(`${ORIGIN}/`);

function createAppView() {
  const view = new WebContentsView({
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true },
  });
  view.setBackgroundColor(nativeTheme.shouldUseDarkColors ? "#111214" : "#f6f5f2");
  const contents = view.webContents;

  // Stay inside the app for its own pages and OAuth round-trips; everything else → browser.
  // (Also stops a file dropped outside a drop zone from replacing the page.)
  contents.on("will-navigate", (e, url) => {
    if (url.startsWith(`${ORIGIN}/`) || AUTH_HOSTS.test(hostOf(url))) return;
    e.preventDefault();
    openExternal(url);
  });

  contents.setWindowOpenHandler(({ url }) => {
    if (SPLICE_HOST.test(hostOf(url))) openSplice(url);
    else openExternal(url);
    return { action: "deny" };
  });

  addContextMenu(contents);
  return view;
}

function ensureSpliceView() {
  if (spliceView) return spliceView;
  spliceView = new WebContentsView({
    // Own persistent session so the Splice login is remembered across launches.
    webPreferences: { partition: "persist:splice", contextIsolation: true, sandbox: true },
  });
  const contents = spliceView.webContents;
  contents.on("will-navigate", (e, url) => {
    if (!AUTH_HOSTS.test(hostOf(url))) {
      e.preventDefault();
      openExternal(url);
    }
  });
  // Allow login popups (Google / Apple sign-in) as real windows; other popups → browser.
  contents.setWindowOpenHandler(({ url }) => {
    if (AUTH_HOSTS.test(hostOf(url))) return { action: "allow" };
    openExternal(url);
    return { action: "deny" };
  });
  addContextMenu(contents);
  return spliceView;
}

function notifySplice() {
  appView?.webContents.send("splice-panel", spliceOpen);
  buildMenu();
}

function openSplice(url) {
  if (!win) return;
  const view = ensureSpliceView();
  if (!spliceOpen) {
    win.contentView.addChildView(view);
    spliceOpen = true;
  }
  const current = view.webContents.getURL();
  if (url && url !== current) void view.webContents.loadURL(url);
  else if (!current) void view.webContents.loadURL("https://splice.com/");
  layout();
  notifySplice();
}

function closeSplice() {
  if (!win || !spliceView || !spliceOpen) return;
  win.contentView.removeChildView(spliceView);
  spliceOpen = false;
  layout();
  notifySplice();
}

function createWindow() {
  const bounds = readBounds();
  win = new BaseWindow({
    width: bounds?.width ?? 1360,
    height: bounds?.height ?? 900,
    x: bounds?.x,
    y: bounds?.y,
    minWidth: 900,
    minHeight: 600,
    title: "Studio Aegis",
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#111214" : "#f6f5f2",
  });
  appView = createAppView();
  win.contentView.addChildView(appView);
  layout();
  win.on("resize", layout);
  win.on("close", () => fs.writeFileSync(statePath(), JSON.stringify(win.getBounds())));
  win.on("closed", () => {
    win = null;
    appView = null;
    spliceView = null;
    spliceOpen = false;
  });
  loadApp();
}

// ---- Data folder, backup, updates -------------------------------------------

async function exportBackup() {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: "バックアップの保存先を選択",
    buttonLabel: "ここに保存",
    properties: ["openDirectory", "createDirectory"],
  });
  if (canceled || !filePaths[0]) return { ok: false };
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ").replace(":", "");
  const dest = path.join(filePaths[0], `Studio Aegis バックアップ ${stamp}`);
  fs.mkdirSync(dest, { recursive: true });
  // VACUUM INTO writes a consistent snapshot even while the database is open.
  store.db.prepare("VACUUM INTO ?").run(path.join(dest, "aegis.db"));
  fs.cpSync(store.filesDir, path.join(dest, "files"), { recursive: true });
  shell.showItemInFolder(dest);
  return { ok: true, path: dest };
}

function newerThan(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
}

async function checkForUpdate() {
  try {
    const res = await fetch(RELEASES_API, { headers: { Accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { current: app.getVersion(), latest: null, available: false };
    const release = await res.json();
    const latest = String(release.tag_name ?? "").replace(/^desktop-v/, "");
    return { current: app.getVersion(), latest, available: newerThan(latest, app.getVersion()), url: release.html_url };
  } catch {
    return { current: app.getVersion(), latest: null, available: false };
  }
}

async function checkForUpdateFromMenu() {
  const r = await checkForUpdate();
  if (r.available) {
    const { response } = await dialog.showMessageBox({
      message: `新しいバージョン ${r.latest} があります`,
      detail: `いまのバージョン: ${r.current}\nダウンロードページで dmg を入れ直すと更新できます(データはそのまま残ります)。`,
      buttons: ["ダウンロードページを開く", "あとで"],
    });
    if (response === 0) openExternal(r.url);
  } else {
    await dialog.showMessageBox({ message: r.latest ? "最新バージョンです" : "更新を確認できませんでした", detail: `バージョン ${r.current}` });
  }
}

// ---- IPC from the web UI ---------------------------------------------------

ipcMain.handle("splice:open", (_e, url) => {
  if (typeof url !== "string") return;
  if (SPLICE_HOST.test(hostOf(url))) openSplice(url);
  else openExternal(url);
});
ipcMain.handle("splice:close", () => closeSplice());
ipcMain.handle("splice:state", () => spliceOpen);
ipcMain.handle("app:info", () => ({ version: app.getVersion(), dataDir: dataDir() }));
ipcMain.handle("app:openDataFolder", () => shell.openPath(dataDir()));
ipcMain.handle("app:exportBackup", () => exportBackup());
ipcMain.handle("app:checkForUpdate", () => checkForUpdate());
ipcMain.handle("app:openExternal", (_e, url) => openExternal(String(url)));

// ---- Menu ------------------------------------------------------------------

function focusedContents() {
  if (spliceOpen && spliceView?.webContents.isFocused()) return spliceView.webContents;
  return appView?.webContents;
}

function buildMenu() {
  const isMac = process.platform === "darwin";
  const template = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about", label: "Studio Aegis について" },
              { label: "アップデートを確認…", click: () => void checkForUpdateFromMenu() },
              { type: "separator" },
              { role: "hide", label: "Studio Aegis を隠す" },
              { role: "hideOthers", label: "ほかを隠す" },
              { role: "unhide", label: "すべてを表示" },
              { type: "separator" },
              { role: "quit", label: "Studio Aegis を終了" },
            ],
          },
        ]
      : []),
    {
      label: "ファイル",
      submenu: [
        { label: "データフォルダを Finder で開く", click: () => void shell.openPath(dataDir()) },
        { label: "バックアップを書き出す…", click: () => void exportBackup() },
      ],
    },
    {
      label: "編集",
      submenu: [
        { role: "undo", label: "取り消す" },
        { role: "redo", label: "やり直す" },
        { type: "separator" },
        { role: "cut", label: "カット" },
        { role: "copy", label: "コピー" },
        { role: "paste", label: "ペースト" },
        { role: "selectAll", label: "すべてを選択" },
      ],
    },
    {
      label: "表示",
      submenu: [
        { label: "再読み込み", accelerator: "CmdOrCtrl+R", click: () => focusedContents()?.reload() },
        { label: "案件一覧に戻る", accelerator: "CmdOrCtrl+Shift+H", click: loadApp },
        { type: "separator" },
        { label: "戻る", accelerator: "CmdOrCtrl+[", click: () => focusedContents()?.navigationHistory.goBack() },
        { label: "進む", accelerator: "CmdOrCtrl+]", click: () => focusedContents()?.navigationHistory.goForward() },
        { type: "separator" },
        { role: "resetZoom", label: "実際のサイズ" },
        { role: "zoomIn", label: "拡大" },
        { role: "zoomOut", label: "縮小" },
        { type: "separator" },
        { role: "togglefullscreen", label: "フルスクリーン" },
        { label: "開発者ツール", accelerator: "Alt+CmdOrCtrl+I", click: () => focusedContents()?.toggleDevTools() },
      ],
    },
    {
      label: "Splice",
      submenu: [
        {
          label: spliceOpen ? "Splice パネルを閉じる" : "Splice パネルを開く",
          accelerator: "CmdOrCtrl+Shift+S",
          click: () => (spliceOpen ? closeSplice() : openSplice()),
        },
        { label: "Splice をブラウザで開く", click: () => openExternal(spliceView?.webContents.getURL() || "https://splice.com/") },
      ],
    },
    { role: "windowMenu", label: "ウィンドウ" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---- Lifecycle -------------------------------------------------------------

async function start() {
  app.setAboutPanelOptions({ applicationName: "Studio Aegis", applicationVersion: app.getVersion() });
  store = openDatabase(dataDir());

  // Per-launch secret: only this app's window carries it, so other apps / browsers can't use the API.
  const sessionToken = crypto.randomBytes(32).toString("hex");
  try {
    await createServer({ store, webDir: webDir(), port: PORT, sessionToken });
  } catch (err) {
    dialog.showErrorBox(
      "Studio Aegis を起動できません",
      err?.code === "EADDRINUSE" ? `ポート ${PORT} がほかのアプリに使われています。そのアプリを終了してから開き直してください。` : String(err),
    );
    app.quit();
    return;
  }
  // Lax (not Strict) so the cookie survives the redirect back from Spotify's login page.
  await session.defaultSession.cookies.set({ url: ORIGIN, name: "aegis_session", value: sessionToken, httpOnly: true, sameSite: "lax" });

  buildMenu();
  createWindow();
  app.on("activate", () => {
    if (!win) createWindow();
  });

  // Quiet update check shortly after launch; the UI shows a banner if there's a newer dmg.
  setTimeout(async () => {
    const r = await checkForUpdate();
    if (r.available) appView?.webContents.send("update-available", r);
  }, 5000);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!win) return createWindow();
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  app.whenReady().then(start);
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
