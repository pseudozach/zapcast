const { app, BrowserWindow } = require('electron')
const { spawn } = require('node:child_process')
const { randomBytes } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

if (handleSquirrelEvent()) return

app.setName('ZapCast')
const logFile = initFileLogging()

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
  console.log(`[zapcast-desktop] writing logs to ${logFile}`)
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
  window.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    const source = sourceId ? `${sourceId}:${line || 0}` : `line ${line || 0}`
    console.log(`[renderer:${level}] ${message} (${source})`)
  })
  window.webContents.on('render-process-gone', (_event, details) => {
    console.error('[zapcast-desktop] renderer process gone', details)
  })
  window.webContents.on('unresponsive', () => {
    console.error('[zapcast-desktop] renderer became unresponsive')
  })
  window.webContents.on('responsive', () => {
    console.log('[zapcast-desktop] renderer became responsive')
  })
  window.loadURL(`${server.url}/?instance=${instanceId}&walletSlot=${walletSlot}`).catch(fatal)
}

function fatal (err) {
  console.error('[zapcast-desktop] fatal error', err)
  app.exit(1)
}

function initFileLogging () {
  const directory = process.platform === 'win32' && process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, 'zapcast', 'logs')
    : path.join(app.getPath('userData'), 'logs')
  const file = path.join(directory, 'zapcast.log')
  fs.mkdirSync(directory, { recursive: true })
  rotateLog(file)
  fs.appendFileSync(file, `\n[${new Date().toISOString()}] [info] ZapCast starting ${app.getVersion()} pid=${process.pid} platform=${process.platform} arch=${process.arch}\n`)

  const original = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console)
  }

  const write = (level, args) => {
    const line = `[${new Date().toISOString()}] [${level}] ${args.map(formatLogValue).join(' ')}\n`
    try {
      fs.appendFileSync(file, line)
    } catch {}
  }

  console.log = (...args) => {
    write('info', args)
    original.log(...args)
  }
  console.warn = (...args) => {
    write('warn', args)
    original.warn(...args)
  }
  console.error = (...args) => {
    write('error', args)
    original.error(...args)
  }

  process.on('uncaughtException', err => {
    console.error('[zapcast-desktop] uncaught exception', err)
  })
  process.on('unhandledRejection', reason => {
    console.error('[zapcast-desktop] unhandled rejection', reason)
  })

  return file
}

function rotateLog (file) {
  try {
    const maxBytes = 2 * 1024 * 1024
    if (fs.statSync(file).size <= maxBytes) return
    fs.renameSync(file, `${file}.old`)
  } catch {}
}

function formatLogValue (value) {
  if (value instanceof Error) return `${value.stack || value.message}`
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function handleSquirrelEvent () {
  if (process.platform !== 'win32' || process.argv.length < 2) return false

  const event = process.argv[1]
  if (!event?.startsWith('--squirrel-')) return false

  const appDirectory = path.dirname(process.execPath)
  const updateExe = path.resolve(appDirectory, '..', 'Update.exe')
  const exeName = path.basename(process.execPath)

  const runUpdate = args => {
    try {
      spawn(updateExe, args, { detached: true })
    } catch (err) {
      console.error('[zapcast-desktop] squirrel shortcut operation failed', err)
    }
  }

  switch (event) {
    case '--squirrel-install':
    case '--squirrel-updated':
      runUpdate(['--createShortcut', exeName])
      setTimeout(() => app.quit(), 1000)
      return true
    case '--squirrel-uninstall':
      runUpdate(['--removeShortcut', exeName])
      setTimeout(() => app.quit(), 1000)
      return true
    case '--squirrel-obsolete':
      app.quit()
      return true
    default:
      return false
  }
}
