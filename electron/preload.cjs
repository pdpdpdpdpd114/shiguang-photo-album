const { contextBridge, ipcRenderer, webUtils } = require('electron');
const call = (channel, ...args) => ipcRenderer.invoke(channel, ...args);
contextBridge.exposeInMainWorld('albumApi', {
  isDesktop: true,
  getLibrary: () => call('library:get'),
  createAlbum: name => call('album:create', name),
  renameAlbum: (id, name) => call('album:rename', id, name),
  deleteAlbum: id => call('album:delete', id),
  importPhotos: (id, kind) => call('photos:pick', id, kind),
  importDropped: (id, files) => call('photos:drop', id, files.map(file => webUtils.getPathForFile(file))),
  cancelImport: () => call('photos:cancel'),
  reorderPhotos: (id, ids) => call('photos:reorder', id, ids),
  setCover: (id, photoId) => call('photos:cover', id, photoId),
  removePhotos: (id, ids) => call('photos:remove', id, ids),
  selectMusic: id => call('music:pick', id),
  removeMusic: id => call('music:remove', id),
  saveSettings: (id, settings) => call('settings:save', id, settings),
  toggleFullscreen: () => call('window:fullscreen'),
  setPlaybackActive: active => call('playback:active', active),
  onImportProgress: callback => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on('import:progress', listener);
    return () => ipcRenderer.removeListener('import:progress', listener);
  },
});
