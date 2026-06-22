const { contextBridge, webUtils } = require('electron')

contextBridge.exposeInMainWorld('zapcastDesktop', {
  getPathForFile: file => webUtils.getPathForFile(file)
})
