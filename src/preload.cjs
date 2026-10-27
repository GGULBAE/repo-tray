'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const methods = [
  'getState', 'scan', 'cancelScan', 'addRepositories', 'updateRepository',
  'removeRepository', 'checkNow', 'syncRepository', 'abortOperation',
  'acknowledge', 'setSettings', 'openFolder', 'openExternal', 'hideWindow'
];
const api = Object.fromEntries(methods.map(name => [name, async args => {
  const result = await ipcRenderer.invoke(`repo-tray:${name}`, args);
  if (!result.ok) throw new Error(result.error || '요청을 처리하지 못했습니다.');
  return result.value;
}]));
api.subscribe = callback => {
  if (typeof callback !== 'function') throw new TypeError('A callback is required.');
  const listener = (_event, state) => callback(state);
  ipcRenderer.on('repo-tray:state', listener);
  return () => ipcRenderer.removeListener('repo-tray:state', listener);
};
contextBridge.exposeInMainWorld('repoTray', Object.freeze(api));
