const { app, BrowserWindow } = require('electron')
const { randomBytes } = require('node:crypto')
const path = require('node:path')

app.setName('ZapCast')

const gotLock = app.requestSingleInstanceLock()
let server = null
let nextWalletSlot = 1
let quitting = false

if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => createWindow())
  app.whenReady().then(start).catch(fatal)
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
  app.on('window-all-closed', () => app.quit())
  app.on('before-quit', event => {
    if (quitting || !server) return
    event.preventDefault()
    quitting = true
    server.close().catch(err => console.error('[zapcast-desktop] cleanup failed', err)).finally(() => app.quit())
  })
}

async function start () {
  const dataDirectory = app.getPath('userData')
  process.chdir(dataDirectory)
  const { createZapCastServer } = await import('./server.mjs')
  server = await createZapCastServer({ rootDirectory: path.resolve(__dirname, '..') })
  console.log(`[zapcast-desktop] serving ${server.url} with data in ${dataDirectory}`)
  createWindow()
}

function createWindow () {
  if (!server) return
  const instanceId = randomBytes(6).toString('hex')
  const walletSlot = nextWalletSlot++
  const window = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 920,
    minHeight: 640,
    center: true,
    show: false,
    backgroundColor: '#f5f7f9',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  window.once('ready-to-show', () => window.show())
  window.loadURL(`${server.url}/?instance=${instanceId}&walletSlot=${walletSlot}`).catch(fatal)
}

function fatal (err) {
  console.error('[zapcast-desktop] fatal error', err)
  app.exit(1)
}
