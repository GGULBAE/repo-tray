'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);
const { inspectRepository, getRepositoryGroup, fetchRepository, synchronizeRepository, abortOperation } = require('../src/core/git.cjs');

// Fixture commands and the Git engine must use the same isolated configuration.
// In particular, a Windows host's core.autocrlf must not change fixture contents.
process.env.GIT_CONFIG_NOSYSTEM = '1';
process.env.GIT_CONFIG_GLOBAL = os.devNull;
process.env.GIT_TERMINAL_PROMPT = '0';
const git = async (directory, ...args) => (await run('git', ['-C', directory, ...args])).stdout.trim();

async function identity(directory) {
  await git(directory, 'config', 'user.name', 'Repo Tray Test');
  await git(directory, 'config', 'user.email', 'test@example.invalid');
  await git(directory, 'config', 'commit.gpgsign', 'false');
}

async function commit(directory, filename, content, message = 'Change') {
  await fs.writeFile(path.join(directory, filename), content);
  await git(directory, 'add', '--', filename);
  await git(directory, 'commit', '-m', message);
}

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'repo-tray-git-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const remote = path.join(root, 'remote.git');
  const writer = path.join(root, 'writer repo');
  const reader = path.join(root, 'reader repo');
  await fs.mkdir(remote);
  await git(remote, 'init', '--bare', '--initial-branch=main');
  await git(root, 'clone', remote, writer);
  await identity(writer);
  await commit(writer, 'shared.txt', 'initial\n', 'Initial commit');
  await git(writer, 'push', '-u', 'origin', 'main');
  await git(root, 'clone', remote, reader);
  await identity(reader);
  return { root, remote, writer, reader };
}

test('fetch discovers incoming commits without changing working files; explicit sync fast-forwards', async t => {
  const { writer, reader } = await fixture(t);
  await commit(writer, 'shared.txt', 'remote change\n', '원격 업데이트');
  await git(writer, 'push');
  const fetched = await fetchRepository(reader);
  assert.equal(fetched.branch, 'main');
  assert.equal(fetched.upstream, 'origin/main');
  assert.equal(fetched.behind, 1);
  assert.equal(fetched.ahead, 0);
  assert.equal(fetched.incomingCommits[0].subject, '원격 업데이트');
  assert.equal(await fs.readFile(path.join(reader, 'shared.txt'), 'utf8'), 'initial\n');
  const synced = await synchronizeRepository(reader, 'ff-only');
  assert.equal(synced.behind, 0);
  assert.equal(synced.dirty, false);
  assert.equal(synced.syncSucceeded, true);
  assert.equal(await fs.readFile(path.join(reader, 'shared.txt'), 'utf8'), 'remote change\n');
});

test('sync refuses tracked and untracked changes, preserving local work', async t => {
  const { writer, reader } = await fixture(t);
  await commit(writer, 'shared.txt', 'remote\n');
  await git(writer, 'push');
  await fs.writeFile(path.join(reader, 'shared.txt'), 'unfinished local\n');
  await fs.writeFile(path.join(reader, 'untracked.txt'), 'keep me');
  const state = await fetchRepository(reader);
  assert.equal(state.dirty, true);
  assert.equal(state.behind, 1);
  assert.equal(state.changedFiles.length, 2);
  await assert.rejects(synchronizeRepository(reader, 'merge'), error => error.code === 'DIRTY_WORKTREE');
  assert.equal(await fs.readFile(path.join(reader, 'shared.txt'), 'utf8'), 'unfinished local\n');
  assert.equal(await fs.readFile(path.join(reader, 'untracked.txt'), 'utf8'), 'keep me');
});

test('divergence requires explicit merge; successful merge preserves both histories', async t => {
  const { writer, reader } = await fixture(t);
  await commit(writer, 'remote.txt', 'remote\n', 'Remote commit');
  await git(writer, 'push');
  await commit(reader, 'local.txt', 'local\n', 'Local commit');
  const originalHead = await git(reader, 'rev-parse', 'HEAD');
  await assert.rejects(synchronizeRepository(reader, 'ff-only'), error => error.code === 'DIVERGED');
  assert.equal(await git(reader, 'rev-parse', 'HEAD'), originalHead);
  const merged = await synchronizeRepository(reader, 'merge');
  assert.equal(merged.behind, 0);
  assert.equal(merged.ahead, 2);
  assert.equal(merged.operation, null);
  assert.equal(await fs.readFile(path.join(reader, 'local.txt'), 'utf8'), 'local\n');
  assert.equal(await fs.readFile(path.join(reader, 'remote.txt'), 'utf8'), 'remote\n');
  assert.equal((await git(reader, 'rev-list', '--parents', '-n', '1', 'HEAD')).split(' ').length, 3);
});

for (const strategy of ['merge', 'rebase']) {
  test(`${strategy} reports conflicts and explicit abort restores the original local commit`, async t => {
    const { writer, reader } = await fixture(t);
    await commit(writer, 'shared.txt', 'remote conflict\n', 'Remote conflict');
    await git(writer, 'push');
    await commit(reader, 'shared.txt', 'local conflict\n', 'Local conflict');
    const initialHead = await git(reader, 'rev-parse', 'HEAD');
    const result = await synchronizeRepository(reader, strategy);
    assert.equal(result.syncSucceeded, false);
    assert.equal(result.operation, strategy);
    assert.deepEqual(result.conflicts, ['shared.txt']);
    assert.ok(result.syncError);
    await assert.rejects(synchronizeRepository(reader, 'ff-only'), error => error.code === 'OPERATION_IN_PROGRESS');
    const aborted = await abortOperation(reader);
    assert.equal(aborted.operation, null);
    assert.deepEqual(aborted.conflicts, []);
    assert.equal(aborted.dirty, false);
    assert.equal(aborted.head, initialHead);
    assert.equal(await fs.readFile(path.join(reader, 'shared.txt'), 'utf8'), 'local conflict\n');
  });
}

test('rebase explicitly replays local commits on the newly fetched remote', async t => {
  const { writer, reader } = await fixture(t);
  await commit(writer, 'remote.txt', 'remote');
  await git(writer, 'push');
  await commit(reader, 'local.txt', 'local');
  const oldHead = await git(reader, 'rev-parse', 'HEAD');
  const result = await synchronizeRepository(reader, 'rebase');
  assert.equal(result.syncSucceeded, true);
  assert.equal(result.behind, 0);
  assert.equal(result.ahead, 1);
  assert.notEqual(result.head, oldHead);
  assert.equal((await git(reader, 'rev-list', '--parents', '-n', '1', 'HEAD')).split(' ').length, 2);
});

test('linked worktrees are inspected at their own root and synchronize their current branch', async t => {
  const { root, writer, reader } = await fixture(t);
  const linked = path.join(root, 'linked worktree');
  await git(reader, 'worktree', 'add', '-b', 'feature', linked, 'origin/main');
  await commit(writer, 'shared.txt', 'new upstream\n');
  await git(writer, 'push');
  const state = await fetchRepository(linked);
  assert.equal(state.branch, 'feature');
  assert.equal(state.upstream, 'origin/main');
  assert.equal(state.behind, 1);
  await synchronizeRepository(linked, 'ff-only');
  assert.equal(await fs.readFile(path.join(linked, 'shared.txt'), 'utf8'), 'new upstream\n');
  assert.equal(await fs.readFile(path.join(reader, 'shared.txt'), 'utf8'), 'initial\n');
});

test('repository groups unify linked worktrees, distinguish clones, and only read local metadata', async t => {
  const { root, writer, reader } = await fixture(t);
  const linked = path.join(root, 'linked metadata worktree');
  await git(reader, 'worktree', 'add', '-b', 'group-test', linked, 'origin/main');
  const originalRemote = await git(reader, 'rev-parse', 'origin/main');
  await commit(writer, 'shared.txt', 'new remote state\n');
  await git(writer, 'push');
  await fs.writeFile(path.join(linked, 'shared.txt'), 'unfinished local work\n');
  const [mainGroup, linkedGroup, independentGroup] = await Promise.all([
    getRepositoryGroup(reader), getRepositoryGroup(linked), getRepositoryGroup(writer),
  ]);
  assert.equal(mainGroup, await fs.realpath(path.join(reader, '.git')));
  assert.equal(linkedGroup, mainGroup);
  assert.notEqual(independentGroup, mainGroup);
  assert.equal(await git(reader, 'rev-parse', 'origin/main'), originalRemote);
  assert.equal(await fs.readFile(path.join(linked, 'shared.txt'), 'utf8'), 'unfinished local work\n');
});

test('detached HEAD, missing upstream, bare repos, subdirectories, and invalid paths are handled', async t => {
  const { root, remote, reader } = await fixture(t);
  const bare = await inspectRepository(remote);
  assert.equal(bare.bare, true);
  await assert.rejects(synchronizeRepository(remote), error => error.code === 'BARE_REPOSITORY');
  await git(reader, 'checkout', '--detach');
  assert.equal((await inspectRepository(reader)).branch, null);
  await assert.rejects(synchronizeRepository(reader), error => error.code === 'NO_LOCAL_BRANCH');
  await git(reader, 'checkout', '-b', 'untracked-branch');
  assert.equal((await inspectRepository(reader)).upstream, null);
  await assert.rejects(synchronizeRepository(reader), error => error.code === 'NO_UPSTREAM');
  const subdir = path.join(reader, 'subdir');
  await fs.mkdir(subdir);
  await assert.rejects(inspectRepository(subdir), error => error.code === 'NOT_REPOSITORY_ROOT');
  await assert.rejects(inspectRepository(path.join(root, 'does-not-exist')), error => error.code === 'INVALID_PATH');
  await assert.rejects(inspectRepository('relative/path'), error => error.code === 'INVALID_PATH');
});

test('unborn repository inspection does not fail; absent remote and invalid strategy are clear errors', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'repo-tray-unborn-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await git(root, 'init', '--initial-branch=main');
  const state = await inspectRepository(root);
  assert.equal(state.branch, 'main');
  assert.equal(state.head, null);
  assert.equal(state.remote, null);
  await assert.rejects(fetchRepository(root), error => error.code === 'NO_REMOTE');
  await assert.rejects(synchronizeRepository(root, 'reset'), error => error.code === 'INVALID_STRATEGY');
  await assert.rejects(abortOperation(root), error => error.code === 'NO_ABORTABLE_OPERATION');
});

test('existing Git locks are respected', async t => {
  const { reader } = await fixture(t);
  await fs.writeFile(path.join(reader, '.git', 'index.lock'), 'another process');
  assert.equal((await inspectRepository(reader)).locked, true);
  await assert.rejects(synchronizeRepository(reader), error => error.code === 'REPOSITORY_LOCKED');
  assert.equal(await fs.readFile(path.join(reader, '.git', 'index.lock'), 'utf8'), 'another process');
});

test('deleted upstream branches are reported without applying a different branch', async t => {
  const { writer, reader } = await fixture(t);
  await git(writer, 'checkout', '-b', 'temporary');
  await git(writer, 'push', '-u', 'origin', 'temporary');
  await git(reader, 'fetch', 'origin');
  await git(reader, 'checkout', '--track', 'origin/temporary');
  const originalHead = await git(reader, 'rev-parse', 'HEAD');
  await git(writer, 'checkout', 'main');
  await git(writer, 'push', 'origin', '--delete', 'temporary');
  const state = await fetchRepository(reader);
  assert.equal(state.branch, 'temporary');
  assert.equal(state.upstream, null);
  assert.equal(state.head, originalHead);
  assert.equal(state.remoteBranches.some(branch => branch.name === 'origin/temporary'), false);
  await assert.rejects(synchronizeRepository(reader), error => error.code === 'NO_UPSTREAM');
});

test('NUL-separated status preserves renamed and unusual filenames', async t => {
  const { reader } = await fixture(t);
  await git(reader, 'mv', 'shared.txt', 'renamed 한국어.txt');
  const filename = 'spaces and\nnewline.txt';
  if (process.platform !== 'win32') await fs.writeFile(path.join(reader, filename), 'local');
  const state = await inspectRepository(reader);
  const renamed = state.changedFiles.find(file => file.path === 'renamed 한국어.txt');
  assert.ok(renamed);
  assert.equal(renamed.originalPath, 'shared.txt');
  if (process.platform !== 'win32') assert.ok(state.changedFiles.some(file => file.path === filename));
});
