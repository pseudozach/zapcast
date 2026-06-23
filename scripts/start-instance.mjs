import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import http from 'node:http'
import { randomBytes } from 'node:crypto'
import { appendFile, mkdir, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { build } from 'esbuild'
import { postJson } from '../utils/http-json.js'

const PORT = 43741
const PREFIX = '[zapcast-launcher]'
const COMMANDS_FILE = join(process.cwd(), 'tmp', 'window-commands.jsonl')
const PEAR_EXECUTABLE = resolvePearExecutable()
const ARC_RPC_URLS = [
  'https://rpc.quicknode.testnet.arc.network',
  'https://rpc.blockdaemon.testnet.arc.network',
  'https://rpc.testnet.arc.network'
]
let nextWalletSlot = 2

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
    const command = {
      type: 'open-window',
      instanceId: randomBytes(6).toString('hex'),
      walletSlot: nextWalletSlot++
    }
    queueWindowCommand(command).then(() => {
      sendJson(res, 200, { ok: true, instanceId: command.instanceId })
    }, err => {
      log(`failed to queue window request: ${err.message}`)
      sendJson(res, 500, { ok: false, error: err.message })
    })
    return
  }

  if (req.url === '/arc-rpc') {
    readJson(req).then(forwardArcRpc).then(result => {
      sendJson(res, 200, result)
    }, err => {
      sendJson(res, 200, rpcErrorResponse(null, err))
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
  await buildBrowserClients()
  log(`spawning: ${PEAR_EXECUTABLE} run --dev .`)
  const child = spawn(PEAR_EXECUTABLE, ['run', '--dev', '.'], {
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

function resolvePearExecutable () {
  if (process.env.PEAR_EXECUTABLE) return process.env.PEAR_EXECUTABLE

  const home = process.env.HOME
  const installedPear = home && join(home, 'Library', 'Application Support', 'pear', 'bin', 'pear')
  return installedPear && existsSync(installedPear) ? installedPear : 'pear'
}

async function buildBrowserClients () {
  log('building browser wallet and Nostr bundles')
  const common = {
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: ['chrome120'],
    sourcemap: false,
    legalComments: 'none',
    logLevel: 'silent'
  }
  await build({
    ...common,
    entryPoints: ['ui/wallet-client.js'],
    outfile: 'ui/vendor/wallet-client.js'
  })
  await build({
    ...common,
    entryPoints: ['ui/nostr-client.js'],
    outfile: 'ui/vendor/nostr-client.js'
  })
}

async function requestExistingWindow () {
  try {
    await postJson(`http://127.0.0.1:${PORT}/open`, {})
    return true
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
  log(`queued window ${command.instanceId} with wallet slot ${command.walletSlot}`)
}

async function readJson (req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const text = Buffer.concat(chunks).toString()
  return text ? JSON.parse(text) : {}
}

async function forwardArcRpc (body) {
  let lastError = null
  for (const rpcUrl of ARC_RPC_URLS) {
    try {
      return await postJson(rpcUrl, body)
    } catch (err) {
      lastError = err
      log(`Arc RPC forward failed via ${rpcUrl}: ${err.message}`)
    }
  }
  return rpcErrorResponse(body, lastError)
}

function rpcErrorResponse (body, err) {
  const error = {
    code: -32000,
    message: `Arc RPC unavailable: ${err?.message || 'request failed'}`
  }
  if (Array.isArray(body)) return body.map(item => ({ jsonrpc: '2.0', id: item?.id ?? null, error }))
  return { jsonrpc: '2.0', id: body?.id ?? null, error }
}

function log (message) {
  console.log(`${PREFIX} ${message}`)
}
