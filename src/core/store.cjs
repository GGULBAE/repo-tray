'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DEFAULT_SETTINGS = Object.freeze({ defaultIntervalMinutes: 60, launchAtLogin: true });
const MAX_INTERVAL = 10080;
const MAX_DENIED_PATHS = 500;

// Permission-denied paths and discovery group keys must never be probed while
// loading/saving preferences: resolving them could trigger the same OS prompt.
function lexicalAbsolutePath(value) {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0') || !path.isAbsolute(value)) {
    throw new TypeError('경로는 올바른 절대 경로여야 합니다.');
  }
  let normalized = path.normalize(value);
  const rootLength = path.parse(normalized).root.length;
  while (normalized.length > rootLength && normalized.endsWith(path.sep)) normalized = normalized.slice(0, -1);
  return normalized;
}

function cleanScanPreferences(input, { strict, warnings }) {
  const result = { deniedPaths: [] };
  if (input === undefined) return result;
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    if (strict) throw new TypeError('탐색 설정 형식이 올바르지 않습니다.');
    warnings.push('탐색 설정 형식이 올바르지 않아 기본값을 사용합니다.');
    return result;
  }
  if (input.deniedPaths === undefined) return result;
  if (!Array.isArray(input.deniedPaths)) {
    if (strict) throw new TypeError('접근 거부 경로 목록 형식이 올바르지 않습니다.');
    warnings.push('접근 거부 경로 목록 형식이 올바르지 않아 기본값을 사용합니다.');
    return result;
  }
  if (input.deniedPaths.length > MAX_DENIED_PATHS) {
    if (strict) throw new RangeError(`접근 거부 경로는 최대 ${MAX_DENIED_PATHS}개까지 보관할 수 있습니다.`);
    warnings.push(`접근 거부 경로 목록에서 처음 ${MAX_DENIED_PATHS}개만 읽었습니다.`);
  }
  const seen = new Set();
  for (const value of input.deniedPaths.slice(0, MAX_DENIED_PATHS)) {
    try {
      const normalized = lexicalAbsolutePath(value);
      const key = process.platform === 'win32' ? normalized.toLowerCase() : normalized;
      if (!seen.has(key)) {
        seen.add(key);
        result.deniedPaths.push(normalized);
      }
    } catch (error) {
      if (strict) throw error;
      warnings.push(`올바르지 않은 접근 거부 경로를 건너뛰었습니다: ${error.message}`);
    }
  }
  return result;
}

function canonicalPath(value) {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0') || !path.isAbsolute(value)) {
    throw new TypeError('저장소 경로는 올바른 절대 경로여야 합니다.');
  }
  let result = path.normalize(value);
  try { result = fs.realpathSync.native(result); } catch (error) {
    if (!['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM'].includes(error.code)) throw error;
  }
  return result;
}

function repositoryId(repoPath) {
  const resolved = canonicalPath(repoPath);
  const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 24);
}

function normalizeInterval(value, fallback = DEFAULT_SETTINGS.defaultIntervalMinutes) {
  const number = value == null ? fallback : Number(value);
  if (!Number.isInteger(number) || number < 1 || number > MAX_INTERVAL) {
    throw new RangeError(`조회 주기는 1~${MAX_INTERVAL} 사이의 정수(분)여야 합니다.`);
  }
  return number;
}

function timestamp(value) {
  if (value == null) return null;
  const number = typeof value === 'string' ? Date.parse(value) : value;
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function createRepository(repoPath, options = {}) {
  const resolved = canonicalPath(repoPath);
  return {
    id: repositoryId(resolved),
    path: resolved,
    groupKey: options.groupKey == null ? null : lexicalAbsolutePath(options.groupKey),
    name: typeof options.name === 'string' && options.name.trim()
      ? options.name.trim().slice(0, 256) : path.basename(resolved) || resolved,
    intervalMinutes: normalizeInterval(options.intervalMinutes),
    paused: options.paused === true,
    lastCheckedAt: timestamp(options.lastCheckedAt),
    lastSeenRemoteHash: typeof options.lastSeenRemoteHash === 'string' && /^[a-f0-9]{64}$/.test(options.lastSeenRemoteHash)
      ? options.lastSeenRemoteHash : null,
  };
}

function defaultConfig() {
  return { version: 1, settings: { ...DEFAULT_SETTINGS }, scanPreferences: { deniedPaths: [] }, repositories: [] };
}

function cleanConfig(input, { strict = false, warnings = [] } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('설정 파일 형식이 올바르지 않습니다.');
  if (input.version !== undefined && input.version !== 1) throw new TypeError('지원하지 않는 설정 파일 버전입니다.');
  const settings = input.settings && typeof input.settings === 'object' ? input.settings : {};
  let interval = DEFAULT_SETTINGS.defaultIntervalMinutes;
  try { interval = normalizeInterval(settings.defaultIntervalMinutes); } catch (error) {
    if (strict) throw error;
    warnings.push(error.message);
  }
  if (input.repositories !== undefined && !Array.isArray(input.repositories)) throw new TypeError('저장소 목록 형식이 올바르지 않습니다.');
  const result = {
    version: 1,
    settings: { defaultIntervalMinutes: interval, launchAtLogin: typeof settings.launchAtLogin === 'boolean' ? settings.launchAtLogin : DEFAULT_SETTINGS.launchAtLogin },
    scanPreferences: cleanScanPreferences(input.scanPreferences, { strict, warnings }),
    repositories: [],
  };
  const seen = new Set();
  for (const raw of input.repositories || []) {
    try {
      if (!raw || typeof raw !== 'object') throw new TypeError('저장소 항목 형식이 올바르지 않습니다.');
      let groupKey = null;
      try { groupKey = raw.groupKey == null ? null : lexicalAbsolutePath(raw.groupKey); } catch (error) {
        if (strict) throw error;
        warnings.push(`저장소의 잘못된 그룹 경로를 초기화했습니다: ${error.message}`);
      }
      const repo = createRepository(raw.path, { ...raw, groupKey, intervalMinutes: raw.intervalMinutes ?? interval });
      if (seen.has(repo.id)) continue;
      seen.add(repo.id);
      result.repositories.push(repo);
    } catch (error) {
      if (strict) throw error;
      warnings.push(`저장소 설정을 건너뛰었습니다: ${error.message}`);
    }
  }
  return result;
}

function createStore(filePath) {
  const resolved = canonicalPath(filePath);
  const warnings = [];
  let lastBackupPath = null;
  let writeBlockedError = null;
  return {
    filePath: resolved,
    warnings,
    get backupPath() { return lastBackupPath; },
    read() {
      warnings.length = 0;
      writeBlockedError = null;
      let text;
      try { text = fs.readFileSync(resolved, 'utf8'); } catch (error) {
        if (error.code === 'ENOENT') return defaultConfig();
        writeBlockedError = `기존 설정을 읽지 못해 덮어쓰기를 중단했습니다: ${error.message}`;
        warnings.push(writeBlockedError);
        return defaultConfig();
      }
      try { return cleanConfig(JSON.parse(text), { warnings }); } catch (error) {
        const backup = `${resolved}.corrupt-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
        try {
          fs.copyFileSync(resolved, backup, fs.constants.COPYFILE_EXCL);
          fs.chmodSync(backup, 0o600);
          lastBackupPath = backup;
          warnings.push(`설정 파일을 읽을 수 없어 원본을 ${backup}에 보관했습니다. ${error.message}`);
        } catch (backupError) {
          writeBlockedError = `손상된 설정의 원본을 보관하지 못해 덮어쓰기를 중단했습니다: ${backupError.message}`;
          warnings.push(`설정 파일을 읽을 수 없습니다. 원본은 그대로 두었습니다. ${error.message} (백업 실패: ${backupError.message})`);
        }
        return defaultConfig();
      }
    },
    write(input) {
      if (writeBlockedError) throw new Error(writeBlockedError);
      const config = cleanConfig(input, { strict: true });
      const directory = path.dirname(resolved);
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      const temporary = path.join(directory, `.${path.basename(resolved)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`);
      let descriptor;
      try {
        descriptor = fs.openSync(temporary, 'wx', 0o600);
        fs.writeFileSync(descriptor, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
        fs.fsyncSync(descriptor);
        fs.closeSync(descriptor);
        descriptor = undefined;
        fs.renameSync(temporary, resolved);
      } catch (error) {
        if (descriptor !== undefined) fs.closeSync(descriptor);
        try { fs.unlinkSync(temporary); } catch {}
        throw error;
      }
      return config;
    },
  };
}

module.exports = { createStore, createRepository, canonicalPath, lexicalAbsolutePath, repositoryId, normalizeInterval, DEFAULT_SETTINGS, MAX_INTERVAL, MAX_DENIED_PATHS };
