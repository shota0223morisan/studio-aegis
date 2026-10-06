// Session Partner (formerly Studio Aegis) — Mac app.
//
// Everything runs on this Mac: a small local server (127.0.0.1 only) keeps projects in SQLite and
// files on disk under ~/Library/Application Support/Studio Aegis/data, and serves the UI.
// The Studio Aegis UI sits in the middle; the side panes show sites as tabs — Splice / Suno / Web / Amazon MP3 on the left and
// YouTube Music / Spotify on the right by default (splice.com refuses iframes, but a separate web view is a normal top-level page).
const { app, BaseWindow, BrowserWindow, WebContentsView, Menu, shell, ipcMain, nativeTheme, nativeImage, dialog, session, clipboard } = require("electron");
const { execFile } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { openDatabase } = require("./server/db");
const { createServer } = require("./server/server");
const updater = require("./updater");

// Shown everywhere. The bundle / data folder keep the original "Studio Aegis" name so data and
// in-app updates carry over.
const APP_NAME = "Session Partner";
const PORT = Number(process.env.AEGIS_PORT) || 47823; // fixed: the Spotify redirect URI includes it
const ORIGIN = `http://127.0.0.1:${PORT}`;
const PRELOAD = path.join(__dirname, "preload.js");
const SPLICE_HOST = /(^|\.)splice\.com$/;
// OAuth / login pages that must stay inside the window so the redirect back to the app works.
const AUTH_HOSTS = /(^|\.)(spotify\.com|google\.com|apple\.com|facebook\.com|splice\.com|discord\.com|clerk\.com|microsoftonline\.com|live\.com|openai\.com)$/;

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
    fs.writeFileSync(statePath(), JSON.stringify({ bounds: win.getBounds(), panes, sides }));
  } catch {
    /* not critical */
  }
}

// ---- Window & views --------------------------------------------------------
//
//  ┌── left pane ──────────┬────────── app ───────────┬── right pane ──────────┐
//  │ tabs [Splice][Suno]…  │                          │ tabs [YT Music][Spotify]│
//  ├───────────────────────┤  appView (Studio Aegis)  ├────────────────────────┤
//  │ site web view         │                          │ site web view          │
//  └───────────────────────┴──────────────────────────┴────────────────────────┘
//
// Every site tab lives on one side (movable); each side shows one tab at a time and can be
// collapsed. "Swap" mirrors the two sides.

const TABS_H = 44;
const TABS_H_WEB = 84; // the Web tab adds an address bar row
const PANE_MIN = 260;
const APP_MIN = 600;
// Sites that refuse "Electron" in the user agent get a plain Chrome one.
const CHROME_UA = `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`;
// Google refuses sign-in from embedded browsers ("このブラウザまたはアプリは安全でない可能性があります").
// Its sign-in pages accept Firefox, so on those pages (only) the pane presents itself as Firefox.
const FIREFOX_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:140.0) Gecko/20100101 Firefox/140.0";
const GOOGLE_SIGNIN = /^(accounts\.google\.com|accounts\.youtube\.com|accounts\.google\.[a-z.]+)$/;

const patchedSessions = new WeakSet();
/** Per-site session: Chrome UA everywhere, Firefox UA (and no Chromium client hints) on Google sign-in. */
function prepareSession(ses) {
  if (patchedSessions.has(ses)) return;
  patchedSessions.add(ses);
  ses.setUserAgent(CHROME_UA);
  ses.webRequest.onBeforeSendHeaders((details, cb) => {
    const headers = { ...details.requestHeaders };
    if (GOOGLE_SIGNIN.test(hostOf(details.url))) {
      headers["User-Agent"] = FIREFOX_UA;
      for (const k of Object.keys(headers)) if (/^sec-ch-ua/i.test(k)) delete headers[k];
    } else if (headers["User-Agent"] === FIREFOX_UA) {
      headers["User-Agent"] = CHROME_UA; // first request after leaving the sign-in page
    } else return cb({});
    cb({ requestHeaders: headers });
  });
}

/** Keep navigator.userAgent consistent with the header while on Google sign-in pages. */
function followGoogleSignin(contents) {
  contents.on("did-start-navigation", (details, legacyUrl, _inPlace, legacyMain) => {
    const url = details?.url ?? legacyUrl;
    const main = details?.isMainFrame ?? legacyMain;
    if (!main || details?.isSameDocument) return;
    const ua = GOOGLE_SIGNIN.test(hostOf(url)) ? FIREFOX_UA : CHROME_UA;
    if (contents.getUserAgent() !== ua) contents.setUserAgent(ua);
  });
}

const TABS = {
  splice: { home: "https://splice.com/sounds", host: SPLICE_HOST, partition: "persist:splice" },
  // Waveform generation (in-app generation isn't possible, so Suno's own site).
  suno: { home: "https://suno.com/create", host: /(^|\.)suno\.(com|ai)$/, partition: "persist:suno" },
  // General-purpose browser for research.
  web: { home: "https://www.google.com/", host: /./, partition: "persist:web" },
  // Amazon's DRM-free MP3 download store.
  amazon: { home: "https://www.amazon.co.jp/b?node=2128134051", host: /(^|\.)amazon\.(co\.jp|com)$/, partition: "persist:amazon" },
  // Plays inside the app (no DRM needed, unlike Spotify).
  ytmusic: { home: "https://music.youtube.com/", host: /(^|\.)(youtube\.com|youtu\.be)$/, partition: "persist:ytmusic" },
  spotify: { home: "https://open.spotify.com/", host: /(^|\.)spotify\.com$/, partition: "persist:spotify" },
};
const TAB_ORDER = Object.keys(TABS);
const LISTEN_TABS = new Set(["ytmusic", "spotify"]);
const DEFAULT_SIDES = { splice: "left", suno: "left", web: "left", amazon: "left", ytmusic: "right", spotify: "right" };
const SIDES = ["left", "right"];

/** Which tab a URL belongs to (anything unknown goes to the Web tab). */
function tabFor(url) {
  const host = hostOf(url);
  if (host === "open.spotify.com") return "spotify";
  if (host === "music.youtube.com") return "ytmusic";
  for (const name of ["amazon", "splice", "suno"]) if (TABS[name].host.test(host)) return name;
  return "web";
}

let win = null;
let appView = null;
const tabsViews = { left: null, right: null };
const content = Object.fromEntries(TAB_ORDER.map((k) => [k, null]));
const panes = {
  left: { open: true, tab: "splice", ratio: 0.27 },
  right: { open: true, tab: "ytmusic", ratio: 0.25 },
};
let sides = { ...DEFAULT_SIDES };

const tabsOn = (side) => TAB_ORDER.filter((t) => sides[t] === side);
const tabsHeight = (side) => (panes[side].tab === "web" ? TABS_H_WEB : TABS_H);

/** Widths of the two panes; they shrink together when the app would get too narrow. */
function paneWidths(width) {
  const w = {};
  for (const side of SIDES) w[side] = panes[side].open ? Math.max(PANE_MIN, Math.round(width * panes[side].ratio)) : 0;
  const room = width - APP_MIN;
  const total = w.left + w.right;
  if (total > room && total > 0) {
    const scale = Math.max(0, room) / total;
    for (const side of SIDES) if (w[side]) w[side] = Math.max(200, Math.round(w[side] * scale));
  }
  return w;
}

function layout() {
  if (!win || !appView) return;
  const { width, height } = win.getContentBounds();
  const w = paneWidths(width);
  const x = { left: 0, right: width - w.right };
  appView.setBounds({ x: w.left, y: 0, width: Math.max(0, width - w.left - w.right), height });
  for (const side of SIDES) {
    const top = tabsHeight(side);
    tabsViews[side]?.setBounds(panes[side].open ? { x: x[side], y: 0, width: w[side], height: top } : { x: 0, y: 0, width: 0, height: 0 });
  }
  for (const [name, view] of Object.entries(content)) {
    if (!view) continue;
    const side = sides[name];
    const visible = panes[side].open && panes[side].tab === name;
    const top = tabsHeight(side);
    view.setBounds(visible ? { x: x[side], y: top, width: w[side], height: height - top } : { x: 0, y: 0, width: 0, height: 0 });
    view.setVisible(visible);
  }
}

function paneState() {
  const pages = {};
  for (const [name, view] of Object.entries(content)) {
    const wc = view?.webContents;
    pages[name] = wc
      ? { url: wc.getURL(), title: wc.getTitle(), loading: wc.isLoading(), canGoBack: wc.navigationHistory.canGoBack(), canGoForward: wc.navigationHistory.canGoForward() }
      : null;
  }
  return { left: { ...panes.left }, right: { ...panes.right }, sides: { ...sides }, pages };
}

let broadcastTimer = null;
function broadcast() {
  clearTimeout(broadcastTimer);
  broadcastTimer = setTimeout(() => {
    const state = paneState();
    appView?.webContents.send("pane-state", state);
    for (const side of SIDES) tabsViews[side]?.webContents.send("pane-state", state);
  }, 30);
}

/** Apply a change to the panes: relayout, tell the UIs, update the menu, remember it. */
function commit() {
  for (const side of SIDES) if (panes[side].open && panes[side].tab) ensureContent(panes[side].tab);
  layout();
  broadcast();
  buildMenu();
  saveState();
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

/** Route a link from the app into the matching pane tab (unknown sites → Web tab). */
function routeUrl(url) {
  if (!/^https?:\/\//.test(url)) return;
  openInPane(tabFor(url), url);
}

function createAppView() {
  const view = new WebContentsView({ webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true } });
  view.setBackgroundColor(nativeTheme.shouldUseDarkColors ? "#111214" : "#f6f5f2");
  const contents = view.webContents;
  // Stay inside the app for its own pages; everything else → pane / browser.
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

function createTabsView(side) {
  const view = new WebContentsView({ webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true } });
  view.setBackgroundColor(nativeTheme.shouldUseDarkColors ? "#111214" : "#f6f5f2");
  view.webContents.on("will-navigate", (e) => e.preventDefault());
  view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  void view.webContents.loadURL(`${ORIGIN}/pane?side=${side}`);
  return view;
}

function ensureContent(name) {
  if (content[name]) return content[name];
  const tab = TABS[name];
  prepareSession(session.fromPartition(tab.partition));
  // Own persistent session per site so logins are remembered across launches.
  const view = new WebContentsView({ webPreferences: { partition: tab.partition, contextIsolation: true, sandbox: true } });
  const contents = view.webContents;
  followGoogleSignin(contents);
  contents.on("will-navigate", (e, url) => {
    const host = hostOf(url);
    if (tab.host.test(host) || AUTH_HOSTS.test(host) || !/^https?:/.test(url)) return;
    e.preventDefault();
    routeUrl(url);
  });
  // Login popups (Google / Apple / Facebook / Discord) open as real windows; other links stay in the panes.
  contents.setWindowOpenHandler(({ url }) => {
    const host = hostOf(url);
    // Sign-in popups (Google / Apple / Microsoft …, or a blank window the site fills in) open as real
    // windows in the same session, so "ログイン" buttons that need a popup work (Notion, Splice, Suno…).
    if (!url || url === "about:blank" || (AUTH_HOSTS.test(host) && (name === "web" || !tab.host.test(host)))) {
      return { action: "allow", overrideBrowserWindowOptions: { width: 520, height: 720, autoHideMenuBar: true } };
    }
    if (tab.host.test(host)) void contents.loadURL(url);
    else routeUrl(url);
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

/** Show a tab (on whichever side it lives) and open that side. */
function setTab(name) {
  if (!TABS[name]) return;
  const side = sides[name];
  panes[side].tab = name;
  panes[side].open = true;
  commit();
}

function togglePane(side, open = !panes[side]?.open) {
  if (!panes[side]) return;
  panes[side].open = open;
  if (open && !tabsOn(side).includes(panes[side].tab)) panes[side].tab = tabsOn(side)[0] ?? null;
  if (open && !panes[side].tab) panes[side].open = false; // nothing to show there
  commit();
}

/** Move one tab to the other side (and show it there). */
function moveTab(name) {
  if (!TABS[name]) return;
  const from = sides[name];
  const to = from === "left" ? "right" : "left";
  sides[name] = to;
  if (panes[from].tab === name) {
    panes[from].tab = tabsOn(from)[0] ?? null;
    if (!panes[from].tab) panes[from].open = false;
  }
  panes[to].tab = name;
  panes[to].open = true;
  commit();
}

/** Mirror the two panes (tabs, widths, open state). */
function swapSides() {
  for (const t of TAB_ORDER) sides[t] = sides[t] === "left" ? "right" : "left";
  const left = panes.left;
  panes.left = panes.right;
  panes.right = left;
  commit();
}

/**
 * Layout presets, also applied automatically when a song moves to another stage.
 * listen: the listening side wide, the other folded · build: Splice + a small player
 * polish: a narrower player only · focus: both folded
 */
function applyPreset(name) {
  const listenSide = LISTEN_TABS.has(panes.right.tab) && sides[panes.right.tab] === "right" ? "right" : sides.ytmusic;
  const other = listenSide === "left" ? "right" : "left";
  const listenTab = LISTEN_TABS.has(panes[listenSide].tab) ? panes[listenSide].tab : "ytmusic";
  const show = (side, tab, ratio) => {
    if (sides[tab] !== side) return;
    Object.assign(panes[side], { open: true, tab, ratio });
  };
  if (name === "listen") {
    show(listenSide, listenTab, 0.34);
    panes[other].open = false;
  } else if (name === "build") {
    const buildSide = sides.splice;
    if (buildSide !== listenSide) {
      show(buildSide, "splice", 0.28);
      show(listenSide, listenTab, 0.22);
    } else show(buildSide, "splice", 0.3);
  } else if (name === "polish") {
    show(listenSide, listenTab, 0.26);
    panes[other].open = false;
  } else if (name === "focus") {
    panes.left.open = false;
    panes.right.open = false;
  } else return;
  commit();
}

function openInPane(name, url) {
  const tab = TABS[name];
  if (!tab) return;
  if (url && !tab.host.test(hostOf(url))) return routeUrl(url);
  setTab(name);
  const view = content[name];
  if (url && view && view.webContents.getURL() !== url) void view.webContents.loadURL(url);
}

function paneNav(side, action) {
  const name = panes[side]?.tab;
  const wc = name && content[name]?.webContents;
  if (!wc) return;
  if (action === "back") wc.navigationHistory.goBack();
  else if (action === "forward") wc.navigationHistory.goForward();
  else if (action === "reload") wc.reload();
  else if (action === "home") void wc.loadURL(TABS[name].home);
  else if (action === "external") openExternal(wc.getURL());
  else if (action === "chrome" || action === "safari") openInBrowser(action, wc.getURL());
}

/** What's playing in YouTube Music / Spotify (for "add to references"). */
async function nowPlaying() {
  const order = [panes.right.tab, panes.left.tab, "ytmusic", "spotify"].filter((t) => LISTEN_TABS.has(t));
  for (const name of [...new Set(order)]) {
    const wc = content[name]?.webContents;
    if (!wc) continue;
    let meta = null;
    try {
      meta = await wc.executeJavaScript(
        "(() => { const m = navigator.mediaSession && navigator.mediaSession.metadata; return m && m.title ? { title: m.title, artist: m.artist || '', album: m.album || '' } : null; })()",
        true,
      );
    } catch {
      /* page not ready */
    }
    if (!meta) {
      // Fall back to the page title ("Song • Artist" / "Song - Artist - YouTube Music").
      const t = wc.getTitle().replace(/\s*[-|]\s*(YouTube Music|Spotify.*)$/i, "").trim();
      const [title, artist] = t.split(/\s+[•·]\s+|\s+-\s+/);
      if (title && !/^(YouTube Music|Spotify|ホーム|Home)/i.test(title)) meta = { title, artist: artist ?? "", album: "" };
    }
    if (meta) return { ...meta, url: wc.getURL(), source: name };
  }
  return null;
}

// ---- Play a song in YouTube Music (Notion ideas, references, suggestions) ------
//
// 1. find the song: YouTube Music's own search page, loaded in a hidden window (cached)
// 2. open it in the YT Music tab (it plays inside the app) and jump to the noted position.

let ytSearchWin = null;
const YT_CACHE_KEY = "ytmusic.songCache";

const norm = (t) => String(t ?? "").toLowerCase().normalize("NFKC").replace(/[\s・'’"()（）「」\-–—.,!?！？]/g, "");

/** "1:23" / "01:23" / "1:02:03" / "83" / "1:23-1:40" → seconds (0 if none). */
function parsePosition(text) {
  const m = String(text ?? "").match(/(\d+)(?::(\d{1,2}))?(?::(\d{1,2}))?/);
  if (!m) return 0;
  const parts = [m[1], m[2], m[3]].filter((x) => x !== undefined).map(Number);
  return parts.reduce((a, b) => a * 60 + b, 0);
}

async function findYtMusicSong(title, artist) {
  const q = [title, artist].filter(Boolean).join(" ").trim();
  if (!q) return null;
  const cache = store.kvGet(YT_CACHE_KEY) ?? {};
  if (cache[q]) return cache[q];
  if (!ytSearchWin || ytSearchWin.isDestroyed()) {
    prepareSession(session.fromPartition(TABS.ytmusic.partition));
    ytSearchWin = new BrowserWindow({ show: false, webPreferences: { partition: TABS.ytmusic.partition, sandbox: true, contextIsolation: true } });
    ytSearchWin.webContents.setAudioMuted(true);
  }
  const wc = ytSearchWin.webContents;
  await wc.loadURL(`https://music.youtube.com/search?q=${encodeURIComponent(q)}`).catch(() => {});
  let rows = [];
  for (let i = 0; i < 30 && !rows.length; i++) {
    await new Promise((r) => setTimeout(r, 400));
    // The "top result" card first, then the song rows.
    rows = await wc
      .executeJavaScript(
        `[...document.querySelectorAll('ytmusic-card-shelf-renderer, ytmusic-responsive-list-item-renderer')].flatMap((el) => {
          const a = el.querySelector('a[href*="watch?v="]');
          return a ? [{ href: a.getAttribute("href"), text: el.innerText || "", top: el.tagName === "YTMUSIC-CARD-SHELF-RENDERER" }] : [];
        }).slice(0, 12)`,
      )
      .catch(() => []);
  }
  if (!rows.length) return null;
  // Score the candidates: the song itself beats lyric videos, covers and the like.
  // (Artist names may be shown romanised, e.g. "OFFICIAL HIGE DANDISM", so they only add points.)
  const a = norm(artist);
  const t = norm(title);
  const score = (r, i) => {
    const text = norm(r.text);
    const parts = String(r.text).split("\n").map((x) => x.trim());
    let n = -i * 0.2;
    if (t && text.includes(t)) n += 4;
    if (a && text.includes(a)) n += 2;
    if (parts.some((x) => /^(song|曲|노래)$/i.test(x))) n += 2;
    if (i === 0 && r.top) n += 1.5;
    if (/歌詞|lyrics?|가사|cover|カバー|弾いてみた|叩いてみた|歌ってみた|弾き語り|드럼|drum|piano ver|karaoke|カラオケ|instrumental|reaction|해석|発音|발음|歌い方|解説|ボイトレ|ボイストレーナー|レッスン|講座|tutorial|lesson/i.test(r.text)) n -= 5;
    if (/\blive\b|ライブ/i.test(r.text)) n -= 1;
    return n;
  };
  const pick = rows.map((r, i) => ({ r, n: score(r, i) })).sort((x, y) => y.n - x.n)[0].r;
  const id = String(pick.href).match(/[?&]v=([\w-]{6,})/)?.[1];
  if (!id) return null;
  const hit = { id, name: String(pick.text).split("\n")[0].trim() };
  store.kvSet(YT_CACHE_KEY, { ...cache, [q]: hit });
  return hit;
}

async function playSong({ title, artist, position }) {
  const q = [title, artist].filter(Boolean).join(" ").trim();
  if (!q) return { ok: false, message: "曲名がありません" };
  const song = await findYtMusicSong(title, artist).catch(() => null);
  if (!song) {
    openInPane("ytmusic", `https://music.youtube.com/search?q=${encodeURIComponent(q)}`);
    return { ok: false, message: "曲を特定できなかったので、YouTube Music の検索結果を開きました" };
  }
  openInPane("ytmusic", `https://music.youtube.com/watch?v=${song.id}`);
  const sec = parsePosition(position);
  const wc = content.ytmusic?.webContents;
  if (wc) {
    // Wait for the player, then seek; YouTube may reset the position while it starts up, so keep
    // re-applying until it has held for a moment (and make sure it plays).
    void (async () => {
      let held = 0;
      for (let i = 0; i < 60 && held < 3; i++) {
        await new Promise((r) => setTimeout(r, 500));
        const ok = await wc
          .executeJavaScript(
            `(() => { const v = document.querySelector("video"); if (!v || v.readyState < 1 || !location.href.includes("${song.id}")) return false;
              if (v.paused) v.play().catch(() => {});
              ${sec > 0 ? `if (Math.abs(v.currentTime - ${sec}) > 3 && v.currentTime < ${sec}) { v.currentTime = ${sec}; return false; }` : ""}
              return true; })()`,
          )
          .catch(() => false);
        held = ok ? held + 1 : 0;
      }
    })();
  }
  return { ok: true, track: song.name, position: sec };
}

/** Open a page in Chrome / Safari specifically (falls back to the default browser). */
function openInBrowser(browser, url) {
  if (!/^https?:\/\//.test(url)) return;
  if (process.platform !== "darwin") return openExternal(url);
  const appName = browser === "chrome" ? "Google Chrome" : "Safari";
  execFile("open", ["-a", appName, url], (err) => {
    if (err) {
      void dialog.showMessageBox({ message: `${appName} が見つからないため、既定のブラウザで開きます` });
      openExternal(url);
    }
  });
}

/** Web tab address bar: a URL loads directly, anything else is a Google search. */
function webGo(input) {
  const text = String(input ?? "").trim();
  if (!text) return;
  let url;
  if (/^https?:\/\//i.test(text)) url = text;
  else if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/.test(text)) url = `https://${text}`;
  else url = `https://www.google.com/search?q=${encodeURIComponent(text)}`;
  openInPane("web", url);
}

function restorePanes(saved) {
  if (saved.sides && typeof saved.sides === "object") {
    for (const t of TAB_ORDER) if (SIDES.includes(saved.sides[t])) sides[t] = saved.sides[t];
  }
  for (const side of SIDES) {
    const p = saved.panes?.[side];
    if (!p) continue;
    if (typeof p.open === "boolean") panes[side].open = p.open;
    if (typeof p.ratio === "number") panes[side].ratio = Math.max(0.12, Math.min(0.5, p.ratio));
    if (TABS[p.tab] && sides[p.tab] === side) panes[side].tab = p.tab;
  }
  for (const side of SIDES) if (!tabsOn(side).includes(panes[side].tab)) panes[side].tab = tabsOn(side)[0] ?? null;
  for (const side of SIDES) if (!panes[side].tab) panes[side].open = false;
}

function createWindow() {
  const saved = readState();
  restorePanes(saved);
  const bounds = saved.bounds;
  win = new BaseWindow({
    width: bounds?.width ?? 1600,
    height: bounds?.height ?? 940,
    x: bounds?.x,
    y: bounds?.y,
    minWidth: 980,
    minHeight: 600,
    title: APP_NAME,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#111214" : "#f6f5f2",
  });
  appView = createAppView();
  win.contentView.addChildView(appView);
  for (const side of SIDES) {
    tabsViews[side] = createTabsView(side);
    win.contentView.addChildView(tabsViews[side]);
  }
  for (const side of SIDES) if (panes[side].open && panes[side].tab) ensureContent(panes[side].tab);
  layout();
  win.on("resize", layout);
  win.on("close", saveState);
  win.on("closed", () => {
    win = null;
    appView = null;
    for (const side of SIDES) tabsViews[side] = null;
    for (const k of Object.keys(content)) content[k] = null;
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
  const dest = path.join(filePaths[0], `${APP_NAME} バックアップ ${stamp}`);
  fs.mkdirSync(dest, { recursive: true });
  // VACUUM INTO writes a consistent snapshot even while the database is open.
  store.db.prepare("VACUUM INTO ?").run(path.join(dest, "aegis.db"));
  fs.cpSync(store.filesDir, path.join(dest, "files"), { recursive: true });
  fs.cpSync(store.midiDir, path.join(dest, "midi"), { recursive: true });
  shell.showItemInFolder(dest);
  return { ok: true, path: dest };
}

async function checkForUpdate() {
  try {
    return await updater.check();
  } catch (err) {
    return { current: app.getVersion(), latest: null, available: false, canInstall: false, problem: err.message };
  }
}

let updating = false;
const sendUpdate = (progress) => appView?.webContents.send("update-progress", progress);

/** One-click update: download, verify, swap the app and relaunch. */
async function updateNow() {
  if (updating) return { ok: true };
  updating = true;
  try {
    await updater.updateNow(sendUpdate);
    return { ok: true };
  } catch (err) {
    updating = false;
    sendUpdate({ phase: "error", error: err.message });
    return { ok: false, error: err.message };
  }
}

async function checkForUpdateFromMenu() {
  const r = await checkForUpdate();
  if (r.available) {
    const { response } = await dialog.showMessageBox({
      message: `新しいバージョン ${r.latest} があります`,
      detail: r.canInstall
        ? `いまのバージョン: ${r.current}\n「今すぐ更新」で自動でダウンロードして入れ替え、再起動します(データはそのまま残ります)。`
        : `いまのバージョン: ${r.current}\n${r.problem ?? ""}`,
      buttons: r.canInstall ? ["今すぐ更新", "あとで"] : ["ダウンロードページを開く", "あとで"],
    });
    if (response !== 0) return;
    if (r.canInstall) {
      const result = await updateNow();
      if (!result.ok) await dialog.showMessageBox({ type: "warning", message: "更新できませんでした", detail: result.error });
    } else openExternal(r.url);
  } else {
    await dialog.showMessageBox({ message: r.latest ? "最新バージョンです" : "更新を確認できませんでした", detail: r.problem ?? `バージョン ${r.current}` });
  }
}

// ---- IPC from the web UI ---------------------------------------------------

const sideArg = (v) => (SIDES.includes(v) ? v : "left");
ipcMain.handle("pane:get", () => paneState());
ipcMain.handle("pane:setTab", (_e, name) => setTab(String(name)));
ipcMain.handle("pane:toggle", (_e, side, open) => togglePane(sideArg(side), typeof open === "boolean" ? open : undefined));
ipcMain.handle("pane:open", (_e, name, url) => openInPane(String(name), typeof url === "string" ? url : undefined));
ipcMain.handle("pane:nav", (_e, side, action) => paneNav(sideArg(side), String(action)));
ipcMain.handle("pane:webGo", (_e, input) => webGo(input));
ipcMain.handle("pane:moveTab", (_e, name) => moveTab(String(name)));
ipcMain.handle("pane:swap", () => swapSides());
ipcMain.handle("pane:preset", (_e, name) => applyPreset(String(name)));
ipcMain.handle("pane:nowPlaying", () => nowPlaying());
ipcMain.handle("media:play", (_e, req) =>
  playSong({ title: String(req?.title ?? "").slice(0, 300), artist: String(req?.artist ?? "").slice(0, 300), position: String(req?.position ?? "").slice(0, 40) }),
);
// Right-click on a tab: move it to the other side.
ipcMain.handle("pane:tabMenu", (e, name) => {
  if (!TABS[name]) return;
  const to = sides[name] === "left" ? "右" : "左";
  Menu.buildFromTemplate([
    { label: `${to}のパネルへ移動`, click: () => moveTab(name) },
    { label: "左右を入れ替える", click: swapSides },
  ]).popup({ window: win ?? undefined });
});
// Divider drag from the app view: the pointer's screen X sets that pane's width.
ipcMain.on("pane:drag", (_e, side, screenX) => {
  if (!win || !SIDES.includes(side) || !panes[side].open || typeof screenX !== "number") return;
  const { x, width } = win.getContentBounds();
  const px = side === "left" ? screenX - x : x + width - screenX;
  panes[side].ratio = Math.max(0.12, Math.min(0.5, px / width));
  layout();
});
ipcMain.on("pane:dragEnd", () => {
  broadcast();
  saveState();
});
// Drag a MIDI clip out of the app straight into the DAW.
const DRAG_ICON = path.join(__dirname, "midi-drag.png");
ipcMain.on("app:dragMidi", (e, clipId) => {
  const file = path.join(store.midiDir, `${String(clipId).replace(/[^0-9a-f-]/gi, "")}.mid`);
  if (!fs.existsSync(file)) return;
  // A copy with the clip's name, so the DAW shows a readable region name.
  const row = store.db.prepare("SELECT name FROM midi_clips WHERE id = ?").get(String(clipId));
  const named = path.join(app.getPath("temp"), "studio-aegis-midi", `${(row?.name ?? "MIDI").replace(/[\\/:*?"<>|]/g, "_").slice(0, 80)}.mid`);
  try {
    fs.mkdirSync(path.dirname(named), { recursive: true });
    fs.copyFileSync(file, named);
  } catch {
    /* fall back to the stored file */
  }
  e.sender.startDrag({ file: fs.existsSync(named) ? named : file, icon: nativeImage.createFromPath(DRAG_ICON) });
});
ipcMain.handle("app:info", () => ({ version: app.getVersion(), dataDir: dataDir() }));
ipcMain.handle("app:openDataFolder", () => shell.openPath(dataDir()));
ipcMain.handle("app:exportBackup", () => exportBackup());
ipcMain.handle("app:checkForUpdate", () => checkForUpdate());
ipcMain.handle("app:updateNow", () => updateNow());
ipcMain.handle("app:openExternal", (_e, url) => openExternal(String(url)));
ipcMain.handle("app:copyText", (_e, text) => clipboard.writeText(String(text ?? "")));

// ---- Menu ------------------------------------------------------------------

function focusedContents() {
  for (const side of SIDES) {
    const active = panes[side].open && panes[side].tab ? content[panes[side].tab] : null;
    if (active?.webContents.isFocused()) return active.webContents;
  }
  return appView?.webContents;
}

const TAB_LABELS = { splice: "Splice", suno: "Suno", web: "Web", amazon: "Amazon(MP3)", ytmusic: "YouTube Music", spotify: "Spotify" };

function buildMenu() {
  const isMac = process.platform === "darwin";
  const template = [
    ...(isMac
      ? [
          {
            label: APP_NAME,
            submenu: [
              { role: "about", label: `${APP_NAME} について` },
              { label: "アップデートを確認…", click: () => void checkForUpdateFromMenu() },
              { type: "separator" },
              { role: "hide", label: `${APP_NAME} を隠す` },
              { role: "hideOthers", label: "ほかを隠す" },
              { role: "unhide", label: "すべてを表示" },
              { type: "separator" },
              { role: "quit", label: `${APP_NAME} を終了` },
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
      label: "パネル",
      submenu: [
        { label: panes.left.open ? "左パネルを畳む" : "左パネルを開く", accelerator: "CmdOrCtrl+Shift+L", click: () => togglePane("left") },
        { label: panes.right.open ? "右パネルを畳む" : "右パネルを開く", accelerator: "CmdOrCtrl+Shift+R", click: () => togglePane("right") },
        { label: "左右を入れ替える", accelerator: "CmdOrCtrl+Shift+S", click: swapSides },
        { type: "separator" },
        { label: "LISTEN(聴いて分析)", click: () => applyPreset("listen") },
        { label: "BUILD(素材探し+プレイヤー)", click: () => applyPreset("build") },
        { label: "POLISH(リファレンスと比較)", click: () => applyPreset("polish") },
        { label: "FOCUS(両方畳む)", accelerator: "CmdOrCtrl+Shift+F", click: () => applyPreset("focus") },
        { type: "separator" },
        ...TAB_ORDER.map((t, i) => ({
          label: `${TAB_LABELS[t]}(${sides[t] === "left" ? "左" : "右"})`,
          type: "radio",
          checked: panes[sides[t]].open && panes[sides[t]].tab === t,
          accelerator: `CmdOrCtrl+${i + 1}`,
          click: () => setTab(t),
        })),
        { type: "separator" },
        { label: "Chrome で開く(左)", click: () => paneNav("left", "chrome") },
        { label: "Safari で開く(左)", click: () => paneNav("left", "safari") },
      ],
    },
    { role: "windowMenu", label: "ウィンドウ" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---- Lifecycle -------------------------------------------------------------

async function start() {
  app.setAboutPanelOptions({ applicationName: APP_NAME, applicationVersion: app.getVersion() });
  store = openDatabase(dataDir());

  // Per-launch secret: only this app's window carries it, so other apps / browsers can't use the API.
  const sessionToken = crypto.randomBytes(32).toString("hex");
  try {
    await createServer({ store, webDir: webDir(), port: PORT, sessionToken });
  } catch (err) {
    dialog.showErrorBox(
      `${APP_NAME} を起動できません`,
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
  // Sign-in popups (e.g. "Google でログイン" on Splice / Suno) are separate windows: same treatment.
  app.on("web-contents-created", (_e, contents) => {
    if (contents.getType() === "window" && contents.session !== session.defaultSession) {
      prepareSession(contents.session);
      followGoogleSignin(contents);
    }
  });
  app.whenReady().then(start);
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
