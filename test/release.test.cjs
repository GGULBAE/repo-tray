'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { prepareRelease } = require('../scripts/prepare-release.cjs');
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'repo-tray-release-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  for (const suffix of ['mac-arm64.zip', 'mac-x64.zip', 'win-x64.exe']) {
    await fs.writeFile(path.join(dir, `Repo-Tray-0.1.1-${suffix}`), suffix.endsWith('.zip') ? Buffer.from([0x50, 0x4b, 0x03, 0x04, 1]) : Buffer.from('MZfixture'));
  }
  return dir;
}
test('release preparation includes both Macs, Windows, and verifiable checksums', async t => {
  const dir = await fixture(t);
  const files = await prepareRelease(dir, 'v0.1.1', '0.1.1');
  assert.equal(files.length, 4);
  const sums = await fs.readFile(path.join(dir, 'SHA256SUMS.txt'), 'utf8');
  for (const line of sums.trim().split('\n')) {
    const [hash, file] = line.split('  ');
    assert.equal(hash, crypto.createHash('sha256').update(await fs.readFile(path.join(dir, file))).digest('hex'));
  }
  assert.deepEqual(await prepareRelease(dir, 'v0.1.1', '0.1.1'), files);
});
test('release preparation refuses mismatched tags and incomplete platform builds', async t => {
  const dir = await fixture(t);
  await assert.rejects(prepareRelease(dir, 'v9.9.9', '0.1.1'), /tag must match/);
  await fs.unlink(path.join(dir, 'Repo-Tray-0.1.1-win-x64.exe'));
  await assert.rejects(prepareRelease(dir, 'v0.1.1', '0.1.1'), /ENOENT/);
  await assert.rejects(fs.access(path.join(dir, 'SHA256SUMS.txt')));
});
test('release preparation refuses unexpected files and invalid binary formats', async t => {
  const dir = await fixture(t);
  await fs.writeFile(path.join(dir, 'config.json'), 'private');
  await assert.rejects(prepareRelease(dir, 'v0.1.1', '0.1.1'), /Unexpected/);
  await fs.unlink(path.join(dir, 'config.json'));
  await fs.writeFile(path.join(dir, 'Repo-Tray-0.1.1-win-x64.exe'), '<html>Error</html>');
  await assert.rejects(prepareRelease(dir, 'v0.1.1', '0.1.1'), /Incorrect file format/);
});
