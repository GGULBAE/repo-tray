'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
let count = 0;
for (const root of ['src', 'scripts', 'test']) {
  if (!fs.existsSync(root)) continue;
  for (const entry of fs.readdirSync(root, { recursive: true })) {
    if (!/\.(?:cjs|js)$/.test(entry)) continue;
    const file = path.join(root, entry);
    const check = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (check.status !== 0) { process.stderr.write(check.stderr); process.exit(1); }
    count++;
  }
}
console.log(`Syntax OK: ${count} JavaScript files`);
