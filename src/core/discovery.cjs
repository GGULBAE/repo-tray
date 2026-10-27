'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const DEPENDENCY_NAMES = new Set(['.git', '.hg', '.svn', 'node_modules', '.venv', 'venv', '__pycache__']);
const CACHE_NAMES = new Set(['.cache', '.npm', '.pnpm-store', '.yarn', '.bun', '.rustup', '.gradle', '.m2', '.nuget', '.dotnet']);
const HOME_TOOL_NAMES = ['.homebrew', '.linuxbrew', '.nvm', '.pyenv', '.rbenv', '.asdf', '.sdkman', '.oh-my-zsh', '.oh-my-fish', '.oh-my-bash', '.zplug', '.zinit', '.nodenv', '.jenv', '.rvm', '.volta'];
const HOME_TOOL_PATHS = ['.vscode/extensions', '.vscode-insiders/extensions', '.cursor/extensions', '.vim/pack', '.vim/plugged', '.local/share/nvim/lazy', '.local/share/nvim/site/pack'];
const INSTALL_ENVIRONMENT_KEYS = ['HOMEBREW_PREFIX', 'HOMEBREW_REPOSITORY', 'HOMEBREW_CELLAR', 'SCOOP', 'SCOOP_GLOBAL', 'ChocolateyInstall', 'NVM_DIR', 'PYENV_ROOT', 'RBENV_ROOT', 'ASDF_DIR', 'ASDF_DATA_DIR', 'SDKMAN_DIR', 'ZPLUG_HOME', 'VOLTA_HOME'];
const PRIVATE_NAMES = new Set(['desktop', 'documents', 'downloads', 'library', 'pictures', 'movies', 'music', 'photos', 'videos', 'appdata']);
const HIDDEN_APP_NAMES = new Set(['.cache', '.config', '.local', '.npm', '.pnpm-store', '.yarn', '.bun', '.cargo', '.rustup', '.gradle', '.m2', '.nuget', '.dotnet', '.ollama', '.docker', '.codex', '.claude', '.cursor', '.vscode', '.ssh', '.aws', '.azure', '.kube', '.gnupg', '.trash', '.trashes']);
const SYSTEM_NAMES = new Set(['$recycle.bin', 'system volume information', 'windows', 'program files', 'program files (x86)', 'programdata', 'applications']);
const POSIX_SYSTEM_ROOTS = new Set(['System', 'Library', 'Applications', 'dev', 'proc', 'sys', 'private', 'bin', 'sbin', 'usr', 'opt', 'etc', 'var', 'run', 'cores']);
const REMOVABLE_ROOTS = new Set(['Volumes', 'Network', 'mnt', 'media']);

function cloudName(name) {
  const lower = name.toLowerCase();
  return /^(onedrive|dropbox)(?:$|[\s-])/.test(lower) || ['google drive', 'googledrive', 'icloud drive', 'iclouddrive', 'cloudstorage', 'mobile documents', 'box', 'box sync', 'pcloud drive', 'mega', 'proton drive'].includes(lower);
}

function sensitiveName(name, metadata = false) {
  const lower = name.toLowerCase();
  return PRIVATE_NAMES.has(lower) || HIDDEN_APP_NAMES.has(lower) || SYSTEM_NAMES.has(lower) || cloudName(name) || (!metadata && DEPENDENCY_NAMES.has(lower));
}

// Drive probing can wake removable/network volumes or request permission.
// Full search starts in the current home; other roots need the folder picker.
async function getFullScanRoots({ home = os.homedir() } = {}) {
  return typeof home === 'string' && home && !home.includes('\0') ? [home] : [];
}

async function discoverRepositories({ roots, maxDepth = 30, onFound = () => {}, onProgress = () => {}, signal, mode = 'folder', home = os.homedir(), platform = process.platform, deniedPaths = [], environment = process.env } = {}) {
  const paths = platform === 'win32' && Array.isArray(roots) && roots.some(root => typeof root === 'string' && /^(?:[a-z]:[\\/]|\\\\)/i.test(root)) ? path.win32 : path;
  if (!Array.isArray(roots) || !roots.length || roots.some(root => typeof root !== 'string' || !paths.isAbsolute(root) || root.includes('\0'))) throw new TypeError('검색할 절대 경로를 하나 이상 지정하세요.');
  if (!Number.isInteger(maxDepth) || maxDepth < 0 || maxDepth > 100) throw new TypeError('검색 깊이는 0~100의 정수여야 합니다.');
  if (!['full', 'folder'].includes(mode)) throw new TypeError('지원하지 않는 검색 방식입니다.');
  if (typeof home !== 'string' || !paths.isAbsolute(home) || home.includes('\0')) throw new TypeError('사용자 홈의 절대 경로가 필요합니다.');

  const normalize = target => paths.resolve(target);
  const keyFor = target => platform === 'win32' ? normalize(target).toLowerCase() : normalize(target);
  const inside = (target, parent) => {
    const relative = paths.relative(keyFor(parent), keyFor(target));
    return relative === '' || (!relative.startsWith('..' + paths.sep) && relative !== '..' && !paths.isAbsolute(relative));
  };
  const segments = target => target.slice(paths.parse(target).root.length).split(/[\\/]/).filter(Boolean);
  const relativeSegments = (target, parent) => paths.relative(parent, target).split(/[\\/]/).filter(Boolean);
  const explicitRoots = roots.map(normalize);
  const allowedRoots = [...explicitRoots];
  const userHome = normalize(home);
  const homeParent = paths.dirname(userHome);
  // Installation roots are excluded even when explicitly picked. Match known
  // locations, never repository names or remotes: ~/Projects/homebrew is a project.
  const installationRoots = [...HOME_TOOL_NAMES, ...HOME_TOOL_PATHS].map(name => paths.join(userHome, ...name.split('/')));
  if (paths === path.win32) {
    installationRoots.push(paths.join(userHome, 'scoop'));
  } else {
    installationRoots.push('/homebrew', '/opt/homebrew', '/usr/local/Homebrew', '/usr/local/Cellar', '/usr/local/Caskroom', '/home/linuxbrew/.linuxbrew');
  }
  const installationKey = target => {
    let key = normalize(target);
    if (platform === 'darwin') key = key.replace(/^\/System\/Volumes\/Data(?=\/|$)/i, '') || '/';
    return ['darwin', 'win32'].includes(platform) ? key.toLowerCase() : key;
  };
  const insideInstallation = (target, root) => {
    const relative = paths.relative(installationKey(root), installationKey(target));
    return relative === '' || (!relative.startsWith('..' + paths.sep) && relative !== '..' && !paths.isAbsolute(relative));
  };
  for (const name of INSTALL_ENVIRONMENT_KEYS) {
    const value = environment?.[name];
    if (typeof value !== 'string' || !value || value.trim() !== value || /[\x00-\x1f]/.test(value) || !paths.isAbsolute(value)) continue;
    // Ignore malformed/broad configuration that would hide the home or a drive.
    if (paths === path.win32 && !/^(?:[a-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+)/i.test(value)) continue;
    const root = normalize(value);
    if (root === paths.parse(root).root || insideInstallation(userHome, root)) continue;
    installationRoots.push(root);
  }
  const denied = new Map();
  for (const value of Array.isArray(deniedPaths) ? deniedPaths : []) {
    if (typeof value === 'string' && paths.isAbsolute(value) && !value.includes('\0') && denied.size < 500) denied.set(keyFor(value), normalize(value));
  }

  const repositories = [];
  const errors = [];
  const visitedPaths = new Set();
  const visitedIdentities = new Set();
  const commonDirectoryGroups = new Map();
  const skipped = new Set();
  const stack = [];
  let scannedDirectories = 0;
  let errorCount = 0;
  let lastProgress = 0;

  const recordError = (folder, error) => {
    if (error?.code === 'EACCES' || error?.code === 'EPERM') {
      if (denied.size < 500) denied.set(keyFor(folder), normalize(folder));
    }
    errorCount++;
    if (errors.length < 100) errors.push({ path: folder, message: error.message || String(error) });
  };
  const skip = target => { skipped.add(keyFor(target)); return false; };
  const inRememberedDeniedPath = target => [...denied.values()].some(blocked => inside(target, blocked));
  const boundaryIn = (target, base, metadata) => relativeSegments(target, base).some(name => sensitiveName(name, metadata));
  const selectedBase = target => allowedRoots.filter(root => inside(target, root)).sort((a, b) => b.length - a.length)[0];

  // Run BEFORE realpath/lstat/stat/readdir/readFile: do not touch a protected
  // boundary merely to learn whether the OS would let us access it.
  function allowed(target, { explicit = false, metadata = false } = {}) {
    target = normalize(target);
    if (paths === path.win32 && /^[a-z]:\\(?:scoop|chocolatey|programdata\\(?:scoop|chocolatey))(?:\\|$)/i.test(target)) return skip(target);
    if (installationRoots.some(root => insideInstallation(target, root))) return skip(target);
    const parts = segments(target).map(name => name.toLowerCase());
    if (parts.some((name, index) => CACHE_NAMES.has(name) ||
      (name === '.cargo' && ['git', 'registry'].includes(parts[index + 1])) ||
      (DEPENDENCY_NAMES.has(name) && !(metadata && name === '.git')))) return skip(target);
    if (mode === 'folder' && explicit) return true;
    if (inRememberedDeniedPath(target)) return skip(target);
    if (mode === 'full') {
      if (!inside(target, userHome)) return skip(target);
      const first = segments(target)[0];
      if (paths === path.win32 ? target.startsWith('\\\\') : REMOVABLE_ROOTS.has(first)) return skip(target);
      if (boundaryIn(target, userHome, metadata)) return skip(target);
      return true;
    }

    const base = selectedBase(target);
    if (base) {
      if (boundaryIn(target, base, metadata)) return skip(target);
      const relative = relativeSegments(target, base);
      // Selecting / or /Users does not opt into every child user/system volume.
      if (base === paths.parse(base).root && relative.length && (POSIX_SYSTEM_ROOTS.has(relative[0]) || REMOVABLE_ROOTS.has(relative[0]))) return skip(target);
      if (inside(homeParent, base) && inside(target, homeParent) && !inside(target, userHome) && !inside(userHome, target)) return skip(target);
      return true;
    }
    // Linked-worktree metadata may be in a normal project elsewhere in the
    // current home. A .git pointer cannot opt into a protected location.
    if (metadata && inside(target, userHome) && !boundaryIn(target, userHome, true)) return true;
    return skip(target);
  }

  // Follow aliases one step at a time. Check a symlink target before even
  // lstat'ing it, then use realpath for the filesystem's canonical spelling.
  async function guardedRealpath(target, options = {}) {
    let destination = normalize(target);
    if (!allowed(destination, options)) return null;
    let linkCount = 0;
    while (true) {
      let current = paths.parse(destination).root;
      const parts = segments(destination);
      let redirected = false;
      for (let index = 0; index < parts.length; index++) {
        current = paths.join(current, parts[index]);
        let stat;
        try { stat = await fs.lstat(current); }
        catch (error) { error.scanPath = current; throw error; }
        if (stat.isSymbolicLink()) {
          if (++linkCount > 40) throw Object.assign(new Error('심볼릭 링크가 순환하거나 너무 깊습니다.'), { code: 'ELOOP', scanPath: current });
          const link = await fs.readlink(current);
          destination = paths.resolve(paths.dirname(current), link, ...parts.slice(index + 1));
          if (!allowed(destination, options)) return null;
          redirected = true;
          break;
        }
      }
      if (redirected) continue;
      const canonical = await fs.realpath(destination);
      return allowed(canonical, options) ? canonical : null;
    }
  }

  const inodeIdentity = stat => stat.ino !== undefined && String(stat.ino) !== '0' && stat.dev !== undefined ? `inode:${String(stat.dev)}:${String(stat.ino)}` : null;

  async function metadataPath(target) {
    try { return await guardedRealpath(target, { metadata: true }); }
    catch (error) {
      if (!['ENOENT', 'ENOTDIR'].includes(error.code)) recordError(error.scanPath || target, error);
      return null;
    }
  }

  async function metadataStat(target) {
    const canonical = await metadataPath(target);
    if (!canonical) return null;
    try { return { canonical, stat: await fs.stat(canonical, { bigint: true }) }; }
    catch (error) {
      if (!['ENOENT', 'ENOTDIR'].includes(error.code)) recordError(canonical, error);
      return null;
    }
  }

  async function metadataRead(target, limit = 16384) {
    const entry = await metadataStat(target);
    if (!entry || !entry.stat.isFile() || entry.stat.size > BigInt(limit)) return null;
    try { return await fs.readFile(entry.canonical, 'utf8'); }
    catch (error) { recordError(entry.canonical, error); return null; }
  }

  async function gitDirectoryInfo(gitDir) {
    const gitEntry = await metadataStat(gitDir);
    if (!gitEntry?.stat.isDirectory()) return null;
    const head = await metadataRead(paths.join(gitEntry.canonical, 'HEAD'));
    if (!head || !/^(?:ref: refs\/[^\r\n]+|[a-f0-9]{40,64})\s*$/i.test(head)) return null;
    const commonPointer = await metadataRead(paths.join(gitEntry.canonical, 'commondir'));
    const common = commonPointer?.trim() ? await metadataStat(paths.resolve(gitEntry.canonical, commonPointer.trim())) : gitEntry;
    if (!common?.stat.isDirectory()) return null;
    const objects = await metadataStat(paths.join(common.canonical, 'objects'));
    if (!objects?.stat.isDirectory()) return null;
    const groupIdentity = inodeIdentity(common.stat) || `path:${keyFor(common.canonical)}`;
    if (!commonDirectoryGroups.has(groupIdentity)) commonDirectoryGroups.set(groupIdentity, common.canonical);
    return { groupKey: commonDirectoryGroups.get(groupIdentity), linkedWorktree: !!commonPointer?.trim() && keyFor(common.canonical) !== keyFor(gitEntry.canonical) };
  }

  async function repositoryAt(folder, entries) {
    const marker = entries.find(entry => entry.name === '.git');
    if (marker && !marker.isSymbolicLink()) {
      const markerPath = paths.join(folder, '.git');
      let info = null;
      if (marker.isDirectory()) info = await gitDirectoryInfo(markerPath);
      else if (marker.isFile()) {
        const pointer = (await metadataRead(markerPath))?.trim();
        if (pointer?.startsWith('gitdir: ')) info = await gitDirectoryInfo(paths.resolve(folder, pointer.slice(8)));
      }
      if (info) return { path: folder, name: paths.basename(folder), bare: false, ...info };
    }
    if (entries.some(entry => entry.name === 'HEAD' && entry.isFile()) && entries.some(entry => entry.name === 'objects' && entry.isDirectory()) && entries.some(entry => entry.name === 'config' && entry.isFile())) {
      const config = await metadataRead(paths.join(folder, 'config'), 262144);
      if (config && /^\s*bare\s*=\s*true\s*$/mi.test(config)) {
        const info = await gitDirectoryInfo(folder);
        if (info) return { path: folder, name: paths.basename(folder), bare: true, ...info };
      }
    }
    return null;
  }

  for (const root of explicitRoots) stack.push({ folder: root, depth: 0, explicit: true });
  const progress = async (currentPath, force = false) => {
    if (force || Date.now() - lastProgress > 200) {
      lastProgress = Date.now();
      await onProgress({ scannedDirectories, found: repositories.length, errorCount, skippedCount: skipped.size, currentPath, cancelled: !!signal?.aborted });
    }
  };
  await progress(null, true);
  while (stack.length && !signal?.aborted) {
    const { folder: candidate, depth, explicit } = stack.pop();
    let folder;
    let entries;
    try {
      folder = await guardedRealpath(candidate, { explicit: explicit && mode === 'folder' });
      if (!folder) continue;
      if (explicit && mode === 'folder' && !allowedRoots.some(root => keyFor(root) === keyFor(folder))) allowedRoots.push(folder);
      const canonicalKey = keyFor(folder);
      if (visitedPaths.has(canonicalKey)) { skip(candidate); continue; }
      const stat = await fs.stat(folder, { bigint: true });
      if (!stat.isDirectory()) { skip(folder); continue; }
      const identity = inodeIdentity(stat);
      if (identity && visitedIdentities.has(identity)) { skip(folder); continue; }
      visitedPaths.add(canonicalKey);
      if (identity) visitedIdentities.add(identity);
      entries = await fs.readdir(folder, { withFileTypes: true });
      if (explicit && mode === 'folder') {
        denied.delete(keyFor(candidate));
        denied.delete(canonicalKey);
      }
    } catch (error) { recordError(error.scanPath || folder || candidate, error); continue; }
    scannedDirectories++;
    const repository = await repositoryAt(folder, entries);
    if (repository) {
      repositories.push(repository);
      await onFound(repository);
    }
    await progress(folder);
    if (depth >= maxDepth || repository?.bare || signal?.aborted) continue;
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) {
        if (entry.isSymbolicLink()) skip(paths.join(folder, entry.name));
        continue;
      }
      const child = paths.join(folder, entry.name);
      if (!allowed(child)) continue;
      stack.push({ folder: child, depth: depth + 1, explicit: false });
    }
  }
  await progress(null, true);
  repositories.sort((a, b) => a.path.localeCompare(b.path));
  return { repositories, errors, errorCount, deniedPaths: [...denied.values()], skippedCount: skipped.size, scannedDirectories, cancelled: !!signal?.aborted };
}

module.exports = { discoverRepositories, getFullScanRoots };
