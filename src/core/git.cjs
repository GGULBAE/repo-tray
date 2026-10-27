'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');

const repositoryLocks = new Map();
const MAX_OUTPUT = 4 * 1024 * 1024;

class GitOperationError extends Error {
  constructor(message, code = 'GIT_ERROR', details = '') {
    super(message);
    this.name = 'GitOperationError';
    this.code = code;
    this.details = details;
  }
}

function git(repoPath, args, { allowFailure = false, timeout = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    let output = '';
    let errors = '';
    let size = 0;
    let stopped = false;
    let timer;
    const environment = { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never', SSH_ASKPASS_REQUIRE: 'never', GIT_EDITOR: 'true', GIT_SEQUENCE_EDITOR: 'true', GIT_MERGE_AUTOEDIT: 'no', LC_ALL: 'C' };
    // A terminal that launched the app may carry repository-specific Git variables.
    // The selected directory must remain the only source of repository identity.
    for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES']) delete environment[key];
    const child = spawn('git', ['--no-optional-locks', '-c', 'color.ui=false', '-c', 'core.quotepath=false', '-C', repoPath, ...args], {
      shell: false,
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: environment,
    });
    const stop = error => {
      if (stopped) return;
      stopped = true;
      clearTimeout(timer);
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL');
        else if (child.pid) {
          const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', shell: false });
          killer.on('error', () => child.kill('SIGKILL'));
          killer.unref();
        }
      } catch { /* Process already exited. */ }
      reject(error);
    };
    timer = setTimeout(() => stop(new GitOperationError('Git 작업 시간이 초과되었습니다. 인증 또는 네트워크 상태를 확인하세요.', 'TIMEOUT')), timeout);
    timer.unref?.();
    child.on('error', error => stop(new GitOperationError(error.code === 'ENOENT' ? 'Git이 설치되어 있지 않거나 실행 경로에서 찾을 수 없습니다.' : error.message, 'GIT_UNAVAILABLE')));
    const collect = (chunk, stderr) => {
      size += Buffer.byteLength(chunk, 'utf8');
      if (size > MAX_OUTPUT) return stop(new GitOperationError('Git 출력이 허용 크기를 초과했습니다.', 'OUTPUT_LIMIT'));
      if (stderr) errors += chunk;
      else output += chunk;
    };
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => collect(chunk, false));
    child.stderr.on('data', chunk => collect(chunk, true));
    child.on('close', code => {
      clearTimeout(timer);
      if (stopped) return;
      stopped = true;
      const result = { stdout: output, stderr: errors, code };
      if (code === 0 || allowFailure) resolve(result);
      else reject(new GitOperationError(errors.trim() || `Git 명령이 실패했습니다 (${code}).`, 'GIT_COMMAND_FAILED', errors.trim()));
    });
  });
}

async function canonicalRepositoryPath(repoPath) {
  if (typeof repoPath !== 'string' || !repoPath || repoPath.includes('\0') || !path.isAbsolute(repoPath)) {
    throw new GitOperationError('저장소의 절대 경로가 필요합니다.', 'INVALID_PATH');
  }
  let canonical;
  try {
    canonical = await fs.realpath(repoPath);
    if (!(await fs.stat(canonical)).isDirectory()) throw new Error();
  } catch {
    throw new GitOperationError('저장소 폴더가 없거나 접근할 수 없습니다.', 'INVALID_PATH');
  }
  return canonical;
}

async function withRepositoryLock(repoPath, action) {
  const canonical = await canonicalRepositoryPath(repoPath);
  const key = process.platform === 'win32' ? canonical.toLowerCase() : canonical;
  const previous = repositoryLocks.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(() => action(canonical));
  repositoryLocks.set(key, current);
  try { return await current; }
  finally { if (repositoryLocks.get(key) === current) repositoryLocks.delete(key); }
}

async function exists(file) {
  try { await fs.access(file); return true; } catch { return false; }
}

function parseStatus(output) {
  const entries = output.split('\0');
  const changedFiles = [];
  const conflicts = [];
  for (let i = 0; i < entries.length; i++) {
    if (!entries[i]) continue;
    const status = entries[i].slice(0, 2);
    const filePath = entries[i].slice(3);
    const entry = { path: filePath, status };
    if (status.includes('R') || status.includes('C')) entry.originalPath = entries[++i];
    changedFiles.push(entry);
    if (status.includes('U') || status === 'AA' || status === 'DD') conflicts.push(filePath);
  }
  return { changedFiles, conflicts };
}

async function inspect(canonical) {
  const bareResult = await git(canonical, ['rev-parse', '--is-bare-repository']);
  const bare = bareResult.stdout.trim() === 'true';
  const gitDirResult = await git(canonical, ['rev-parse', '--absolute-git-dir']);
  const gitDir = gitDirResult.stdout.trim();
  if (!bare) {
    const top = await git(canonical, ['rev-parse', '--show-toplevel']);
    const actualRoot = await fs.realpath(top.stdout.trim());
    const same = process.platform === 'win32' ? actualRoot.toLowerCase() === canonical.toLowerCase() : actualRoot === canonical;
    if (!same) throw new GitOperationError('저장소 내부 폴더가 아닌 저장소 최상위 폴더를 선택하세요.', 'NOT_REPOSITORY_ROOT');
  } else if (await fs.realpath(gitDir) !== canonical) {
    throw new GitOperationError('Bare 저장소의 최상위 폴더를 선택하세요.', 'NOT_REPOSITORY_ROOT');
  }

  const [branchResult, headResult, upstreamResult, remotesResult, refsResult, statusResult, markerResults] = await Promise.all([
    git(canonical, ['symbolic-ref', '--quiet', '--short', 'HEAD'], { allowFailure: true }),
    git(canonical, ['rev-parse', '--verify', '--quiet', 'HEAD'], { allowFailure: true }),
    git(canonical, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], { allowFailure: true }),
    git(canonical, ['remote']),
    git(canonical, ['for-each-ref', '--format=%(refname:short)%00%(objectname)%00%(symref)', 'refs/remotes/']),
    bare ? Promise.resolve({ stdout: '' }) : git(canonical, ['status', '--porcelain=v1', '-z', '--untracked-files=normal', '--ignore-submodules=none']),
    Promise.all(['rebase-merge', 'rebase-apply', 'MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'BISECT_LOG', 'index.lock'].map(marker => exists(path.join(gitDir, marker)))),
  ]);
  const branch = branchResult.code === 0 ? branchResult.stdout.trim() : null;
  const head = headResult.code === 0 ? headResult.stdout.trim() : null;
  const upstream = upstreamResult.code === 0 ? upstreamResult.stdout.trim() : null;
  const remotes = remotesResult.stdout.trim().split('\n').filter(Boolean);
  let remote = null;
  if (branch) {
    const configured = await git(canonical, ['config', '--get', `branch.${branch}.remote`], { allowFailure: true });
    if (configured.code === 0) remote = configured.stdout.trim();
  }
  if (!remote) remote = remotes.includes('origin') ? 'origin' : remotes[0] || null;
  const { changedFiles, conflicts } = parseStatus(statusResult.stdout);
  const operation = markerResults[0] || markerResults[1] ? 'rebase' : markerResults[2] ? 'merge' : markerResults[3] ? 'cherry-pick' : markerResults[4] ? 'revert' : markerResults[5] ? 'bisect' : null;
  let ahead = 0;
  let behind = 0;
  let incomingCommits = [];
  let upstreamHead = null;
  if (head && upstream) {
    const [counts, commits, upstreamCommit] = await Promise.all([
      git(canonical, ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}', '--']),
      git(canonical, ['log', '-30', '--format=%H%x00%s', 'HEAD..@{upstream}', '--']),
      git(canonical, ['rev-parse', '--verify', '@{upstream}']),
    ]);
    upstreamHead = upstreamCommit.stdout.trim();
    [ahead, behind] = counts.stdout.trim().split(/\s+/).map(Number);
    incomingCommits = commits.stdout.split('\n').filter(Boolean).map(line => {
      const separator = line.indexOf('\0');
      return { hash: line.slice(0, separator), subject: line.slice(separator + 1) };
    });
  }
  const remoteBranches = refsResult.stdout.split('\n').filter(Boolean).map(line => {
    const [name, hash, symbolic] = line.split('\0');
    return symbolic ? null : { name, hash };
  }).filter(Boolean).slice(0, 2000);
  return { path: canonical, name: path.basename(canonical), bare, branch, head, upstream, upstreamHead, remote, remotes, ahead, behind, dirty: changedFiles.length > 0, changedFiles, conflicts, operation, locked: markerResults[6], incomingCommits, remoteBranches };
}

function assertWorkingRepository(state) {
  if (state.bare) throw new GitOperationError('Bare 저장소에는 작업 파일이 없어 동기화할 수 없습니다.', 'BARE_REPOSITORY');
  if (state.locked) throw new GitOperationError('다른 Git 작업이 진행 중입니다. 완료 후 다시 시도하세요.', 'REPOSITORY_LOCKED');
}

function assertSyncReady(state) {
  assertWorkingRepository(state);
  if (state.operation) throw new GitOperationError(`진행 중인 ${state.operation} 작업을 먼저 완료하거나 중단하세요.`, 'OPERATION_IN_PROGRESS');
  if (!state.branch || !state.head) throw new GitOperationError('커밋이 있는 로컬 브랜치를 선택한 뒤 동기화하세요.', 'NO_LOCAL_BRANCH');
  if (!state.upstream) throw new GitOperationError('현재 브랜치에 연결된 원격 브랜치가 없습니다. Git에서 upstream을 설정하세요.', 'NO_UPSTREAM');
  if (state.dirty) throw new GitOperationError('수정 중인 파일이 있습니다. 작업을 커밋하거나 별도로 보관한 뒤 다시 시도하세요.', 'DIRTY_WORKTREE');
}

async function fetchState(canonical, state) {
  assertWorkingRepository(state);
  if (!state.remote) throw new GitOperationError('등록된 원격 저장소가 없습니다.', 'NO_REMOTE');
  await git(canonical, ['fetch', '--prune', '--no-recurse-submodules', '--', state.remote], { timeout: 60000 });
  return inspect(canonical);
}

async function inspectRepository(repoPath) {
  return withRepositoryLock(repoPath, inspect);
}

async function getRepositoryGroup(repoPath) {
  return withRepositoryLock(repoPath, async canonical => {
    const result = await git(canonical, ['rev-parse', '--git-common-dir']);
    const commonDirectory = result.stdout.replace(/\r?\n$/, '');
    if (!commonDirectory) throw new GitOperationError('저장소의 공통 Git 경로를 읽지 못했습니다.', 'INVALID_GIT_DIRECTORY');
    return fs.realpath(path.resolve(canonical, commonDirectory));
  });
}

async function fetchRepository(repoPath) {
  return withRepositoryLock(repoPath, async canonical => fetchState(canonical, await inspect(canonical)));
}

async function synchronizeRepository(repoPath, strategy = 'ff-only') {
  if (!['ff-only', 'merge', 'rebase'].includes(strategy)) throw new GitOperationError('지원하지 않는 동기화 방식입니다.', 'INVALID_STRATEGY');
  return withRepositoryLock(repoPath, async canonical => {
    const initial = await inspect(canonical);
    assertSyncReady(initial);
    const refreshed = await fetchState(canonical, initial);
    assertSyncReady(refreshed);
    if (initial.branch !== refreshed.branch || initial.head !== refreshed.head || initial.upstream !== refreshed.upstream) {
      throw new GitOperationError('확인 중 로컬 브랜치가 변경되었습니다. 변경 내용을 다시 확인하세요.', 'WORKTREE_CHANGED');
    }
    if (!refreshed.behind) return { ...refreshed, syncSucceeded: true };
    if (strategy === 'ff-only' && refreshed.ahead) throw new GitOperationError('로컬과 원격 이력이 갈라져 있습니다. 변경 내용을 확인하고 병합 또는 리베이스를 선택하세요.', 'DIVERGED');
    const args = strategy === 'rebase'
      ? ['-c', 'rebase.autoStash=false', 'rebase', '--no-autostash', refreshed.upstreamHead]
      : ['-c', 'merge.autoStash=false', 'merge', strategy === 'ff-only' ? '--ff-only' : '--ff', '--no-edit', '--no-autostash', refreshed.upstreamHead];
    const result = await git(canonical, args, { timeout: 60000, allowFailure: true });
    const finalState = await inspect(canonical);
    if (result.code !== 0) {
      if (finalState.conflicts.length || finalState.operation) return { ...finalState, syncSucceeded: false, syncError: result.stderr.trim() || result.stdout.trim() || '동기화를 완료하지 못했습니다.' };
      throw new GitOperationError(result.stderr.trim() || result.stdout.trim() || '동기화에 실패했습니다.', 'SYNC_FAILED');
    }
    return { ...finalState, syncSucceeded: true };
  });
}

async function abortOperation(repoPath) {
  return withRepositoryLock(repoPath, async canonical => {
    const state = await inspect(canonical);
    assertWorkingRepository(state);
    if (!['merge', 'rebase'].includes(state.operation)) throw new GitOperationError('중단할 병합 또는 리베이스 작업이 없습니다.', 'NO_ABORTABLE_OPERATION');
    await git(canonical, [state.operation, '--abort'], { timeout: 60000 });
    return inspect(canonical);
  });
}

module.exports = { inspectRepository, getRepositoryGroup, fetchRepository, synchronizeRepository, abortOperation, GitOperationError };
