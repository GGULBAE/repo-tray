'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');
const { _electron } = require('playwright');
const run = promisify(execFile);
const project = path.resolve(__dirname, '..');
const env = { ...process.env, REPO_TRAY_SMOKE_TEST: '1', GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1' };
delete env.ELECTRON_RUN_AS_NODE;
let desktop;
let root;
const git = async (cwd, ...args) => (await run('git', ['-C', cwd, ...args], { env })).stdout.trim();
const writeCommit = async (cwd, file, content, subject) => {
  await fs.writeFile(path.join(cwd, file), content);
  await git(cwd, 'add', '--', file);
  await git(cwd, 'commit', '-m', subject);
};
(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'repo-tray-desktop-')));
  const remote = path.join(root, 'origin.git');
  const writer = path.join(root, 'author');
  const reader = path.join(root, 'studio-web');
  const linked = path.join(root, 'studio-web-feature');
  await fs.mkdir(remote);
  await git(remote, 'init', '--bare', '--initial-branch=main');
  await git(root, 'clone', remote, writer);
  await git(writer, 'config', 'user.name', 'Repo Tray Test');
  await git(writer, 'config', 'user.email', 'test@example.invalid');
  await git(writer, 'config', 'commit.gpgSign', 'false');
  await writeCommit(writer, 'hello.txt', 'initial\n', '프로젝트 시작');
  await git(writer, 'push', '-u', 'origin', 'main');
  await git(root, 'clone', remote, reader);
  await git(reader, 'config', 'user.name', 'Repo Tray Test');
  await git(reader, 'config', 'user.email', 'test@example.invalid');
  await git(reader, 'config', 'commit.gpgSign', 'false');
  await git(reader, 'worktree', 'add', '-b', 'feature', linked);
  env.REPO_TRAY_USER_DATA = path.join(root, 'app-data');
  env.REPO_TRAY_TEST_HOME = root;
  desktop = await _electron.launch({
    executablePath: process.env.REPO_TRAY_EXECUTABLE || require('electron'),
    args: process.env.REPO_TRAY_EXECUTABLE ? [] : [project], env, timeout: 30000
  });
  const page = await desktop.firstWindow();
  const waitForState = async (predicate, target = page) => {
    const deadline = Date.now() + 20000;
    let value;
    while (Date.now() < deadline) {
      value = await target.evaluate(() => window.repoTray.getState());
      if (predicate(value)) return value;
      await new Promise(resolve => setTimeout(resolve, 60));
    }
    throw new Error(`State wait timed out: ${JSON.stringify(value)}`);
  };
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.waitForFunction(() => Boolean(window.repoTray), undefined, { timeout: 15000 });
  await page.waitForFunction(() => !document.querySelector('.boot-screen'), undefined, { timeout: 15000 });
  const initial = await page.evaluate(() => window.repoTray.getState());
  assert.equal(initial.gitAvailable, true);
  assert.equal(initial.repositories.length, 0);
  assert.equal(initial.scan.running, false);
  assert.equal(await page.evaluate(() => typeof require), 'undefined');
  const invalid = await page.evaluate(async () => { try { await window.repoTray.setSettings({ defaultIntervalMinutes: 0 }); } catch (error) { return error.message; } });
  assert.match(invalid, /1.*10,?080/);
  await desktop.evaluate(({ dialog }, fixtureRoot) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fixtureRoot] }); }, root);
  await page.evaluate(() => window.repoTray.scan({ mode: 'folder' }));
  await waitForState(state => !state.scan.running);
  const scanned = await page.evaluate(() => window.repoTray.getState());
  const found = scanned.scan.found.find(repo => repo.name === 'studio-web');
  assert.ok(found);
  assert.ok(scanned.scan.found.some(repo => repo.bare));
  const linkedFound = scanned.scan.found.find(repo => repo.path === linked);
  assert.equal(linkedFound.groupKey, found.groupKey);
  assert.notEqual(scanned.scan.found.find(repo => repo.path === writer).groupKey, found.groupKey);
  await page.evaluate(() => { location.hash = '#discovery'; });
  // IPC completion precedes the debounced renderer update; a streamed first row
  // does not mean the completed discovery result has reached the screen.
  await page.waitForFunction(() => document.querySelectorAll('.discovery-table tbody tr').length === 3 && document.querySelector('[data-action="scan-full"]'), undefined, { timeout: 20000 });
  assert.equal(await page.locator('.discovery-table tbody tr').count(), 3, 'one discovery row per common Git repository');
  assert.equal(await page.getByRole('button', { name: '기본 폴더에서 찾기', exact: true }).count(), 1);
  const picker = page.locator('select[data-select="worktree-path"]');
  assert.equal(await picker.count(), 1);
  await picker.selectOption(found.path);
  const groupRow = page.locator('.discovery-table tbody tr').filter({ has: picker });
  await groupRow.getByRole('checkbox').check();
  await picker.selectOption(linked);
  const previousPicker = await picker.elementHandle();
  await page.evaluate(() => window.repoTray.setSettings({ defaultIntervalMinutes: 60 }));
  await page.waitForFunction(element => !element.isConnected, previousPicker);
  await previousPicker.dispose();
  assert.equal(await picker.inputValue(), linked, 'chosen worktree survives background state updates');
  assert.equal(await groupRow.getByRole('checkbox').isChecked(), true);
  assert.equal(await groupRow.getByRole('checkbox').getAttribute('data-path'), linked);
  await picker.selectOption(found.path);
  if (process.env.REPO_TRAY_DISCOVERY_SCREENSHOT) {
    await fs.mkdir(path.dirname(process.env.REPO_TRAY_DISCOVERY_SCREENSHOT), { recursive: true });
    await page.locator('h1').click();
    await page.screenshot({ path: process.env.REPO_TRAY_DISCOVERY_SCREENSHOT, fullPage: true });
  }
  await page.evaluate(paths => window.repoTray.addRepositories({ paths, intervalMinutes: 60 }), [found.path, linked, found.path]);
  await waitForState(state => state.repositories[0]?.state && !state.repositories[0].checking);
  let state = await page.evaluate(() => window.repoTray.getState());
  assert.equal(state.repositories.length, 1, 'duplicate path/worktree submissions register once');
  assert.equal(state.repositories[0].groupKey, found.groupKey);
  await page.evaluate(repoPath => window.repoTray.addRepositories({ paths: [repoPath], intervalMinutes: 60 }), linked);
  assert.equal((await page.evaluate(() => window.repoTray.getState())).repositories.length, 1, 'registered group cannot be added through another worktree');
  await page.evaluate(() => { location.hash = '#overview'; });
  await page.getByRole('button', { name: 'studio-web', exact: true }).waitFor({ state: 'visible' });
  const id = state.repositories[0].id;
  assert.equal(state.repositories[0].pending, false);
  await writeCommit(writer, 'hello.txt', 'remote update\n', '검색 화면 접근성 개선');
  await git(writer, 'push');
  await page.evaluate(id => window.repoTray.checkNow({ id }), id);
  state = await page.evaluate(() => window.repoTray.getState());
  assert.equal(state.repositories[0].pending, true);
  assert.equal(state.repositories[0].state.behind, 1);
  assert.equal(await fs.readFile(path.join(reader, 'hello.txt'), 'utf8'), 'initial\n');
  await page.locator('.attention-banner').waitFor({ state: 'visible' });
  assert.equal(await desktop.evaluate(() => global.__repoTrayTest.getTrayStatus().kind), 'pending');
  assert.match(await desktop.evaluate(() => global.__repoTrayTest.getTrayStatus().tooltip), /1개 저장소/);
  await page.getByRole('button', { name: 'studio-web', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  await page.getByRole('button', { name: '동기화', exact: true }).click();
  await waitForState(state => !state.repositories[0].syncing && state.repositories[0].state?.behind === 0);
  assert.equal(await fs.readFile(path.join(reader, 'hello.txt'), 'utf8'), 'remote update\n');
  await writeCommit(writer, 'hello.txt', 'second remote update\n', '저장소 탐색 결과 필터 추가');
  await git(writer, 'push');
  await fs.writeFile(path.join(reader, 'draft.txt'), 'unfinished local work\n');
  await page.evaluate(id => window.repoTray.checkNow({ id }), id);
  const dirtyError = await page.evaluate(async id => { try { await window.repoTray.syncRepository({ id, strategy: 'ff-only' }); } catch (error) { return error.message; } }, id);
  assert.match(dirtyError, /수정 중/);
  assert.equal(await fs.readFile(path.join(reader, 'draft.txt'), 'utf8'), 'unfinished local work\n');
  await fs.unlink(path.join(reader, 'draft.txt'));
  await page.evaluate(id => window.repoTray.checkNow({ id }), id);
  await page.evaluate(id => window.repoTray.updateRepository({ id, intervalMinutes: 300, paused: true }), id);
  state = await page.evaluate(() => window.repoTray.getState());
  assert.equal(state.repositories[0].intervalMinutes, 300);
  assert.equal(state.repositories[0].paused, true);
  await page.evaluate(id => window.repoTray.updateRepository({ id, paused: false }), id);
  await waitForState(state => !state.repositories[0].checking && !state.repositories[0].syncing);
  await page.waitForFunction(repoId => {
    const interval = document.querySelector(`.interval-button[data-id="${repoId}"]`);
    return interval?.textContent.includes('5시간') && interval.parentElement.querySelector('.cell-note')?.textContent !== '일시정지';
  }, id);
  await page.keyboard.press('Escape');
  if (process.env.REPO_TRAY_SCREENSHOT) {
    await fs.mkdir(path.dirname(process.env.REPO_TRAY_SCREENSHOT), { recursive: true });
    await page.locator('.toast').waitFor({ state: 'detached', timeout: 10000 });
    await page.locator('h1').click();
    await page.screenshot({ path: process.env.REPO_TRAY_SCREENSHOT, fullPage: true });
  }
  await page.evaluate(() => window.repoTray.hideWindow());
  assert.equal(await desktop.evaluate(() => global.__repoTrayTest.getWindow().isVisible()), false);
  assert.equal(await desktop.evaluate(() => global.__repoTrayTest.getTray().isDestroyed()), false);
  await desktop.evaluate(() => global.__repoTrayTest.showWindow('settings'));
  await page.waitForFunction(() => location.hash === '#settings');
  await desktop.close(); desktop = null;
  const persisted = JSON.parse(await fs.readFile(path.join(env.REPO_TRAY_USER_DATA, 'config.json'), 'utf8'));
  assert.equal(persisted.repositories[0].intervalMinutes, 300);
  assert.equal(persisted.repositories[0].paused, false);
  assert.equal(persisted.repositories[0].groupKey, found.groupKey);
  assert.deepEqual(persisted.scanPreferences.deniedPaths, []);
  assert.equal(pageErrors.length, 0, pageErrors.join('\n'));
  // Upgrade regression: a legacy registration may not be in the next scan's roots.
  delete persisted.repositories[0].groupKey;
  persisted.repositories[0].paused = true;
  await fs.writeFile(path.join(env.REPO_TRAY_USER_DATA, 'config.json'), JSON.stringify(persisted));
  desktop = await _electron.launch({
    executablePath: process.env.REPO_TRAY_EXECUTABLE || require('electron'),
    args: process.env.REPO_TRAY_EXECUTABLE ? [] : [project], env, timeout: 30000
  });
  const upgradedPage = await desktop.firstWindow();
  await upgradedPage.waitForFunction(() => Boolean(window.repoTray));
  await desktop.evaluate(({ dialog }, onlyLinked) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [onlyLinked] }); }, linked);
  await upgradedPage.evaluate(() => window.repoTray.scan({ mode: 'folder' }));
  await waitForState(state => !state.scan.running, upgradedPage);
  await upgradedPage.evaluate(repoPath => window.repoTray.addRepositories({ paths: [repoPath], intervalMinutes: 60 }), linked);
  const upgraded = await upgradedPage.evaluate(() => window.repoTray.getState());
  assert.equal(upgraded.repositories.length, 1, 'legacy main checkout excludes a separately scanned linked checkout');
  assert.equal(upgraded.repositories[0].groupKey, found.groupKey);
  await desktop.close(); desktop = null;
  console.log('Desktop smoke passed: grouped discovery → duplicate/worktree registration protection → fetch/red tray → user sync → dirty-work protection → settings → hide/reopen → persistence.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (desktop) await desktop.close().catch(() => {});
  if (root) await fs.rm(root, { recursive: true, force: true });
});
