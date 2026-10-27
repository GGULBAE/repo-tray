'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { configureLoginItem } = require('../src/core/login.cjs');

test('repeated launches do not re-register an enabled login item', () => {
  let registered = false;
  const calls = [];
  const app = {
    getLoginItemSettings: options => { assert.deepEqual(options.args, ['--hidden']); return { openAtLogin: registered }; },
    setLoginItemSettings: options => { calls.push(options); registered = options.openAtLogin; }
  };
  configureLoginItem(app, true);
  configureLoginItem(app, true);
  assert.equal(calls.length, 1);
  configureLoginItem(app, false);
  configureLoginItem(app, false);
  assert.equal(calls.length, 2);
  assert.equal(registered, false);
});

test('pending macOS approval is not requested again and can be disabled explicitly', () => {
  const calls = [];
  const app = {
    getLoginItemSettings: () => ({ openAtLogin: false, status: 'requires-approval' }),
    setLoginItemSettings: options => calls.push(options)
  };
  configureLoginItem(app, true);
  configureLoginItem(app, true);
  assert.equal(calls.length, 0);
  configureLoginItem(app, false);
  assert.deepEqual(calls, [{ openAtLogin: false, args: ['--hidden'] }]);
});
