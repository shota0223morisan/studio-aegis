// Studio Aegis desktop shell.
//
// The app itself is the Cloudflare-hosted web app (so data stays in sync with phones etc.);
// this shell adds what a browser can't: Splice shown inside the app window as a side panel
// (splice.com refuses iframes, but a separate web view is a normal top-level page), a Dock
// icon, and native menus.
const { app, BaseWindow, WebContentsView, Menu, shell, ipcMain, nativeTheme } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { studioAegis } = require("../package.json");

const PRELOAD = path.join(__dirname, "preload.js");
const SETUP_PAGE = path.join(__dirname, "setup.html");
const ERROR_PAGE = path.join(__dirname, "error.html");
const SPLICE_HOST = /(^|\.)splice\.com$/;
// OAuth / login pages that must stay inside the window so the redirect back to the app works.
const AUTH_HOSTS = /(^|\.)(spotify\.com|google\.com|apple\.com|facebook\.com|splice\.com)$/;

// ---- Config (server URL, window bounds) ------------------------------------

const configPath = () => path.join(app.getPath("userData"), "config.json");

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath(), "utf8"));
  } catch {
    return {};
  }
}

function writeConfig(patch) {
  const next = { ...readConfig(), ...patch };
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(next, null, 2));
  return next;
}

// AEGIS_SERVER_URL overrides the saved URL (handy for local development: npm start with wrangler dev).
const serverUrl = () => process.env.AEGIS_SERVER_URL || readConfig().serverUrl || studioAegis.defaultServerUrl || "";

function sameOrigin(url, base) {
  try {
    return new URL(url).origin === new URL(base).origin;
  } catch {
    return false;
  }
}

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

// ---- Window & views --------------------------------------------------------

/** @type {BaseWindow | null} */
let win = null;
/** @type {WebContentsView | null} */
let appView = null;
/** @type {WebContentsView | null} */
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

function loadApp() {
  const url = serverUrl();
  if (!appView) return;
  if (!url) void appView.webContents.loadFile(SETUP_PAGE);
  else void appView.webContents.loadURL(url);
}

function showSetup() {
  void appView?.webContents.loadFile(SETUP_PAGE, { query: { url: serverUrl() } });
}

function createAppView() {
  const view = new WebContentsView({
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true },
  });
  view.setBackgroundColor(nativeTheme.shouldUseDarkColors ? "#111214" : "#f6f5f2");
  const contents = view.webContents;

  // Stay inside the app for its own pages and OAuth round-trips; everything else → browser.
  contents.on("will-navigate", (e, url) => {
    if (url.startsWith("file:")) {
      // Our setup/error pages are fine; a file dropped outside a drop zone is not.
      if (!url.includes("/src/setup.html") && !url.includes("/src/error.html")) e.preventDefault();
      return;
    }
    if (sameOrigin(url, serverUrl()) || AUTH_HOSTS.test(hostOf(url))) return;
    e.preventDefault();
    openExternal(url);
  });

  contents.setWindowOpenHandler(({ url }) => {
    if (SPLICE_HOST.test(hostOf(url))) openSplice(url);
    else openExternal(url);
    return { action: "deny" };
  });

  contents.on("did-fail-load", (_e, code, description, url, isMainFrame) => {
    if (!isMainFrame || code === -3 /* aborted (e.g. redirect) */) return;
    void contents.loadFile(ERROR_PAGE, { query: { code: String(code), description, url } });
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
  // Allow login popups (Google / Apple sign-in) to open as real windows; other popups → browser.
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
  const bounds = readConfig().bounds;
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
  win.on("close", () => writeConfig({ bounds: win.getBounds() }));
  win.on("closed", () => {
    win = null;
    appView = null;
    spliceView = null;
    spliceOpen = false;
  });
  loadApp();
}

// ---- IPC from the web app / setup pages -----------------------------------

ipcMain.handle("splice:open", (_e, url) => {
  if (typeof url !== "string") return;
  if (SPLICE_HOST.test(hostOf(url))) openSplice(url);
  else openExternal(url);
});
ipcMain.handle("splice:close", () => closeSplice());
ipcMain.handle("splice:state", () => spliceOpen);

ipcMain.handle("config:get", () => ({ serverUrl: serverUrl(), defaultServerUrl: studioAegis.defaultServerUrl || "" }));
ipcMain.handle("config:setServerUrl", (_e, value) => {
  let url;
  try {
    url = new URL(String(value).trim());
  } catch {
    return { ok: false, error: "URL の形式が正しくありません" };
  }
  const local = ["127.0.0.1", "localhost"].includes(url.hostname);
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    return { ok: false, error: "https:// で始まる URL を入力してください" };
  }
  writeConfig({ serverUrl: url.origin });
  loadApp();
  return { ok: true };
});
ipcMain.handle("app:retry", () => loadApp());
ipcMain.handle("app:showSetup", () => showSetup());

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
              { type: "separator" },
              { label: "サーバー URL を変更…", click: showSetup },
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
        { label: "ホームに戻る", accelerator: "CmdOrCtrl+Shift+H", click: loadApp },
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

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!win) return createWindow();
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(() => {
    app.setAboutPanelOptions({ applicationName: "Studio Aegis", applicationVersion: app.getVersion() });
    buildMenu();
    createWindow();
    app.on("activate", () => {
      if (!win) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
