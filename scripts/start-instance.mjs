import { spawn } from 'node:child_process'
import http from 'node:http'
import { randomBytes } from 'node:crypto'
import { appendFile, mkdir, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { build } from 'esbuild'

const PORT = 43741
const PREFIX = '[zapcast-launcher]'
const COMMANDS_FILE = join(process.cwd(), 'tmp', 'window-commands.jsonl')

log(`starting from ${process.cwd()}`)

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'content-type')
  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  if (req.url === '/open') {
    const command = { type: 'open-window', instanceId: randomBytes(6).toString('hex') }
    queueWindowCommand(command).then(() => {
      sendJson(res, 200, { ok: true, instanceId: command.instanceId })
    }, err => {
      log(`failed to queue window request: ${err.message}`)
      sendJson(res, 500, { ok: false, error: err.message })
    })
    return
  }

  if (req.url === '/commands') {
    sendJson(res, 410, { ok: false, error: 'Window commands are served by /api/window-commands' })
    return
  }

  sendJson(res, 404, { ok: false, error: 'Not found' })
})

server.once('error', async err => {
  if (err.code !== 'EADDRINUSE') throw err
  log(`port ${PORT} is already in use; asking existing ZapCast instance to open a window`)
  const opened = await requestExistingWindow()
  log(opened ? 'existing instance accepted open-window request' : 'existing instance did not respond')
  process.exit(opened ? 0 : 1)
})

server.listen(PORT, '127.0.0.1', () => {
  log(`primary instance listening on http://127.0.0.1:${PORT}`)
  unlink(COMMANDS_FILE).catch(() => {})
  startPear().catch(err => {
    log(`failed to start Pear: ${err.message}`)
    server.close(() => {
      process.exitCode = 1
    })
  })
})

async function startPear () {
  await buildWalletClient()
  log('spawning: pear run --dev .')
  const child = spawn('pear', ['run', '--dev', '.'], {
    cwd: process.cwd(),
    stdio: 'inherit'
  })

  child.on('error', err => {
    log(`failed to spawn pear: ${err.message}`)
    server.close(() => {
      process.exitCode = 1
    })
  })

  child.on('exit', code => {
    log(`pear exited with code ${code ?? 0}`)
    server.close(() => {
      process.exitCode = code ?? 0
    })
  })
}

async function buildWalletClient () {
  log('building browser wallet bundle')
  await build({
    entryPoints: ['ui/wallet-client.js'],
    outfile: 'ui/vendor/wallet-client.js',
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: ['chrome120'],
    sourcemap: false,
    legalComments: 'none',
    logLevel: 'silent'
  })
}

async function requestExistingWindow () {
  try {
    const response = await fetch(`http://127.0.0.1:${PORT}/open`, { method: 'POST' })
    if (!response.ok) log(`existing instance returned HTTP ${response.status}`)
    return response.ok
  } catch (err) {
    log(`failed to contact existing instance: ${err.message}`)
    return false
  }
}

function sendJson (res, statusCode, payload) {
  res.writeHead(statusCode, { 'content-type': 'application/json' })
  res.end(JSON.stringify(payload))
}

async function queueWindowCommand (command) {
  await mkdir(dirname(COMMANDS_FILE), { recursive: true })
  await appendFile(COMMANDS_FILE, `${JSON.stringify(command)}\n`)
  log(`queued new window request for instance ${command.instanceId} in ${COMMANDS_FILE}`)
}

function log (message) {
  console.log(`${PREFIX} ${message}`)
}
