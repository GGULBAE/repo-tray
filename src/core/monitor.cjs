'use strict';

const { EventEmitter } = require('node:events');
const crypto = require('node:crypto');
const { normalizeInterval } = require('./store.cjs');

function remoteFingerprint(state) {
  if (!Array.isArray(state?.remoteBranches)) return null;
  const refs = state.remoteBranches
    .filter(ref => ref && typeof ref.name === 'string' && typeof ref.hash === 'string')
    .map(ref => `${ref.name}\0${ref.hash}`).sort();
  return crypto.createHash('sha256').update(refs.join('\n')).digest('hex');
}

function attention(state, remoteChanged) {
  return Boolean(remoteChanged || Number(state?.behind) > 0 || state?.conflicts?.length || state?.operation);
}

function errorMessage(error) {
  return String(error?.message || error || '저장소 작업 중 오류가 발생했습니다.').slice(0, 4000);
}

class Monitor extends EventEmitter {
  constructor({ git, now = () => Date.now(), concurrency = 2, tickMs = 1000 } = {}) {
    super();
    if (!git || typeof git.fetchRepository !== 'function') throw new TypeError('Git backend is required.');
    this.git = git;
    this.now = now;
    this.concurrency = Math.max(1, Math.min(8, Math.floor(Number(concurrency) || 2)));
    this.tickMs = Math.max(20, Number(tickMs) || 1000);
    this._entries = new Map();
    this._chains = new Map();
    this._checks = new Map();
    this._queue = [];
    this._active = 0;
    this._running = false;
    this._epoch = 0;
    this._timer = null;
  }

  setRepositories(repositories) {
    if (!Array.isArray(repositories)) throw new TypeError('Repository list is required.');
    const replacement = new Map();
    for (const config of repositories) {
      if (!config?.id || typeof config.path !== 'string') throw new TypeError('Repository id and path are required.');
      const intervalMinutes = normalizeInterval(config.intervalMinutes);
      const previous = this._entries.get(config.id);
      let entry;
      if (previous && previous.path === config.path) {
        entry = previous;
        const intervalChanged = entry.intervalMinutes !== intervalMinutes;
        const unpaused = entry.paused && !config.paused;
        entry.name = config.name || entry.name;
        entry.intervalMinutes = intervalMinutes;
        entry.paused = config.paused === true;
        if (entry.paused) entry.nextCheckAt = null;
        else if (unpaused) entry.nextCheckAt = this.now();
        else if (intervalChanged) entry.nextCheckAt = (entry.lastAttemptAt ?? entry.lastCheckedAt ?? this.now()) + intervalMinutes * 60000;
      } else {
        entry = {
          id: config.id, path: config.path, name: config.name || config.path,
          intervalMinutes, paused: config.paused === true,
          lastCheckedAt: Number.isFinite(config.lastCheckedAt) ? config.lastCheckedAt : null,
          lastAttemptAt: null, nextCheckAt: config.paused ? null : this.now(),
          lastSeenRemoteHash: config.lastSeenRemoteHash || null,
          currentRemoteHash: null, remoteChanged: false,
          pending: false, state: null, error: null, checking: false, syncing: false,
        };
      }
      replacement.set(config.id, entry);
    }
    this._entries = replacement;
    this._emitState();
  }

  getRepositories() {
    return [...this._entries.values()].map(entry => structuredClone(entry));
  }

  _emitState() { this.emit('state', this.getRepositories()); }
  _current(entry) { return this._entries.get(entry.id) === entry; }
  _require(id) {
    const entry = this._entries.get(id);
    if (!entry) throw new Error('모니터링 목록에 없는 저장소입니다.');
    return entry;
  }

  _withSlot(action) {
    return new Promise((resolve, reject) => {
      this._queue.push({ action, resolve, reject });
      this._pump();
    });
  }

  _pump() {
    while (this._active < this.concurrency && this._queue.length) {
      const { action, resolve, reject } = this._queue.shift();
      this._active++;
      Promise.resolve().then(action).then(resolve, reject).finally(() => {
        this._active--;
        this._pump();
      });
    }
  }

  _enqueue(entry, action) {
    const prior = this._chains.get(entry.id);
    const result = Promise.resolve(prior).catch(() => {}).then(() => this._withSlot(async () => {
      if (!this._current(entry)) return null;
      return action();
    }));
    this._chains.set(entry.id, result);
    result.finally(() => {
      if (this._chains.get(entry.id) === result) this._chains.delete(entry.id);
    }).catch(() => {});
    return result;
  }

  _applyState(entry, state, { acknowledge = false } = {}) {
    if (!state || typeof state !== 'object') throw new Error('Git 상태를 읽지 못했습니다.');
    if (state.error) throw new Error(state.error);
    entry.state = state;
    entry.currentRemoteHash = remoteFingerprint(state);
    if (!entry.lastSeenRemoteHash || acknowledge) entry.lastSeenRemoteHash = entry.currentRemoteHash;
    entry.remoteChanged = Boolean(entry.currentRemoteHash && entry.lastSeenRemoteHash && entry.currentRemoteHash !== entry.lastSeenRemoteHash);
    entry.pending = attention(state, entry.remoteChanged);
  }

  _check(entry, scheduled = false) {
    const existing = this._checks.get(entry.id);
    if (existing && existing.entry === entry) return existing.promise;
    const epoch = this._epoch;
    const result = this._enqueue(entry, async () => {
      if (scheduled && (!this._running || epoch !== this._epoch || entry.paused)) return null;
      entry.checking = true;
      entry.lastAttemptAt = this.now();
      this._emitState();
      try {
        const state = await this.git.fetchRepository(entry.path);
        if (!this._current(entry)) return null;
        this._applyState(entry, state);
        entry.lastCheckedAt = this.now();
        entry.error = null;
        return structuredClone(entry);
      } catch (error) {
        if (this._current(entry)) entry.error = errorMessage(error);
        // A failed fetch does not mean previously detected changes disappeared.
        return null;
      } finally {
        if (this._current(entry)) {
          entry.checking = false;
          entry.nextCheckAt = entry.paused ? null : this.now() + entry.intervalMinutes * 60000;
          this._emitState();
        }
      }
    });
    this._checks.set(entry.id, { entry, promise: result });
    result.finally(() => {
      if (this._checks.get(entry.id)?.promise === result) this._checks.delete(entry.id);
    }).catch(() => {});
    return result;
  }

  checkNow(id) {
    const targets = id ? [this._require(id)] : [...this._entries.values()].filter(entry => !entry.paused);
    return Promise.all(targets.map(entry => this._check(entry, false))).then(() => this.getRepositories());
  }

  async _mutate(id, operation) {
    const entry = this._require(id);
    return this._enqueue(entry, async () => {
      entry.syncing = true;
      entry.error = null;
      this._emitState();
      try {
        const state = await operation(entry.path);
        if (!this._current(entry)) return null;
        this._applyState(entry, state, { acknowledge: !state.operation && !state.conflicts?.length });
        if (state.syncSucceeded === false) throw new Error(state.syncError || '충돌을 해결한 후 동기화를 완료하세요.');
        entry.lastCheckedAt = this.now();
        entry.lastAttemptAt = this.now();
        return structuredClone(entry);
      } catch (error) {
        if (this._current(entry)) {
          try {
            const fresh = await this.git.inspectRepository(entry.path);
            if (this._current(entry)) this._applyState(entry, fresh);
          } catch {}
          if (this._current(entry)) entry.error = errorMessage(error);
        }
        throw error;
      } finally {
        if (this._current(entry)) {
          entry.syncing = false;
          entry.nextCheckAt = entry.paused ? null : this.now() + entry.intervalMinutes * 60000;
          this._emitState();
        }
      }
    });
  }

  syncRepository(id, strategy = 'ff-only') {
    if (!['ff-only', 'merge', 'rebase'].includes(strategy)) return Promise.reject(new Error('지원하지 않는 동기화 방식입니다.'));
    return this._mutate(id, repoPath => this.git.synchronizeRepository(repoPath, strategy));
  }

  abortOperation(id) {
    return this._mutate(id, repoPath => this.git.abortOperation(repoPath));
  }

  acknowledge(id) {
    const entry = this._require(id);
    entry.lastSeenRemoteHash = entry.currentRemoteHash || entry.lastSeenRemoteHash;
    entry.remoteChanged = false;
    entry.pending = attention(entry.state, false);
    this._emitState();
    return structuredClone(entry);
  }

  wake() {
    if (!this._running) return Promise.resolve(this.getRepositories());
    const due = [...this._entries.values()].filter(entry => !entry.paused && !entry.checking && !entry.syncing && (entry.nextCheckAt == null || entry.nextCheckAt <= this.now()));
    return Promise.all(due.map(entry => this._check(entry, true))).then(() => this.getRepositories());
  }

  start() {
    if (this._running) return;
    this._running = true;
    this._epoch++;
    this._timer = setInterval(() => { this.wake().catch(() => {}); }, this.tickMs);
    this._timer.unref?.();
    this.wake().catch(() => {});
  }

  stop() {
    this._running = false;
    this._epoch++;
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
  }

  isBusy() { return this._chains.size > 0 || this._active > 0 || this._queue.length > 0; }

  async whenIdle() {
    // The caller stops scheduling before draining. Existing Git mutations are
    // allowed to finish instead of terminating merge/rebase child processes.
    while (this._chains.size) await Promise.allSettled([...this._chains.values()]);
  }
}

module.exports = { Monitor, remoteFingerprint };
