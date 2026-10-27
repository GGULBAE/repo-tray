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
