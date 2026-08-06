const { contextBridge, shell, webUtils } = require('electron')

contextBridge.exposeInMainWorld('zapcastDesktop', {
  getPathForFile: file => webUtils.getPathForFile(file),
  openExternal: url => shell.openExternal(url)
})
