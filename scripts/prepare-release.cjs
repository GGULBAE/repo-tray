'use strict';
const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const packageVersion = require('../package.json').version;

async function prepareRelease(directory, tag, version = packageVersion) {
  const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;
  if (!semver.test(version) || tag !== `v${version}`) {
    throw new Error(`Release tag must match package.json: v${version}`);
  }
  const expected = ['mac-arm64.zip', 'mac-x64.zip', 'win-x64.exe'].map(suffix => `Repo-Tray-${version}-${suffix}`).sort();
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const unexpected = entries.filter(entry => !expected.includes(entry.name) && entry.name !== 'SHA256SUMS.txt');
  if (unexpected.length) throw new Error(`Unexpected release assets: ${unexpected.map(entry => entry.name).join(', ')}`);
  const lines = [];
  for (const name of expected) {
    const file = path.join(directory, name);
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.size < 4) throw new Error(`Missing, empty, or invalid release asset: ${name}`);
    const handle = await fs.open(file, 'r');
    const signature = Buffer.alloc(4);
    try { await handle.read(signature, 0, 4, 0); } finally { await handle.close(); }
    const valid = name.endsWith('.zip') ? signature.equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])) : signature.subarray(0, 2).toString('ascii') === 'MZ';
    if (!valid) throw new Error(`Incorrect file format: ${name}`);
    const digest = crypto.createHash('sha256');
    for await (const chunk of createReadStream(file)) digest.update(chunk);
    lines.push(`${digest.digest('hex')}  ${name}`);
  }
  await fs.writeFile(path.join(directory, 'SHA256SUMS.txt'), `${lines.join('\n')}\n`);
  return [...expected, 'SHA256SUMS.txt'];
}

if (require.main === module) {
  const [, , directory, tag] = process.argv;
  if (!directory || !tag) { console.error('Usage: node scripts/prepare-release.cjs <asset-directory> <version-tag>'); process.exitCode = 1; }
  else prepareRelease(path.resolve(directory), tag).then(files => console.log(`Validated release assets: ${files.join(', ')}`)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { prepareRelease };
