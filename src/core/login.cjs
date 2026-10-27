'use strict';

function configureLoginItem(app, launchAtLogin) {
  const args = ['--hidden'];
  const desired = Boolean(launchAtLogin);
  const current = app.getLoginItemSettings({ args });
  // macOS may keep openAtLogin false while its existing registration awaits approval.
  const registered = current.openAtLogin || ['enabled', 'requires-approval'].includes(current.status);
  if (Boolean(registered) !== desired) app.setLoginItemSettings({ openAtLogin: desired, args });
}

module.exports = { configureLoginItem };
