'use strict';
const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, dialog, shell, powerMonitor, nativeTheme } = require('electron');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const git = require('./core/git.cjs');
const discovery = require('./core/discovery.cjs');
const { createStore, createRepository, normalizeInterval } = require('./core/store.cjs');
const { Monitor } = require('./core/monitor.cjs');
const { configureLoginItem } = require('./core/login.cjs');

const smoke = process.env.REPO_TRAY_SMOKE_TEST === '1';
if (process.env.REPO_TRAY_USER_DATA) app.setPath('userData', path.resolve(process.env.REPO_TRAY_USER_DATA));
app.setName('Repo Tray');
if (process.platform === 'win32') app.setAppUserModelId('dev.repotray.desktop');
// Finder and Windows login launches have a narrower PATH than a developer terminal.
const extraPaths = process.platform === 'win32'
  ? [path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'cmd'), path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Git', 'cmd')]
  : ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'];
process.env.PATH = [...new Set([...(process.env.PATH || '').split(path.delimiter), ...extraPaths])].filter(Boolean).join(path.delimiter);

let window;
let tray;
let monitor;
let store;
let config;
let quitting = false;
let quitRequested = false;
let broadcastTimer;
let saveTimer;
let scanController;
let scanPromise;
let registrationPending = false;
const repositoryGroupLookups = new Map();
let gitAvailable = false;
let startupError = null;
let trayStatus = { kind: 'normal', tooltip: 'Repo Tray' };
const scanState = { running: false, found: [], scannedDirectories: 0, errors: [], deniedPaths: [], skippedCount: 0, cancelled: false };
const rendererPath = path.join(__dirname, 'renderer', 'index.html');
const rendererURL = pathToFileURL(rendererPath).href;
const assets = path.join(__dirname, '..', 'assets');

function getState() {
  const metadata = new Map((config?.repositories || []).map(repo => [repo.id, repo]));
  return {
    repositories: (monitor?.getRepositories() || []).map(repo => ({ ...repo, groupKey: metadata.get(repo.id)?.groupKey || null })), settings: config?.settings || {},
    scan: scanState, platform: process.platform, gitAvailable, appVersion: app.getVersion(),
    isPackaged: app.isPackaged, startupError, storageWarnings: store?.warnings || []
  };
}
function publish() {
  if (broadcastTimer) return;
  broadcastTimer = setTimeout(() => {
    broadcastTimer = null;
    if (window && !window.isDestroyed()) window.webContents.send('repo-tray:state', getState());
    refreshTray();
  }, 120);
}
function saveRuntime() {
  if (!store || !monitor) return;
  const runtime = new Map(monitor.getRepositories().map(repo => [repo.id, repo]));
  const repositories = config.repositories.map(repo => {
    const live = runtime.get(repo.id);
    if (!live) return repo;
    return { ...repo, lastCheckedAt: live.lastCheckedAt, lastSeenRemoteHash: live.lastSeenRemoteHash };
  });
  config = store.write({ ...config, repositories });
}
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { try { saveRuntime(); } catch (error) { startupError = error.message; publish(); } }, 800);
}
function commitConfig(next) {
  config = store.write(next);
  monitor.setRepositories(config.repositories);
  publish();
}
function showWindow(section) {
  if (!window || window.isDestroyed()) createWindow();
  if (window.isMinimized()) window.restore();
  if (section && ['overview', 'discovery', 'settings'].includes(section)) {
    window.webContents.send('repo-tray:navigate', section);
    window.webContents.executeJavaScript(`location.hash = ${JSON.stringify(section)}`).catch(() => {});
  }
  window.show();
  window.focus();
  if (process.platform === 'darwin') app.dock.show();
}
function hideWindow() {
  window?.hide();
  if (process.platform === 'darwin') app.dock.hide();
}
function createWindow() {
  window = new BrowserWindow({
    width: 1120, height: 790, minWidth: 760, minHeight: 570, show: false,
    title: 'Repo Tray', backgroundColor: '#f4f6fa', icon: path.join(assets, 'app.png'),
    autoHideMenuBar: process.platform !== 'darwin',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true }
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.webContents.session.setPermissionCheckHandler(() => false);
  window.on('close', event => { if (!quitting) { event.preventDefault(); hideWindow(); } });
  window.on('closed', () => { window = null; });
  window.loadFile(rendererPath);
  window.webContents.on('did-finish-load', publish);
}
function iconFor(kind) {
  const name = kind === 'pending' ? 'tray-red.png' : kind === 'error' ? 'tray-amber.png' : process.platform !== 'darwin' && nativeTheme.shouldUseDarkColors ? 'tray-light.png' : 'trayTemplate.png';
  const icon = nativeImage.createFromPath(path.join(assets, name));
  if (process.platform === 'darwin') icon.setTemplateImage(kind === 'normal');
  return icon;
}
function refreshTray() {
  if (!tray || !monitor) return;
  const repos = monitor.getRepositories();
  const pending = repos.filter(repo => repo.pending);
  const errors = repos.filter(repo => repo.error);
  const checking = repos.some(repo => repo.checking || repo.syncing);
  const kind = pending.length ? 'pending' : errors.length || !gitAvailable || startupError ? 'error' : 'normal';
  tray.setImage(iconFor(kind));
  const tooltip = `Repo Tray · ${pending.length ? `${pending.length}개 저장소에 확인할 변경` : errors.length ? `${errors.length}개 저장소 확인 필요` : checking ? '원격 확인 중' : '최신 상태'}`;
  tray.setToolTip(tooltip);
  trayStatus = { kind, tooltip };
  const items = [
    { label: pending.length ? `● 확인할 변경 ${pending.length}개` : checking ? '원격 변경 확인 중…' : 'Repo Tray · 최신 상태', enabled: false },
    { type: 'separator' },
    ...pending.slice(0, 8).map(repo => ({ label: `${repo.name} · ${repo.state?.behind || 0}개 새 커밋`, click: () => showWindow('overview') })),
    ...(pending.length ? [{ type: 'separator' }] : []),
    { label: '저장소 열기', click: () => showWindow('overview') },
    { label: '지금 원격 확인', enabled: gitAvailable && repos.length > 0, click: () => monitor.checkNow().catch(reportError) },
    { label: '저장소 찾기', click: () => showWindow('discovery') },
    { label: '설정', click: () => showWindow('settings') },
    { type: 'separator' },
    { label: 'Repo Tray 종료', click: () => app.quit() }
  ];
  tray.setContextMenu(Menu.buildFromTemplate(items));
}
function reportError(error) { startupError = error.message || String(error); publish(); }
function requireRepo(id) {
  if (typeof id !== 'string') throw new Error('저장소를 선택해 주세요.');
  const repo = config.repositories.find(item => item.id === id);
  if (!repo) throw new Error('등록된 저장소를 찾을 수 없습니다.');
  return repo;
}
function validMinutes(value) {
  const minutes = Number(value);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 10080) throw new Error('조회 주기는 1~10,080분 사이의 정수로 입력해 주세요.');
  return normalizeInterval(minutes);
}
async function allRoots() {
  return discovery.getFullScanRoots();
}
async function beginScan({ mode } = {}) {
  if (scanState.running) throw new Error('이미 저장소를 찾고 있습니다.');
  if (!gitAvailable) throw new Error('먼저 Git을 설치한 뒤 앱을 다시 실행해 주세요.');
  if (!['full', 'folder'].includes(mode)) throw new Error('탐색 범위를 선택해 주세요.');
  scanState.running = true;
  scanState.cancelled = false;
  publish();
  let roots;
  try {
    if (mode === 'full') roots = await allRoots();
    else {
      const result = await dialog.showOpenDialog(window, { title: 'Git 저장소를 찾을 폴더', defaultPath: os.homedir(), properties: ['openDirectory', 'multiSelections', 'dontAddToRecent'] });
      if (!result.canceled) roots = result.filePaths;
    }
    if (!roots?.length || scanState.cancelled || quitRequested) { scanState.running = false; publish(); return getState(); }
  } catch (error) { scanState.running = false; publish(); throw error; }
  scanController = new AbortController();
  Object.assign(scanState, { running: true, found: [], scannedDirectories: 0, errors: [], deniedPaths: [], skippedCount: 0, cancelled: false });
  publish();
  // Scanning is deliberately triggered by the user's button, never on startup.
  scanPromise = discovery.discoverRepositories({
    roots, mode, home: smoke && process.env.REPO_TRAY_TEST_HOME || os.homedir(), deniedPaths: config.scanPreferences?.deniedPaths || [], signal: scanController.signal,
    onFound: repo => { if (!scanState.found.some(item => item.path === repo.path)) scanState.found.push(repo); publish(); },
    onProgress: progress => { scanState.scannedDirectories = progress.scannedDirectories || 0; scanState.skippedCount = progress.skippedCount || 0; publish(); }
  }).then(result => {
    Object.assign(scanState, { found: result.repositories, errors: result.errors, deniedPaths: result.deniedPaths || [], skippedCount: result.skippedCount || 0, scannedDirectories: result.scannedDirectories, cancelled: result.cancelled });
    const identities = new Map(result.repositories.map(repo => [repo.path, repo.groupKey]));
    commitConfig({
      ...config,
      repositories: config.repositories.map(repo => ({ ...repo, groupKey: identities.get(repo.path) || repo.groupKey })),
      scanPreferences: { deniedPaths: result.deniedPaths || config.scanPreferences?.deniedPaths || [] }
    });
  }).catch(error => { if (error.name !== 'AbortError') scanState.errors.push({ path: roots.join(', '), message: error.message }); })
    .finally(() => { scanState.running = false; scanController = null; scanPromise = null; publish(); });
  return getState();
}
async function completeRepositoryGroups(found) {
  const resolved = new Map();
  for (const repo of config.repositories) {
    if (repo.groupKey) continue;
    let identity = found.get(repo.path)?.groupKey;
    if (!identity) {
      // Older settings lack common-directory identity. Resolve each registered path
      // once per app session; a denied path must not be probed again on every click.
      if (!repositoryGroupLookups.has(repo.id)) repositoryGroupLookups.set(repo.id, git.getRepositoryGroup(repo.path).catch(() => null));
      identity = await repositoryGroupLookups.get(repo.id);
    }
    if (identity) resolved.set(repo.id, identity);
  }
  if (resolved.size) commitConfig({ ...config, repositories: config.repositories.map(repo => ({ ...repo, groupKey: resolved.get(repo.id) || repo.groupKey })) });
}
function applyLoginSetting(settings = config.settings) {
  if (!app.isPackaged || smoke) return;
  configureLoginItem(app, settings.launchAtLogin);
}
const handlers = {
  getState,
  scan: beginScan,
  cancelScan: () => { scanState.cancelled = true; scanController?.abort(); publish(); return getState(); },
  addRepositories: async ({ paths, intervalMinutes } = {}) => {
    if (registrationPending) throw new Error('저장소를 등록하고 있습니다. 잠시 후 다시 시도해 주세요.');
    if (!Array.isArray(paths) || paths.length > 500 || paths.some(item => typeof item !== 'string')) throw new Error('저장소를 선택해 주세요.');
    const minutes = validMinutes(intervalMinutes ?? config.settings.defaultIntervalMinutes);
    const found = new Map(scanState.found.map(repo => [repo.path, repo]));
    registrationPending = true;
    try {
      await completeRepositoryGroups(found);
      const additions = [];
      const groupKey = value => process.platform === 'win32' ? value?.toLowerCase() : value;
      const registeredGroups = new Set(config.repositories.map(repo => groupKey(repo.groupKey || found.get(repo.path)?.groupKey)).filter(Boolean));
      for (const candidate of paths) {
        if (!found.has(candidate) || found.get(candidate).bare) throw new Error('탐색 결과에 있는 작업 저장소만 등록할 수 있습니다.');
        const identity = groupKey(found.get(candidate).groupKey);
        if (identity && registeredGroups.has(identity)) continue;
        const state = await git.inspectRepository(candidate);
        if (state.error) throw new Error(state.error);
        const repo = createRepository(candidate, { intervalMinutes: minutes, name: found.get(candidate).name, groupKey: found.get(candidate).groupKey });
        if (!config.repositories.some(item => item.id === repo.id) && !additions.some(item => item.id === repo.id)) {
          additions.push(repo);
          if (identity) registeredGroups.add(identity);
        }
      }
      commitConfig({ ...config, repositories: [...config.repositories, ...additions] });
      for (const repo of additions) monitor.checkNow(repo.id).catch(reportError);
      return getState();
    } finally { registrationPending = false; }
  },
  updateRepository: ({ id, intervalMinutes, paused } = {}) => {
    const repo = { ...requireRepo(id) };
    if (intervalMinutes !== undefined) repo.intervalMinutes = validMinutes(intervalMinutes);
    if (paused !== undefined) { if (typeof paused !== 'boolean') throw new Error('일시정지 설정이 올바르지 않습니다.'); repo.paused = paused; }
    commitConfig({ ...config, repositories: config.repositories.map(item => item.id === id ? repo : item) }); return getState();
  },
  removeRepository: ({ id } = {}) => { requireRepo(id); commitConfig({ ...config, repositories: config.repositories.filter(repo => repo.id !== id) }); return getState(); },
  checkNow: async ({ id } = {}) => { if (id) requireRepo(id); await monitor.checkNow(id); return getState(); },
  syncRepository: async ({ id, strategy } = {}) => {
    requireRepo(id);
    if (!['ff-only', 'merge', 'rebase'].includes(strategy)) throw new Error('동기화 방법을 선택해 주세요.');
    await monitor.syncRepository(id, strategy); return getState();
  },
  abortOperation: async ({ id } = {}) => { requireRepo(id); await monitor.abortOperation(id); return getState(); },
  acknowledge: async ({ id } = {}) => { requireRepo(id); await monitor.acknowledge(id); scheduleSave(); return getState(); },
  setSettings: ({ defaultIntervalMinutes, launchAtLogin } = {}) => {
    const previous = config.settings;
    const settings = { ...previous };
    if (defaultIntervalMinutes !== undefined) settings.defaultIntervalMinutes = validMinutes(defaultIntervalMinutes);
    if (launchAtLogin !== undefined) {
      if (typeof launchAtLogin !== 'boolean') throw new Error('자동 실행 설정이 올바르지 않습니다.');
      settings.launchAtLogin = launchAtLogin;
      applyLoginSetting(settings);
    }
    try { commitConfig({ ...config, settings }); }
    catch (error) { try { applyLoginSetting(previous); } catch {} throw error; }
    return getState();
  },
  openFolder: async ({ id } = {}) => { const error = await shell.openPath(requireRepo(id).path); if (error) throw new Error(error); },
  openExternal: async ({ url } = {}) => {
    const allowed = new Set(['https://git-scm.com/downloads', 'https://git-scm.com/docs/git-pull']);
    if (!allowed.has(url)) throw new Error('허용되지 않은 링크입니다.');
    return shell.openExternal(url);
  },
  hideWindow: () => hideWindow()
};
function registerIPC() {
  for (const [name, handler] of Object.entries(handlers)) ipcMain.handle(`repo-tray:${name}`, async (event, args) => {
    try {
      if (quitRequested) throw new Error('진행 중인 Git 작업을 마치고 종료하고 있습니다.');
      if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url.split(/[?#]/)[0] !== rendererURL) throw new Error('잘못된 요청입니다.');
      return { ok: true, value: await handler(args) };
    } catch (error) { return { ok: false, error: error.message || String(error) }; }
  });
}

const lock = smoke || app.requestSingleInstanceLock();
if (!lock) app.quit();
else {
  app.on('second-instance', () => showWindow());
  app.on('activate', () => showWindow());
  app.on('window-all-closed', () => {});
  app.on('before-quit', event => {
    if (quitting) return;
    event.preventDefault();
    if (quitRequested) return;
    quitRequested = true;
    scanController?.abort(); monitor?.stop(); clearTimeout(saveTimer); clearTimeout(broadcastTimer);
    tray?.setToolTip('Repo Tray · 진행 중인 Git 작업을 마치고 종료 중');
    Promise.allSettled([monitor?.whenIdle?.(), scanPromise]).finally(() => {
      clearTimeout(saveTimer); clearTimeout(broadcastTimer);
      try { saveRuntime(); } catch {}
      quitting = true; app.quit();
    });
  });
  app.whenReady().then(async () => {
    try { await promisify(execFile)('git', ['--version'], { timeout: 8000, windowsHide: true }); gitAvailable = true; } catch {}
    store = createStore(path.join(app.getPath('userData'), 'config.json'));
    config = store.read();
    monitor = new Monitor({ git });
    monitor.setRepositories(config.repositories);
    monitor.on('state', () => { publish(); scheduleSave(); });
    monitor.on('error', reportError);
    registerIPC();
    createWindow();
    tray = new Tray(iconFor('normal'));
    tray.on('click', () => { refreshTray(); tray.popUpContextMenu(); });
    tray.on('double-click', () => showWindow());
    refreshTray();
    nativeTheme.on('updated', refreshTray);
    powerMonitor.on('resume', () => { if (gitAvailable) monitor.wake(); });
    powerMonitor.on('unlock-screen', () => { if (gitAvailable) monitor.wake(); });
    try { applyLoginSetting(); } catch (error) { reportError(error); }
    const hidden = process.argv.includes('--hidden') || (process.platform === 'darwin' && app.getLoginItemSettings().wasOpenedAtLogin);
    if (!hidden || config.repositories.length === 0) window.once('ready-to-show', () => showWindow());
    else hideWindow();
    if (gitAvailable) monitor.start();
    if (process.platform === 'darwin') {
      Menu.setApplicationMenu(Menu.buildFromTemplate([
        { label: app.name, submenu: [{ role: 'about' }, { type: 'separator' }, { label: '설정', accelerator: 'Cmd+,', click: () => showWindow('settings') }, { role: 'hide' }, { role: 'quit' }] },
        { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' }
      ]));
    } else Menu.setApplicationMenu(null);
    if (smoke) global.__repoTrayTest = { getState, handlers, showWindow, hideWindow, getWindow: () => window, getTray: () => tray, getTrayStatus: () => trayStatus, getMonitor: () => monitor };
  }).catch(error => { console.error(error); dialog.showErrorBox('Repo Tray를 시작하지 못했습니다', error.message); app.quit(); });
}
