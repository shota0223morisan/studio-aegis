// Studio Aegis — Mac app.
//
// Everything runs on this Mac: a small local server (127.0.0.1 only) keeps projects in SQLite and
// files on disk under ~/Library/Application Support/Studio Aegis/data, and serves the UI.
// The left pane shows Spotify and Splice as tabs (splice.com refuses iframes, but a separate web
// view is a normal top-level page); the right side is the Studio Aegis UI.
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

function readState() {
  try {
    return JSON.parse(fs.readFileSync(statePath(), "utf8"));
  } catch {
    return {};
  }
}

function saveState() {
  if (!win) return;
  try {
    fs.writeFileSync(statePath(), JSON.stringify({ bounds: win.getBounds(), pane: { open: pane.open, tab: pane.tab, ratio: pane.ratio } }));
  } catch {
    /* not critical */
  }
}

// ---- Window & views --------------------------------------------------------
//
//  ┌──────────── left pane ────────────┬──────────── app ────────────┐
//  │ tabsView  [Spotify][Splice] ← → ⟳ │                             │
//  ├───────────────────────────────────┤  appView (Studio Aegis UI)  │
//  │ spotify / splice web view         │                             │
//  └───────────────────────────────────┴─────────────────────────────┘

const TABS_H = 44;
const PANE_MIN = 380;
const APP_MIN = 520;
// Sites that refuse "Electron" in the user agent get a plain Chrome one.
const CHROME_UA = `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`;

const TABS = {
  spotify: { home: "https://open.spotify.com/", host: /(^|\.)spotify\.com$/, partition: "persist:spotify" },
  splice: { home: "https://splice.com/sounds", host: SPLICE_HOST, partition: "persist:splice" },
};

let win = null;
let appView = null;
let tabsView = null;
const content = { spotify: null, splice: null };
const pane = { open: true, tab: "spotify", ratio: 0.42 };

function paneWidth(width) {
  if (!pane.open) return 0;
  return Math.max(PANE_MIN, Math.min(width - APP_MIN, Math.round(width * pane.ratio)));
}

function layout() {
  if (!win || !appView) return;
  const { width, height } = win.getContentBounds();
  const left = paneWidth(width);
  appView.setBounds({ x: left, y: 0, width: width - left, height });
  if (tabsView) tabsView.setBounds({ x: 0, y: 0, width: left, height: pane.open ? TABS_H : 0 });
  for (const [name, view] of Object.entries(content)) {
    if (!view) continue;
    const visible = pane.open && name === pane.tab;
    view.setBounds(visible ? { x: 0, y: TABS_H, width: left, height: height - TABS_H } : { x: 0, y: 0, width: 0, height: 0 });
    view.setVisible(visible);
  }
}

function paneState() {
  const info = {};
  for (const [name, view] of Object.entries(content)) {
    const wc = view?.webContents;
    info[name] = wc
      ? { url: wc.getURL(), title: wc.getTitle(), loading: wc.isLoading(), canGoBack: wc.navigationHistory.canGoBack(), canGoForward: wc.navigationHistory.canGoForward() }
      : null;
  }
  return { open: pane.open, tab: pane.tab, ratio: pane.ratio, ...info };
}

let broadcastTimer = null;
function broadcast() {
  clearTimeout(broadcastTimer);
  broadcastTimer = setTimeout(() => {
    const state = paneState();
    appView?.webContents.send("pane-state", state);
    tabsView?.webContents.send("pane-state", state);
  }, 30);
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

/** Route a link from the app: Spotify / Splice pages open in the left pane, the rest in the browser. */
function routeUrl(url) {
  const host = hostOf(url);
  if (TABS.splice.host.test(host)) openInPane("splice", url);
  else if (host === "open.spotify.com") openInPane("spotify", url);
  else openExternal(url);
}

function createAppView() {
  const view = new WebContentsView({ webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true } });
  view.setBackgroundColor(nativeTheme.shouldUseDarkColors ? "#111214" : "#f6f5f2");
  const contents = view.webContents;
  // Stay inside the app for its own pages and the Spotify login round-trip; everything else → pane / browser.
  // (Also stops a file dropped outside a drop zone from replacing the page.)
  contents.on("will-navigate", (e, url) => {
    if (url.startsWith(`${ORIGIN}/`) || AUTH_HOSTS.test(hostOf(url))) return;
    e.preventDefault();
    routeUrl(url);
  });
  contents.setWindowOpenHandler(({ url }) => {
    routeUrl(url);
    return { action: "deny" };
  });
  addContextMenu(contents);
  return view;
}

function createTabsView() {
  const view = new WebContentsView({ webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true } });
  view.setBackgroundColor(nativeTheme.shouldUseDarkColors ? "#111214" : "#f6f5f2");
  view.webContents.on("will-navigate", (e) => e.preventDefault());
  view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  void view.webContents.loadURL(`${ORIGIN}/pane`);
  return view;
}

function ensureContent(name) {
  if (content[name]) return content[name];
  const tab = TABS[name];
  session.fromPartition(tab.partition).setUserAgent(CHROME_UA);
  // Own persistent session per site so logins are remembered across launches.
  const view = new WebContentsView({ webPreferences: { partition: tab.partition, contextIsolation: true, sandbox: true } });
  const contents = view.webContents;
  contents.on("will-navigate", (e, url) => {
    const host = hostOf(url);
    if (tab.host.test(host) || AUTH_HOSTS.test(host)) return;
    e.preventDefault();
    openExternal(url);
  });
  // Login popups (Google / Apple / Facebook) open as real windows; same-site links stay in the pane.
  contents.setWindowOpenHandler(({ url }) => {
    const host = hostOf(url);
    if (AUTH_HOSTS.test(host) && !tab.host.test(host)) return { action: "allow" };
    if (tab.host.test(host)) void contents.loadURL(url);
    else openExternal(url);
    return { action: "deny" };
  });
  for (const ev of ["did-navigate", "did-navigate-in-page", "page-title-updated", "did-start-loading", "did-stop-loading"]) {
    contents.on(ev, broadcast);
  }
  addContextMenu(contents);
  win.contentView.addChildView(view);
  content[name] = view;
  void contents.loadURL(tab.home);
  return view;
}

function setTab(name, open = true) {
  if (!TABS[name]) return;
  pane.tab = name;
  pane.open = open || pane.open;
  if (pane.open) ensureContent(name);
  layout();
  broadcast();
  buildMenu();
  saveState();
}

function togglePane(open = !pane.open) {
  pane.open = open;
  if (pane.open) ensureContent(pane.tab);
  layout();
  broadcast();
  buildMenu();
  saveState();
}

function openInPane(name, url) {
  const tab = TABS[name];
  if (!tab) return;
  if (url && !tab.host.test(hostOf(url))) return openExternal(url);
  setTab(name, true);
  const view = content[name];
  if (url && view && view.webContents.getURL() !== url) void view.webContents.loadURL(url);
}

function paneNav(action) {
  const wc = content[pane.tab]?.webContents;
  if (!wc) return;
  if (action === "back") wc.navigationHistory.goBack();
  else if (action === "forward") wc.navigationHistory.goForward();
  else if (action === "reload") wc.reload();
  else if (action === "home") void wc.loadURL(TABS[pane.tab].home);
  else if (action === "external") openExternal(wc.getURL());
}

function createWindow() {
  const saved = readState();
  Object.assign(pane, saved.pane ?? {});
  if (!TABS[pane.tab]) pane.tab = "spotify";
  const bounds = saved.bounds;
  win = new BaseWindow({
    width: bounds?.width ?? 1440,
    height: bounds?.height ?? 900,
    x: bounds?.x,
    y: bounds?.y,
    minWidth: 960,
    minHeight: 600,
    title: "Studio Aegis",
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#111214" : "#f6f5f2",
  });
  appView = createAppView();
  tabsView = createTabsView();
  win.contentView.addChildView(appView);
  win.contentView.addChildView(tabsView);
  if (pane.open) ensureContent(pane.tab);
  layout();
  win.on("resize", layout);
  win.on("close", saveState);
  win.on("closed", () => {
    win = null;
    appView = null;
    tabsView = null;
    content.spotify = null;
    content.splice = null;
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

ipcMain.handle("pane:get", () => paneState());
ipcMain.handle("pane:setTab", (_e, name) => setTab(String(name)));
ipcMain.handle("pane:toggle", (_e, open) => togglePane(typeof open === "boolean" ? open : undefined));
ipcMain.handle("pane:open", (_e, name, url) => openInPane(String(name), typeof url === "string" ? url : undefined));
ipcMain.handle("pane:nav", (_e, action) => paneNav(String(action)));
// Divider drag from the app view: the pointer's screen X sets the pane width.
ipcMain.on("pane:drag", (_e, screenX) => {
  if (!win || !pane.open || typeof screenX !== "number") return;
  const { x, width } = win.getContentBounds();
  pane.ratio = Math.max(0.2, Math.min(0.75, (screenX - x) / width));
  layout();
});
ipcMain.on("pane:dragEnd", () => {
  broadcast();
  saveState();
});
ipcMain.handle("app:info", () => ({ version: app.getVersion(), dataDir: dataDir() }));
ipcMain.handle("app:openDataFolder", () => shell.openPath(dataDir()));
ipcMain.handle("app:exportBackup", () => exportBackup());
ipcMain.handle("app:checkForUpdate", () => checkForUpdate());
ipcMain.handle("app:openExternal", (_e, url) => openExternal(String(url)));

// ---- Menu ------------------------------------------------------------------

function focusedContents() {
  const active = pane.open ? content[pane.tab] : null;
  if (active?.webContents.isFocused()) return active.webContents;
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
      label: "左パネル",
      submenu: [
        { label: pane.open ? "左パネルを隠す" : "左パネルを表示", accelerator: "CmdOrCtrl+Shift+L", click: () => togglePane() },
        { type: "separator" },
        { label: "Spotify", type: "radio", checked: pane.tab === "spotify", accelerator: "CmdOrCtrl+1", click: () => setTab("spotify") },
        { label: "Splice", type: "radio", checked: pane.tab === "splice", accelerator: "CmdOrCtrl+2", click: () => setTab("splice") },
        { type: "separator" },
        { label: "左パネルのページをブラウザで開く", click: () => paneNav("external") },
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
