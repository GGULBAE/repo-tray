'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const relative = process.platform === 'darwin'
  ? path.join('release', process.arch === 'arm64' ? 'mac-arm64' : 'mac', 'Repo Tray.app', 'Contents', 'MacOS', 'Repo Tray')
  : process.platform === 'win32' ? path.join('release', 'win-unpacked', 'Repo Tray.exe') : null;
if (!relative) throw new Error('Packaged desktop tests require macOS or Windows.');
const executable = path.join(root, relative);
if (!fs.existsSync(executable)) throw new Error(`Build the native app before testing: ${relative}`);
const result = spawnSync(process.execPath, [path.join(__dirname, 'smoke.cjs')], {
  cwd: root,
  env: { ...process.env, REPO_TRAY_EXECUTABLE: executable },
  stdio: 'inherit',
  shell: false
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
