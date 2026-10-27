'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');
const run = promisify(execFile);
const { discoverRepositories, getFullScanRoots } = require('../src/core/discovery.cjs');

async function rootFor(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'repo-tray-discovery-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return await fs.realpath(root);
}

async function repository(folder, bare = false) {
  await fs.mkdir(folder, { recursive: true });
  await run('git', ['-C', folder, 'init', '--initial-branch=main', ...(bare ? ['--bare'] : [])]);
}

test('discovers ordinary, nested, linked worktree, and bare repos while skipping dependencies and duplicates', async t => {
  const root = await rootFor(t);
  const first = path.join(root, 'project');
  const nested = path.join(first, 'nested');
  const bare = path.join(root, 'mirror.git');
  const linked = path.join(root, 'linked');
  await repository(first);
  await run('git', ['-C', first, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'Initial']);
  await run('git', ['-C', first, 'worktree', 'add', '-b', 'worktree', linked]);
  await repository(nested);
  await repository(bare, true);
  await repository(path.join(root, 'node_modules', 'dependency'));
  await fs.mkdir(path.join(root, 'fake', '.git'), { recursive: true });
  const found = [];
  const progress = [];
  const result = await discoverRepositories({ roots: [root, first], onFound: repo => found.push(repo), onProgress: info => progress.push(info) });
  assert.deepEqual(result.repositories.map(repo => repo.path).sort(), [first, nested, bare, linked].sort());
  assert.equal(result.repositories.find(repo => repo.path === bare).bare, true);
  const mainInfo = result.repositories.find(repo => repo.path === first);
  const linkedInfo = result.repositories.find(repo => repo.path === linked);
  assert.equal(mainInfo.groupKey, path.join(first, '.git'));
  assert.equal(linkedInfo.groupKey, mainInfo.groupKey);
  assert.equal(mainInfo.linkedWorktree, false);
  assert.equal(linkedInfo.linkedWorktree, true);
  assert.notEqual(result.repositories.find(repo => repo.path === nested).groupKey, mainInfo.groupKey);
  assert.equal(found.length, 4);
  assert.equal(result.cancelled, false);
  assert.ok(progress.length >= 2);
  assert.equal(progress.at(-1).found, 4);
});

function within(target, folder) {
  const relative = path.relative(folder, String(target));
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}

function observeFilesystem(t, forbidden = []) {
  const calls = [];
  for (const name of ['realpath', 'lstat', 'stat', 'readdir', 'readFile', 'readlink']) {
    const original = fs[name];
    t.mock.method(fs, name, async function(target, ...args) {
      calls.push({ name, target: String(target) });
      if (forbidden.some(folder => within(target, folder))) throw Object.assign(new Error(`unexpected protected access: ${target}`), { code: 'EPERM' });
      return original.call(fs, target, ...args);
    });
  }
  return calls;
}

test('full roots use only the supplied home and never probe drives', async t => {
  const calls = observeFilesystem(t);
  assert.deepEqual(await getFullScanRoots({ home: '/homefake', platform: 'darwin' }), ['/homefake']);
  assert.deepEqual(await getFullScanRoots({ home: 'C:\\Users\\test', platform: 'win32' }), ['C:\\Users\\test']);
  assert.deepEqual(calls, []);
});

test('full mode rejects protected, cloud, removable, system and other-user roots before any filesystem call', async t => {
  const calls = observeFilesystem(t, ['/homefake', '/Volumes', '/System', '/other-user']);
  const roots = ['Desktop', 'Documents', 'Downloads', 'Library', 'Pictures', 'Movies', 'Music', '.codex', '.config', 'OneDrive - Work', 'Dropbox'].map(name => path.join('/homefake', name));
  roots.push('/Volumes/External', '/System', '/other-user/repo');
  const result = await discoverRepositories({ roots, home: '/homefake', platform: 'darwin', mode: 'full' });
  assert.deepEqual(result.repositories, []);
  assert.equal(result.errorCount, 0);
  assert.equal(result.skippedCount, roots.length);
  assert.deepEqual(calls, []);
});

test('Windows full search rejects protected folders, other drives and UNC roots without probing them', async t => {
  const calls = observeFilesystem(t);
  const home = 'C:\\Users\\test';
  const roots = ['Desktop', 'Documents', 'Downloads', 'AppData', 'Pictures', 'Music', 'Videos', 'OneDrive - Company'].map(name => path.win32.join(home, name));
  roots.push('C:\\Windows', 'C:\\Users\\another', 'D:\\projects', '\\\\server\\share\\projects');
  const result = await discoverRepositories({ roots, home, platform: 'win32', mode: 'full' });
  assert.deepEqual(result.repositories, []);
  assert.equal(result.errorCount, 0);
  assert.equal(result.skippedCount, roots.length);
  assert.deepEqual(calls, []);
});

test('full home search finds ordinary projects while never touching protected children', async t => {
  const home = await rootFor(t);
  const safe = path.join(home, 'Dev', 'project');
  await repository(safe);
  const protectedFolders = ['Desktop', 'Documents', 'Downloads', 'Library', 'Pictures', 'Movies', 'Music', 'OneDrive - Work', '.codex'].map(name => path.join(home, name));
  for (const folder of protectedFolders) await repository(path.join(folder, 'hidden-repo'));
  const calls = observeFilesystem(t, protectedFolders);
  const progress = [];
  const result = await discoverRepositories({ roots: [home], home, platform: 'darwin', mode: 'full', onProgress: value => progress.push(value) });
  assert.deepEqual(result.repositories.map(repo => repo.path), [safe]);
  assert.equal(result.errorCount, 0);
  assert.ok(result.skippedCount >= protectedFolders.length);
  assert.ok(progress.at(-1).skippedCount >= protectedFolders.length);
  assert.equal(calls.some(call => protectedFolders.some(folder => within(call.target, folder))), false);
});

test('folder mode permits an explicitly selected Documents root but excludes child protected boundaries', async t => {
  const home = await rootFor(t);
  const selected = path.join(home, 'Documents');
  const safe = path.join(selected, 'Dev', 'project');
  await repository(safe);
  const excluded = ['Library', 'Dropbox', '.cache', 'Downloads'].map(name => path.join(selected, name));
  for (const folder of excluded) await repository(path.join(folder, 'other-repo'));
  const calls = observeFilesystem(t, excluded);
  const result = await discoverRepositories({ roots: [selected], home, platform: 'darwin', mode: 'folder' });
  assert.deepEqual(result.repositories.map(repo => repo.path), [safe]);
  assert.equal(result.errorCount, 0);
  assert.equal(calls.some(call => excluded.some(folder => within(call.target, folder))), false);
});

test('a .git pointer or its symlink cannot bypass full-search protection', { skip: process.platform === 'win32' }, async t => {
  const home = await rootFor(t);
  const protectedRoot = path.join(home, 'Documents');
  const source = path.join(protectedRoot, 'main');
  await repository(source);
  const direct = path.join(home, 'direct-pointer');
  const indirect = path.join(home, 'indirect-pointer');
  const alias = path.join(home, 'metadata-alias');
  await fs.mkdir(direct);
  await fs.mkdir(indirect);
  await fs.writeFile(path.join(direct, '.git'), `gitdir: ${path.join(source, '.git')}\n`);
  await fs.symlink(path.join(source, '.git'), alias, 'dir');
  await fs.writeFile(path.join(indirect, '.git'), `gitdir: ${alias}\n`);
  const calls = observeFilesystem(t, [protectedRoot]);
  const result = await discoverRepositories({ roots: [home], home, platform: 'darwin', mode: 'full' });
  assert.deepEqual(result.repositories, []);
  assert.equal(result.errorCount, 0);
  assert.equal(calls.some(call => within(call.target, protectedRoot)), false);
});

test('canonical aliases and overlapping roots produce one discovery', { skip: process.platform === 'win32' }, async t => {
  const root = await rootFor(t);
  const project = path.join(root, 'project');
  const alias = path.join(root, 'alias');
  await repository(project);
  await fs.symlink(project, alias, 'dir');
  const result = await discoverRepositories({ roots: [root, project, alias, root], home: root, mode: 'folder' });
  assert.deepEqual(result.repositories.map(repo => repo.path), [project]);
  assert.ok(result.skippedCount >= 1);
});

test('device/inode identity deduplicates volume aliases even when realpath spellings differ', async t => {
  const root = await rootFor(t);
  const first = path.join(root, 'volume-one');
  const second = path.join(root, 'volume-two');
  await repository(first);
  await repository(second);
  const originalStat = fs.stat;
  t.mock.method(fs, 'stat', async (target, options) => {
    const result = await originalStat(target, options);
    if (target === first || target === second) return new Proxy(result, { get(value, key) { if (key === 'dev') return 123n; if (key === 'ino') return 456n; return Reflect.get(value, key); } });
    return result;
  });
  const result = await discoverRepositories({ roots: [first, second], home: root });
  assert.equal(result.repositories.length, 1);
  assert.equal(result.scannedDirectories, 1);
});

test('Windows zero-inode fallback keeps independent clones separate and ignores repeated canonical paths', async t => {
  const root = await rootFor(t);
  const first = path.join(root, 'one');
  const second = path.join(root, 'two');
  await repository(first);
  await repository(second);
  const originalStat = fs.stat;
  t.mock.method(fs, 'stat', async (target, options) => {
    const result = await originalStat(target, options);
    return new Proxy(result, { get(value, key) { return key === 'ino' ? 0n : Reflect.get(value, key); } });
  });
  const result = await discoverRepositories({ roots: [first, second, first], home: root, platform: 'win32' });
  assert.equal(result.repositories.length, 2);
  assert.notEqual(result.repositories[0].groupKey, result.repositories[1].groupKey);
});

test('permission-denied paths persist across scans, are skipped before I/O, and explicit successful retries clear only that path', async t => {
  const home = await rootFor(t);
  const locked = path.join(home, 'locked');
  const unrelated = path.join(home, 'previously-denied');
  await repository(locked);
  const originalReaddir = fs.readdir;
  const failure = t.mock.method(fs, 'readdir', async (target, options) => {
    if (target === locked) throw Object.assign(new Error('access denied'), { code: 'EACCES' });
    return originalReaddir(target, options);
  });
  const first = await discoverRepositories({ roots: [home], home, mode: 'full', deniedPaths: [unrelated] });
  assert.deepEqual(new Set(first.deniedPaths), new Set([locked, unrelated]));
  failure.mock.restore();
  const calls = observeFilesystem(t, [locked]);
  const second = await discoverRepositories({ roots: [home], home, mode: 'full', deniedPaths: first.deniedPaths });
  assert.equal(calls.some(call => within(call.target, locked)), false);
  assert.equal(second.errorCount, 0);
  assert.deepEqual(new Set(second.deniedPaths), new Set(first.deniedPaths));
  t.mock.restoreAll();
  const retried = await discoverRepositories({ roots: [locked], home, mode: 'folder', deniedPaths: second.deniedPaths });
  assert.deepEqual(retried.repositories.map(repo => repo.path), [locked]);
  assert.deepEqual(retried.deniedPaths, [unrelated]);
});

test('cancelled and unrelated folder scans retain prior denied paths with the 500-entry bound', async t => {
  const root = await rootFor(t);
  await repository(root);
  const deniedPaths = Array.from({ length: 600 }, (_, index) => path.join(root, 'denied-' + index));
  const controller = new AbortController();
  controller.abort();
  const cancelled = await discoverRepositories({ roots: [root], home: root, deniedPaths, signal: controller.signal });
  assert.equal(cancelled.deniedPaths.length, 500);
  assert.equal(cancelled.cancelled, true);
  const completed = await discoverRepositories({ roots: [root], home: root, mode: 'folder', deniedPaths: cancelled.deniedPaths });
  assert.equal(completed.repositories.length, 1);
  assert.deepEqual(completed.deniedPaths, cancelled.deniedPaths);
});

test('does not follow symlink loops or directory aliases', { skip: process.platform === 'win32' }, async t => {
  const root = await rootFor(t);
  await repository(path.join(root, 'real'));
  await fs.symlink(root, path.join(root, 'loop'), 'dir');
  await fs.symlink(path.join(root, 'real'), path.join(root, 'alias'), 'dir');
  const result = await discoverRepositories({ roots: [root] });
  assert.equal(result.repositories.length, 1);
  assert.ok(result.scannedDirectories < 5);
});

test('cancellation stops scanning and returns already found repositories', async t => {
  const root = await rootFor(t);
  await repository(path.join(root, 'one'));
  await repository(path.join(root, 'two'));
  const controller = new AbortController();
  const result = await discoverRepositories({ roots: [root], signal: controller.signal, onFound: () => controller.abort() });
  assert.equal(result.cancelled, true);
  assert.equal(result.repositories.length, 1);
});

test('depth limit, nonexistent roots, and invalid inputs produce bounded useful results', async t => {
  const root = await rootFor(t);
  await repository(path.join(root, 'level1', 'level2'));
  const result = await discoverRepositories({ roots: [root, path.join(root, 'missing')], maxDepth: 1 });
  assert.deepEqual(result.repositories, []);
  assert.equal(result.errorCount, 1);
  assert.equal(result.errors[0].path, path.join(root, 'missing'));
  await assert.rejects(discoverRepositories({ roots: ['relative'] }), TypeError);
  await assert.rejects(discoverRepositories({ roots: [root], maxDepth: -1 }), TypeError);
});

test('explicit Homebrew installation roots and macOS Data aliases are excluded before filesystem access', { skip: process.platform === 'win32' }, async t => {
  const calls = observeFilesystem(t);
  const roots = ['/homebrew', '/opt/homebrew/Library/Taps/homebrew/homebrew-core', '/usr/local/Homebrew', '/usr/local/Cellar/tool', '/usr/local/Caskroom/tool', '/home/linuxbrew/.linuxbrew'];
  roots.push(...roots.map(root => '/System/Volumes/Data' + root), '/OPT/HOMEBREW');
  const result = await discoverRepositories({ roots, home: '/homefake', platform: 'darwin', mode: 'folder', environment: {} });
  assert.deepEqual(result.repositories, []);
  assert.equal(result.errorCount, 0);
  assert.equal(result.skippedCount, roots.length);
  assert.deepEqual(calls, []);
});

test('home tool roots and editor package stores cannot be opted into with explicit selection', async t => {
  const home = '/homefake';
  const roots = ['.homebrew', '.linuxbrew', '.nvm', '.pyenv', '.rbenv', '.asdf', '.sdkman', '.oh-my-zsh', '.oh-my-fish', '.oh-my-bash', '.zplug', '.zinit', '.vscode/extensions/plugin', '.cursor/extensions/plugin', '.local/share/nvim/lazy/plugin', '.local/share/nvim/site/pack/vendor', '.vim/plugged/plugin'].map(name => path.posix.join(home, name));
  if (process.platform !== 'win32') roots.push('/System/Volumes/Data/homefake/.nvm/versions');
  const calls = observeFilesystem(t);
  const result = await discoverRepositories({ roots, home, platform: 'darwin', mode: 'folder', environment: {} });
  assert.deepEqual(result.repositories, []);
  assert.equal(result.errorCount, 0);
  assert.equal(result.skippedCount, roots.length);
  assert.deepEqual(calls, []);
});

test('Windows Scoop and Chocolatey installations on any drive are excluded before filesystem access', async t => {
  const home = 'D:\\Users\\test';
  const roots = [home + '\\scoop\\apps\\git', home + '\\SCOOP\\buckets\\main', 'C:\\scoop\\apps', 'E:\\Scoop\\buckets', 'C:\\ProgramData\\scoop', 'C:\\ProgramData\\Chocolatey\\lib', 'E:\\Chocolatey', 'F:\\custom-scoop\\buckets', 'G:\\custom-choco\\lib'];
  const calls = observeFilesystem(t);
  const result = await discoverRepositories({ roots, home, platform: 'win32', mode: 'folder', environment: { SCOOP_GLOBAL: 'F:\\custom-scoop', ChocolateyInstall: 'G:\\custom-choco' } });
  assert.deepEqual(result.repositories, []);
  assert.equal(result.errorCount, 0);
  assert.equal(result.skippedCount, roots.length);
  assert.deepEqual(calls, []);
});

test('explicit dependency and cache roots are excluded while Git metadata remains supported', async t => {
  const home = '/homefake';
  const roots = ['node_modules/package', '.cache/package', '.npm/package', '.pnpm-store/package', '.yarn/package', '.cargo/git/checkouts/package', '.cargo/registry/src/package', '.rustup/toolchains', '.gradle/caches', '.m2/repository', '.nuget/packages', '.venv/package', 'venv/package', '__pycache__', '.git'].map(name => path.posix.join(home, 'Project', name));
  const calls = observeFilesystem(t);
  const result = await discoverRepositories({ roots, home, platform: 'darwin', mode: 'folder', environment: {} });
  assert.deepEqual(result.repositories, []);
  assert.equal(result.errorCount, 0);
  assert.equal(result.skippedCount, roots.length);
  assert.deepEqual(calls, []);
});

test('ordinary contribution clones and similarly named nested projects remain discoverable', async t => {
  const home = await rootFor(t);
  const projects = ['Projects/homebrew', 'Projects/scoop', 'Projects/.nvm', 'Projects/homebrew-extra', 'Homebrew'].map(name => path.join(home, ...name.split('/')));
  for (const project of projects) await repository(project);
  await run('git', ['-C', projects[0], 'remote', 'add', 'origin', 'https://github.com/Homebrew/brew.git']);
  const managed = path.join(home, '.nvm');
  await repository(path.join(managed, 'installed'));
  const calls = observeFilesystem(t, [managed]);
  const result = await discoverRepositories({ roots: [home], home, mode: 'full', environment: {} });
  assert.deepEqual(result.repositories.map(repo => repo.path).sort(), projects.sort());
  assert.equal(result.errorCount, 0);
  assert.equal(calls.some(call => within(call.target, managed)), false);
});

test('explicit user configuration and Codex worktree projects are not mistaken for tool installations', async t => {
  const home = await rootFor(t);
  const projects = ['.config/nvim', '.local/projects/custom-tool', '.codex/worktrees/project', 'Projects/.cargo'].map(name => path.join(home, ...name.split('/')));
  for (const project of projects) await repository(project);
  const result = await discoverRepositories({ roots: projects, home, mode: 'folder', environment: {} });
  assert.deepEqual(result.repositories.map(repo => repo.path).sort(), projects.sort());
  assert.equal(result.errorCount, 0);
});

test('custom installation prefixes are excluded in full and folder modes before touching their contents', async t => {
  const home = await rootFor(t);
  const safe = path.join(home, 'Projects', 'app');
  const managed = ['brew-install', 'brew-repository', 'brew-cellar', 'scoop-install', 'scoop-global', 'choco-install'].map(name => path.join(home, 'Tools', name));
  const names = ['HOMEBREW_PREFIX', 'HOMEBREW_REPOSITORY', 'HOMEBREW_CELLAR', 'SCOOP', 'SCOOP_GLOBAL', 'ChocolateyInstall'];
  const environment = Object.fromEntries(names.map((name, index) => [name, managed[index]]));
  await repository(safe);
  for (const folder of managed) await repository(path.join(folder, 'installed'));
  const calls = observeFilesystem(t, managed);
  for (const mode of ['full', 'folder']) {
    const result = await discoverRepositories({ roots: [home, ...managed], home, mode, environment });
    assert.deepEqual(result.repositories.map(repo => repo.path), [safe]);
    assert.equal(result.errorCount, 0);
  }
  if (process.platform !== 'win32') {
    const alias = await discoverRepositories({ roots: ['/System/Volumes/Data' + managed[0]], home, platform: 'darwin', mode: 'folder', environment });
    assert.equal(alias.scannedDirectories, 0);
    assert.equal(alias.errorCount, 0);
  }
  assert.equal(calls.some(call => managed.some(folder => within(call.target, folder)) || call.target.startsWith('/System')), false);
});

test('invalid or overly broad installation environment values cannot hide user projects', async t => {
  const home = await rootFor(t);
  const project = path.join(home, 'Projects', 'app');
  await repository(project);
  const environment = { HOMEBREW_PREFIX: home, HOMEBREW_REPOSITORY: path.dirname(home), HOMEBREW_CELLAR: path.parse(home).root, SCOOP: 'relative/path', SCOOP_GLOBAL: '', ChocolateyInstall: null, NVM_DIR: home + '\0bad', PYENV_ROOT: ' ' + home, ASDF_DIR: 123 };
  const result = await discoverRepositories({ roots: [home], home, mode: 'full', environment });
  assert.deepEqual(result.repositories.map(repo => repo.path), [project]);
  assert.equal(result.errorCount, 0);
});

test('Git metadata pointers cannot opt into a dependency checkout', async t => {
  const home = await rootFor(t);
  const dependency = path.join(home, 'node_modules', 'package');
  const project = path.join(home, 'metadata-pointer');
  await repository(dependency);
  await fs.mkdir(project);
  await fs.writeFile(path.join(project, '.git'), `gitdir: ${path.join(dependency, '.git')}\n`);
  const calls = observeFilesystem(t, [dependency]);
  const result = await discoverRepositories({ roots: [home, project], home, mode: 'folder', environment: {} });
  assert.deepEqual(result.repositories, []);
  assert.equal(result.errorCount, 0);
  assert.equal(calls.some(call => within(call.target, dependency)), false);
});

test('explicit aliases and Git metadata pointers cannot enter custom installations', { skip: process.platform === 'win32' }, async t => {
  const home = await rootFor(t);
  const managed = path.join(home, 'Tools', 'brew');
  const source = path.join(managed, 'repository');
  await repository(source);
  const alias = path.join(home, 'installed-alias');
  const metadataAlias = path.join(home, 'metadata-alias');
  await fs.symlink(source, alias, 'dir');
  await fs.symlink(path.join(source, '.git'), metadataAlias, 'dir');
  const direct = path.join(home, 'direct');
  const indirect = path.join(home, 'indirect');
  const common = path.join(home, 'common-pointer');
  const objects = path.join(home, 'objects-pointer');
  for (const folder of [direct, indirect]) await fs.mkdir(folder);
  await fs.writeFile(path.join(direct, '.git'), `gitdir: ${path.join(source, '.git')}\n`);
  await fs.writeFile(path.join(indirect, '.git'), `gitdir: ${metadataAlias}\n`);
  await repository(common);
  await fs.writeFile(path.join(common, '.git', 'commondir'), path.join(source, '.git') + '\n');
  await repository(objects);
  await fs.rm(path.join(objects, '.git', 'objects'), { recursive: true, force: true });
  await fs.symlink(path.join(source, '.git', 'objects'), path.join(objects, '.git', 'objects'), 'dir');
  const calls = observeFilesystem(t, [managed]);
  const result = await discoverRepositories({ roots: [home, alias], home, mode: 'folder', environment: { HOMEBREW_PREFIX: managed } });
  assert.deepEqual(result.repositories, []);
  assert.equal(result.errorCount, 0);
  assert.equal(calls.some(call => within(call.target, managed)), false);
});
