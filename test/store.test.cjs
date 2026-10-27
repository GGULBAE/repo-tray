'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStore, createRepository, canonicalPath, lexicalAbsolutePath, repositoryId, normalizeInterval, MAX_DENIED_PATHS } = require('../src/core/store.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-tray-store-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, file: path.join(root, 'state', 'settings.json') };
}

test('new store defaults to login launch and a 60 minute interval', t => {
  const { file } = fixture(t);
  const store = createStore(file);
  assert.deepEqual(store.read(), { version: 1, settings: { defaultIntervalMinutes: 60, launchAtLogin: true }, scanPreferences: { deniedPaths: [] }, repositories: [] });
  assert.deepEqual(store.warnings, []);
  assert.equal(fs.existsSync(file), false);
});

test('atomic persistence keeps supported data, stable IDs, and no credentials', t => {
  const { root, file } = fixture(t);
  const store = createStore(file);
  const repo = createRepository(root, { name: 'My source', intervalMinutes: 300, lastCheckedAt: 1234 });
  const input = { version: 1, settings: { defaultIntervalMinutes: 1440, launchAtLogin: false }, repositories: [{ ...repo, token: 'not-a-real-token', password: 'should-not-be-saved' }] };
  store.write(input);
  const read = store.read();
  assert.equal(read.repositories[0].id, repositoryId(root));
  assert.equal(read.repositories[0].lastCheckedAt, 1234);
  assert.equal(read.repositories[0].intervalMinutes, 300);
  assert.equal(read.settings.launchAtLogin, false);
  assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /token|password|should-not-be-saved/);
  assert.equal(fs.readdirSync(path.dirname(file)).filter(name => name.endsWith('.tmp')).length, 0);
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

test('corrupt settings are backed up byte-for-byte before returning defaults', t => {
  const { file } = fixture(t);
  fs.mkdirSync(path.dirname(file));
  const corrupt = '{"repositories":[bad json';
  fs.writeFileSync(file, corrupt);
  const store = createStore(file);
  assert.equal(store.read().repositories.length, 0);
  assert.equal(fs.readFileSync(store.backupPath, 'utf8'), corrupt);
  assert.equal(fs.readFileSync(file, 'utf8'), corrupt);
  assert.match(store.warnings[0], /보관/);
});

test('invalid records are skipped on read, duplicate paths collapse, bad writes preserve previous file', t => {
  const { root, file } = fixture(t);
  const store = createStore(file);
  store.write({ repositories: [createRepository(root)] });
  const original = fs.readFileSync(file, 'utf8');
  assert.throws(() => store.write({ repositories: [{ path: root, intervalMinutes: 0 }] }), /조회 주기/);
  assert.equal(fs.readFileSync(file, 'utf8'), original);
  fs.writeFileSync(file, JSON.stringify({ settings: { defaultIntervalMinutes: 0 }, repositories: [null, { path: 'relative' }, { path: root }, { path: path.join(root, '.') }] }));
  assert.equal(store.read().repositories.length, 1);
  assert.equal(store.warnings.length, 3);
});

test('absolute canonical paths and bounded integer intervals are enforced', t => {
  const { root } = fixture(t);
  assert.equal(canonicalPath(path.join(root, 'nested', '..')), canonicalPath(root));
  assert.equal(repositoryId(root), repositoryId(path.join(root, '.')));
  assert.throws(() => canonicalPath('relative'));
  assert.throws(() => canonicalPath(`${root}\0bad`));
  for (const value of [0, -1, 10081, 1.5, 'bad', Infinity]) assert.throws(() => normalizeInterval(value));
  for (const value of [1, 60, 300, 1440, 10080]) assert.equal(normalizeInterval(value), value);
});

test('read failures cannot cause a later save to overwrite unknown existing settings', t => {
  const { root, file } = fixture(t);
  const store = createStore(file);
  store.write({ repositories: [createRepository(root)] });
  const original = fs.readFileSync(file, 'utf8');
  const actualRead = fs.readFileSync;
  const mocked = t.mock.method(fs, 'readFileSync', function (target, ...args) {
    if (target === file) throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
    return actualRead.call(fs, target, ...args);
  });
  assert.equal(store.read().repositories.length, 0);
  mocked.mock.restore();
  assert.throws(() => store.write({ repositories: [] }), /덮어쓰기를 중단/);
  assert.equal(fs.readFileSync(file, 'utf8'), original);
  assert.equal(store.read().repositories.length, 1);
  assert.doesNotThrow(() => store.write({ repositories: [] }));
});

test('failed corrupt-file backup blocks writes that would erase the original', t => {
  const { file } = fixture(t);
  fs.mkdirSync(path.dirname(file));
  fs.writeFileSync(file, 'broken json');
  const store = createStore(file);
  const mocked = t.mock.method(fs, 'copyFileSync', () => { throw new Error('no space'); });
  store.read();
  mocked.mock.restore();
  assert.throws(() => store.write({ repositories: [] }), /원본을 보관하지 못해/);
  assert.equal(fs.readFileSync(file, 'utf8'), 'broken json');
});

test('denied paths persist across restart with lexical normalization and duplicate removal', t => {
  const { root, file } = fixture(t);
  const denied = path.join(root, 'denied');
  const store = createStore(file);
  store.write({ scanPreferences: { deniedPaths: [denied, `${denied}${path.sep}`, path.join(denied, 'child', '..')] } });
  assert.deepEqual(createStore(file).read().scanPreferences, { deniedPaths: [denied] });
  assert.equal(lexicalAbsolutePath(path.parse(root).root), path.parse(root).root);
});

test('denied paths and group keys are never resolved or statted while saving and loading', t => {
  const { root, file } = fixture(t);
  const denied = path.join(root, 'Protected Documents');
  const groupKey = path.join(root, 'Protected Git Directory');
  const store = createStore(file);
  const probed = new Set([denied, groupKey]);
  const forbiddenCalls = [];
  for (const [object, method] of [[fs.realpathSync, 'native'], [fs, 'statSync'], [fs, 'lstatSync'], [fs, 'readdirSync']]) {
    const original = object[method];
    t.mock.method(object, method, function (candidate, ...args) {
      if (probed.has(candidate)) { forbiddenCalls.push(candidate); throw new Error('would ask for access'); }
      return original.call(this, candidate, ...args);
    });
  }
  store.write({ scanPreferences: { deniedPaths: [denied] }, repositories: [createRepository(root, { groupKey })] });
  const loaded = store.read();
  assert.deepEqual(loaded.scanPreferences.deniedPaths, [denied]);
  assert.equal(loaded.repositories[0].groupKey, groupKey);
  assert.deepEqual(forbiddenCalls, []);
});

test('denied-path validation rejects invalid writes and caps retained paths at 500 on read', t => {
  const { root, file } = fixture(t);
  const store = createStore(file);
  for (const value of ['relative', `${root}\0bad`, null, 42, {}]) {
    assert.throws(() => store.write({ scanPreferences: { deniedPaths: [value] } }), /절대 경로/);
  }
  assert.throws(() => store.write({ scanPreferences: { deniedPaths: 'bad' } }), /목록 형식/);
  const tooMany = Array.from({ length: MAX_DENIED_PATHS + 1 }, (_, index) => path.join(root, String(index)));
  assert.throws(() => store.write({ scanPreferences: { deniedPaths: tooMany } }), /최대 500/);
  fs.mkdirSync(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify({ scanPreferences: { deniedPaths: tooMany } }));
  assert.equal(store.read().scanPreferences.deniedPaths.length, 500);
  assert.match(store.warnings[0], /처음 500/);
  fs.writeFileSync(file, JSON.stringify({ scanPreferences: { deniedPaths: [root, 'relative', `${root}\0bad`] } }));
  assert.deepEqual(store.read().scanPreferences.deniedPaths, [root]);
  assert.equal(store.warnings.length, 2);
});

test('legacy repositories get null group keys and existing linked worktrees remain registered', t => {
  const { root, file } = fixture(t);
  const mainPath = path.join(root, 'main');
  const worktreePath = path.join(root, 'feature');
  fs.mkdirSync(mainPath); fs.mkdirSync(worktreePath);
  const sharedGitDir = path.join(mainPath, '.git');
  const store = createStore(file);
  store.write({ repositories: [createRepository(mainPath, { groupKey: sharedGitDir }), createRepository(worktreePath, { groupKey: sharedGitDir })] });
  let loaded = store.read();
  assert.equal(loaded.repositories.length, 2);
  assert.equal(loaded.repositories[0].groupKey, sharedGitDir);
  assert.equal(loaded.repositories[1].groupKey, sharedGitDir);
  fs.writeFileSync(file, JSON.stringify({ repositories: [{ path: mainPath }, { path: worktreePath }] }));
  loaded = store.read();
  assert.deepEqual(loaded.scanPreferences, { deniedPaths: [] });
  assert.deepEqual(loaded.repositories.map(repo => repo.groupKey), [null, null]);
});

test('invalid group keys are rejected on write and cleared without removing repositories on read', t => {
  const { root, file } = fixture(t);
  const store = createStore(file);
  assert.throws(() => createRepository(root, { groupKey: 'relative' }), /절대 경로/);
  assert.throws(() => store.write({ repositories: [{ path: root, groupKey: `${root}\0bad` }] }), /절대 경로/);
  fs.mkdirSync(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify({ repositories: [{ path: root, groupKey: 'relative' }] }));
  const loaded = store.read();
  assert.equal(loaded.repositories.length, 1);
  assert.equal(loaded.repositories[0].groupKey, null);
  assert.match(store.warnings[0], /그룹 경로/);
});

test('repository aliases resolving to the same real directory keep one stable ID', t => {
  const { root, file } = fixture(t);
  const real = path.join(root, 'source');
  const alias = path.join(root, 'alias');
  fs.mkdirSync(real);
  fs.symlinkSync(real, alias, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(repositoryId(real), repositoryId(alias));
  const store = createStore(file);
  store.write({ repositories: [createRepository(real), createRepository(alias)] });
  assert.equal(store.read().repositories.length, 1);
});

test('case aliases on case-insensitive volumes retain the same repository ID', t => {
  const { root, file } = fixture(t);
  const original = path.join(root, 'MixedCaseRepository');
  const alias = path.join(root, 'mixedcaserepository');
  fs.mkdirSync(original);
  if (!fs.existsSync(alias)) return t.skip('This volume has case-sensitive directory names.');
  const actual = fs.statSync(original);
  const alternate = fs.statSync(alias);
  assert.equal(actual.dev, alternate.dev);
  assert.equal(actual.ino, alternate.ino);
  assert.equal(repositoryId(original), repositoryId(alias));
  const store = createStore(file);
  store.write({ repositories: [createRepository(original), createRepository(alias)] });
  assert.equal(store.read().repositories.length, 1);
});
