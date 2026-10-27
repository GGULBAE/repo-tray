'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Monitor } = require('../src/core/monitor.cjs');

const clean = (overrides = {}) => ({ path: '/repo', name: 'repo', branch: 'main', upstream: 'origin/main', remote: 'origin', ahead: 0, behind: 0, dirty: false, changedFiles: [], conflicts: [], operation: null, incomingCommits: [], remoteBranches: [{ name: 'origin/main', hash: 'a'.repeat(40) }], ...overrides });
const repo = (id = 'repo', overrides = {}) => ({ id, path: `/${id}`, name: id, intervalMinutes: 1, paused: false, ...overrides });
const flush = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve; let reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function make(t, overrides = {}) {
  let now = 100000;
  const git = {
    fetchRepository: async () => clean(), inspectRepository: async () => clean(),
    synchronizeRepository: async () => clean(), abortOperation: async () => clean(),
    ...overrides,
  };
  const monitor = new Monitor({ git, now: () => now, tickMs: 60000 });
  t.after(() => monitor.stop());
  monitor.setRepositories([repo()]);
  return { monitor, git, advance: ms => { now += ms; } };
}

test('periodic checks fetch only and obey the configured minute interval', async t => {
  let checks = 0; let syncs = 0;
  const { monitor, advance } = make(t, {
    fetchRepository: async () => { checks++; return clean({ behind: 2 }); },
    synchronizeRepository: async () => { syncs++; return clean(); },
  });
  monitor.start();
  await monitor.wake();
  assert.equal(checks, 1);
  assert.equal(monitor.getRepositories()[0].pending, true);
  advance(59999);
  await monitor.wake();
  assert.equal(checks, 1);
  advance(1);
  await monitor.wake();
  assert.equal(checks, 2);
  assert.equal(syncs, 0);
  monitor.stop();
  advance(60000);
  await monitor.wake();
  assert.equal(checks, 2);
});

test('simultaneous manual checks are deduplicated; failed fetch retains pending changes', async t => {
  const pending = deferred(); let calls = 0;
  const { monitor, git } = make(t, { fetchRepository: async () => { calls++; return pending.promise; } });
  const a = monitor.checkNow(); const b = monitor.checkNow('repo');
  await flush();
  assert.equal(calls, 1);
  pending.resolve(clean({ behind: 1, dirty: true, changedFiles: [{ path: 'work.js', status: ' M' }] }));
  await Promise.all([a, b]);
  const checked = monitor.getRepositories()[0].lastCheckedAt;
  git.fetchRepository = async () => { throw new Error('offline'); };
  await monitor.checkNow();
  const state = monitor.getRepositories()[0];
  assert.equal(state.pending, true);
  assert.equal(state.state.dirty, true);
  assert.equal(state.error, 'offline');
  assert.equal(state.lastCheckedAt, checked);
});

test('settings changes preserve state, pause background work, and manual check still works', async t => {
  let calls = 0;
  const { monitor, advance } = make(t, { fetchRepository: async () => { calls++; return clean({ behind: 3 }); } });
  await monitor.checkNow();
  const previous = monitor.getRepositories()[0];
  monitor.setRepositories([repo('repo', { intervalMinutes: 300, paused: true })]);
  assert.equal(monitor.getRepositories()[0].state.behind, 3);
  assert.equal(monitor.getRepositories()[0].lastCheckedAt, previous.lastCheckedAt);
  assert.equal(monitor.getRepositories()[0].nextCheckAt, null);
  monitor.start(); advance(24 * 3600000); await monitor.wake();
  assert.equal(calls, 1);
  await monitor.checkNow('repo');
  assert.equal(calls, 2);
  monitor.setRepositories([repo('repo', { intervalMinutes: 300 })]);
  await monitor.wake();
  assert.equal(calls, 3);
});

test('removed repositories and changed paths cannot be restored by stale requests', async t => {
  const pending = deferred();
  const { monitor } = make(t, { fetchRepository: () => pending.promise });
  const check = monitor.checkNow(); await flush();
  monitor.setRepositories([]);
  pending.resolve(clean({ behind: 8 })); await check;
  assert.deepEqual(monitor.getRepositories(), []);

  const delayed = deferred();
  monitor.git.fetchRepository = () => delayed.promise;
  monitor.setRepositories([repo()]);
  const second = monitor.checkNow(); await flush();
  monitor.setRepositories([repo('repo', { path: '/different' })]);
  delayed.resolve(clean({ behind: 9 })); await second;
  assert.equal(monitor.getRepositories()[0].path, '/different');
  assert.equal(monitor.getRepositories()[0].state, null);
});

test('checks and explicit sync on the same repository never overlap', async t => {
  const pending = deferred(); const events = [];
  const { monitor } = make(t, {
    fetchRepository: async () => { events.push('fetch start'); const value = await pending.promise; events.push('fetch end'); return value; },
    synchronizeRepository: async (repoPath, strategy) => { events.push(`sync ${strategy}`); return clean(); },
  });
  const check = monitor.checkNow(); await flush();
  const sync = monitor.syncRepository('repo', 'ff-only'); await flush();
  assert.deepEqual(events, ['fetch start']);
  pending.resolve(clean({ behind: 1 })); await Promise.all([check, sync]);
  assert.deepEqual(events, ['fetch start', 'fetch end', 'sync ff-only']);
  assert.equal(monitor.getRepositories()[0].pending, false);
  assert.equal(monitor.getRepositories()[0].syncing, false);
});

test('global fetch concurrency is bounded and stop cancels not-yet-started scheduled jobs', async t => {
  const gates = [deferred(), deferred()]; let calls = 0; let active = 0; let maximum = 0;
  const { monitor } = make(t, { fetchRepository: async () => {
    const index = calls++; active++; maximum = Math.max(maximum, active);
    await gates[index]?.promise; active--; return clean();
  } });
  monitor.setRepositories([repo('one'), repo('two'), repo('three'), repo('four')]);
  monitor.start(); await flush();
  assert.equal(calls, 2);
  monitor.stop(); gates.forEach(gate => gate.resolve()); await flush(); await flush();
  assert.equal(calls, 2);
  assert.equal(maximum, 2);
});

test('remote branch changes raise attention and acknowledgement only clears remote-only changes', async t => {
  const { monitor, git } = make(t);
  await monitor.checkNow();
  assert.equal(monitor.getRepositories()[0].pending, false);
  const initialHash = monitor.getRepositories()[0].lastSeenRemoteHash;
  git.fetchRepository = async () => clean({ remoteBranches: [{ name: 'origin/main', hash: 'b'.repeat(40) }] });
  await monitor.checkNow();
  assert.equal(monitor.getRepositories()[0].remoteChanged, true);
  assert.equal(monitor.getRepositories()[0].pending, true);
  monitor.acknowledge('repo');
  assert.equal(monitor.getRepositories()[0].pending, false);
  assert.notEqual(monitor.getRepositories()[0].lastSeenRemoteHash, initialHash);
  git.fetchRepository = async () => clean({ behind: 2 });
  await monitor.checkNow(); monitor.acknowledge('repo');
  assert.equal(monitor.getRepositories()[0].pending, true);
});

test('merge conflicts are exposed for user resolution, not automatically aborted', async t => {
  const conflictState = clean({ dirty: true, operation: 'merge', conflicts: ['index.js'], syncSucceeded: false, syncError: 'merge conflict' });
  let aborts = 0;
  const { monitor } = make(t, {
    synchronizeRepository: async () => conflictState,
    inspectRepository: async () => conflictState,
    abortOperation: async () => { aborts++; return clean({ behind: 1 }); },
  });
  await assert.rejects(monitor.syncRepository('repo', 'merge'), /merge conflict/);
  const state = monitor.getRepositories()[0];
  assert.equal(state.pending, true);
  assert.equal(state.state.operation, 'merge');
  assert.deepEqual(state.state.conflicts, ['index.js']);
  assert.equal(state.error, 'merge conflict');
  assert.equal(aborts, 0);
  await monitor.abortOperation('repo');
  assert.equal(aborts, 1);
  assert.equal(monitor.getRepositories()[0].state.operation, null);
  assert.equal(monitor.getRepositories()[0].error, null);
});

test('returned snapshots cannot mutate internal state', async t => {
  const { monitor } = make(t);
  await monitor.checkNow();
  const copy = monitor.getRepositories();
  copy[0].state.behind = 999;
  copy[0].name = 'changed';
  assert.equal(monitor.getRepositories()[0].state.behind, 0);
  assert.equal(monitor.getRepositories()[0].name, 'repo');
});

test('remote acknowledgement baseline survives restart and new remote commits raise attention', async t => {
  const { monitor, git } = make(t);
  await monitor.checkNow();
  const persisted = monitor.getRepositories().map(({ id, path, name, intervalMinutes, paused, lastCheckedAt, lastSeenRemoteHash }) => ({ id, path, name, intervalMinutes, paused, lastCheckedAt, lastSeenRemoteHash }));
  const restarted = new Monitor({ git, tickMs: 60000 });
  t.after(() => restarted.stop());
  restarted.setRepositories(persisted);
  await restarted.checkNow();
  assert.equal(restarted.getRepositories()[0].pending, false);
  assert.equal(restarted.getRepositories()[0].lastSeenRemoteHash, persisted[0].lastSeenRemoteHash);
  git.fetchRepository = async () => clean({ remoteBranches: [{ name: 'origin/new-feature', hash: 'c'.repeat(40) }] });
  await restarted.checkNow();
  assert.equal(restarted.getRepositories()[0].remoteChanged, true);
  restarted.acknowledge('repo');
  const acknowledged = restarted.getRepositories()[0];
  const third = new Monitor({ git });
  t.after(() => third.stop());
  third.setRepositories([acknowledged]);
  await third.checkNow();
  assert.equal(third.getRepositories()[0].pending, false);
});

test('shutdown drain waits for active and queued explicit sync to finish without starting more scheduled checks', async t => {
  const gate = deferred(); const events = [];
  const { monitor } = make(t, {
    fetchRepository: async () => { events.push('fetch'); return clean(); },
    synchronizeRepository: async (_path, strategy) => { events.push(strategy); await gate.promise; return clean(); },
  });
  const first = monitor.syncRepository('repo', 'ff-only');
  const second = monitor.syncRepository('repo', 'merge');
  await flush();
  monitor.stop();
  assert.equal(monitor.isBusy(), true);
  let drained = false;
  const shutdown = monitor.whenIdle().then(() => { drained = true; });
  await flush();
  assert.equal(drained, false);
  gate.resolve();
  await Promise.all([first, second, shutdown]);
  assert.deepEqual(events, ['ff-only', 'merge']);
  assert.equal(drained, true);
  await monitor.wake();
  assert.deepEqual(events, ['ff-only', 'merge']);
});
