import Runtime from 'pear-electron'
import Bridge from 'pear-bridge'
import { ZapCastApp } from './app-controller.js'
import { DEFAULTS } from './config.js'
import { fsPromises, joinPath } from '../utils/platform.js'
import { postJson } from '../utils/http-json.js'

const WINDOW_COMMANDS_FILE = joinPath(DEFAULTS.dataDirectory, 'window-commands.jsonl')
const ARC_RPC_PROXY_URL = 'http://127.0.0.1:43741/arc-rpc'

const runtime = new Runtime()
log('runtime created')
await runtime.ready?.()

const bridge = new Bridge()
const apps = new Map()
attachApi(bridge, apps)
await bridge.ready()
bridge.ref()
log(`bridge ready at ${bridge.addr || 'unknown address'}`)

log('starting Pear Electron UI')
const pipe = await runtime.start({ bridge })
log('Pear Electron UI started')

Pear.teardown(async () => {
  log('tearing down')
  for (const app of apps.values()) await app.close()
  await bridge.close()
  pipe?.end?.()
})

function attachApi (bridge, apps) {
  const staticHandler = bridge.server.rawListeners('request')[0]
  if (typeof staticHandler !== 'function') throw new Error('Pear Bridge request handler not found')
  bridge.server.removeAllListeners('request')
  bridge.server.on('request', async (req, res) => {
    const url = new URL(req.url, 'http://localhost')
    if (!url.pathname.startsWith('/api/')) {
      if (url.pathname === '/' || url.pathname.endsWith('.js') || url.pathname.endsWith('.html')) {
        log(`static ${req.method || 'GET'} ${url.pathname}`)
      }
      return staticHandler.call(bridge.server, req, res)
    }

    if (url.pathname === '/api/arc-rpc') {
      try {
        const body = await readJson(req)
        const result = await forwardArcRpc(body)
        sendRawJson(res, 200, result)
      } catch (err) {
        sendRawJson(res, 200, rpcErrorResponse(null, err))
      }
      return
    }

    const instanceId = url.searchParams.get('instance') || 'main'
    const walletSlot = normalizeWalletSlot(url.searchParams.get('walletSlot'))
    const app = getApp(apps, instanceId, walletSlot)
    try {
      const body = await readJson(req)
      const result = await dispatchApi(app, url.pathname, body, url)
      sendJson(res, 200, { ok: true, result })
    } catch (err) {
      const message = err?.message || String(err)
      app.metrics?.recordError?.(err)
      sendJson(res, 500, { ok: false, error: message })
    }
  })
}

function getApp (apps, instanceId, walletSlot) {
  let app = apps.get(instanceId)
  if (app) return app
  app = new ZapCastApp({ instanceId, walletSlot })
  apps.set(instanceId, app)
  return app
}

function normalizeWalletSlot (value) {
  const slot = Number(value)
  return Number.isInteger(slot) && slot > 0 ? slot : 1
}

async function dispatchApi (app, pathname, body, url) {
  switch (pathname) {
    case '/api/status': {
      const status = await app.status()
      const recordAfter = Number(url.searchParams.get('recordAfter') || -1)
      return { ...status, records: app.recordsAfter(recordAfter) }
    }
    case '/api/wallet':
      return app.walletSnapshot()
    case '/api/records':
      return app.recordsAfter(Number(url.searchParams.get('after') || -1))
    case '/api/window-commands':
      return drainWindowCommands()
    case '/api/create-stream':
      return app.createStream()
    case '/api/start-ingest':
      return app.startIngest(body)
    case '/api/stop-ingest':
      app.stopIngest()
      return await app.status()
    case '/api/join-stream':
      return app.joinStream(body.streamId)
    case '/api/stop-viewing':
      await app.stopViewing()
      return await app.status()
    case '/api/topology':
      return app.updateTopology(body)
    case '/api/zap':
      return app.zap(body.sats || 1000)
    case '/api/tip':
      return app.tipBroadcaster(body)
    case '/api/payment-settings':
      return app.updatePaymentSettings(body)
    case '/api/reveal-wallet':
      return app.revealWallet()
    case '/api/import-wallet':
      return app.importWallet(body)
    case '/api/record-transfer':
      return app.recordTransfer(body)
    case '/api/export-json':
      return app.exportJson()
    case '/api/export-csv':
      return app.exportCsv()
    case '/api/error':
      app.metrics.recordError(new Error(body.message || 'Renderer error'))
      return await app.status()
    case '/api/playback-report':
      return app.updatePlaybackReport(body)
    default:
      throw new Error(`Unknown API route: ${pathname}`)
  }
}

async function readJson (req) {
  if (req.method === 'GET' || req.method === 'HEAD') return {}
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const text = Buffer.concat(chunks).toString()
  return text ? JSON.parse(text) : {}
}

function sendJson (res, statusCode, payload) {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(payload))
}

function sendRawJson (res, statusCode, payload) {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(payload))
}

async function forwardArcRpc (body) {
  try {
    return await postJson(ARC_RPC_PROXY_URL, body)
  } catch (err) {
    log(`Arc RPC local proxy failed: ${err.message}`)
    return rpcErrorResponse(body, err)
  }
}

function rpcErrorResponse (body, err) {
  const error = {
    code: -32000,
    message: `Arc RPC unavailable: ${err?.message || 'request failed'}`
  }
  if (Array.isArray(body)) return body.map(item => ({ jsonrpc: '2.0', id: item?.id ?? null, error }))
  return { jsonrpc: '2.0', id: body?.id ?? null, error }
}

async function drainWindowCommands () {
  const fs = await fsPromises()
  let text = ''
  try {
    text = await fs.readFile(WINDOW_COMMANDS_FILE, 'utf8')
    await fs.unlink(WINDOW_COMMANDS_FILE).catch(() => {})
  } catch (err) {
    if (err.code === 'ENOENT') return []
    throw err
  }

  const commands = text
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => JSON.parse(line))

  if (commands.length) log(`drained ${commands.length} window command(s)`)
  return commands
}

function log (message) {
  console.log(`[zapcast-main] ${message}`)
}
