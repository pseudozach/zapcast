import http from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { ZapCastApp } from '../src/app-controller.js'
import { postJson } from '../utils/http-json.js'

const ARC_RPC_URLS = [
  'https://rpc.quicknode.testnet.arc.network',
  'https://rpc.blockdaemon.testnet.arc.network',
  'https://rpc.testnet.arc.network'
]

const CONTENT_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
}

export async function createZapCastServer ({ rootDirectory }) {
  const root = resolve(rootDirectory)
  const apps = new Map()
  const server = http.createServer((req, res) => handleRequest({ req, res, root, apps }))

  await new Promise((resolveReady, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolveReady)
  })

  const address = server.address()
  return {
    url: `http://127.0.0.1:${address.port}`,
    async close () {
      await Promise.allSettled([...apps.values()].map(app => app.close()))
      apps.clear()
      await new Promise(resolveClose => server.close(resolveClose))
    }
  }
}

async function handleRequest ({ req, res, root, apps }) {
  const url = new URL(req.url, 'http://localhost')
  try {
    if (url.pathname === '/api/arc-rpc') {
      sendRawJson(res, await forwardArcRpc(await readJson(req)))
      return
    }

    if (url.pathname.startsWith('/api/')) {
      const instanceId = url.searchParams.get('instance') || 'main'
      const walletSlot = normalizeWalletSlot(url.searchParams.get('walletSlot'))
      const app = getApp(apps, instanceId, walletSlot)
      const result = await dispatchApi(app, url.pathname, await readJson(req), url)
      sendJson(res, 200, { ok: true, result })
      return
    }

    await serveStatic(root, url.pathname, res)
  } catch (err) {
    console.error(`[zapcast-desktop] ${req.method} ${url.pathname} failed`, err)
    if (url.pathname.startsWith('/api/')) {
      sendJson(res, 500, { ok: false, error: err?.message || String(err) })
    } else {
      sendText(res, 500, 'Internal server error')
    }
  }
}

function getApp (apps, instanceId, walletSlot) {
  let instance = apps.get(instanceId)
  if (!instance) {
    instance = new ZapCastApp({ instanceId, walletSlot })
    apps.set(instanceId, instance)
  }
  return instance
}

async function dispatchApi (app, pathname, body, url) {
  switch (pathname) {
    case '/api/status': {
      const status = await app.status()
      const recordAfter = Number(url.searchParams.get('recordAfter') || -1)
      return { ...status, records: app.recordsAfter(recordAfter) }
    }
    case '/api/wallet': return app.walletSnapshot()
    case '/api/records': return app.recordsAfter(Number(url.searchParams.get('after') || -1))
    case '/api/window-commands': return []
    case '/api/create-stream': return app.createStream()
    case '/api/start-ingest': return app.startIngest(body)
    case '/api/stop-ingest':
      app.stopIngest()
      return app.status()
    case '/api/join-stream': return app.joinStream(body.streamId)
    case '/api/stop-viewing':
      await app.stopViewing()
      return app.status()
    case '/api/topology': return app.updateTopology(body)
    case '/api/zap': return app.zap(body.sats || 1000)
    case '/api/tip': return app.tipBroadcaster(body)
    case '/api/payment-settings': return app.updatePaymentSettings(body)
    case '/api/reveal-wallet': return app.revealWallet()
    case '/api/import-wallet': return app.importWallet(body)
    case '/api/record-transfer': return app.recordTransfer(body)
    case '/api/export-json': return app.exportJson()
    case '/api/export-csv': return app.exportCsv()
    case '/api/error':
      app.metrics.recordError(new Error(body.message || 'Renderer error'))
      return app.status()
    case '/api/playback-report': return app.updatePlaybackReport(body)
    default: throw new Error(`Unknown API route: ${pathname}`)
  }
}

async function forwardArcRpc (body) {
  let lastError
  for (const url of ARC_RPC_URLS) {
    try {
      return await postJson(url, body)
    } catch (err) {
      lastError = err
      console.warn(`[zapcast-desktop] Arc RPC failed via ${url}: ${err.message}`)
    }
  }
  const error = { code: -32000, message: `Arc RPC unavailable: ${lastError?.message || 'request failed'}` }
  if (Array.isArray(body)) return body.map(item => ({ jsonrpc: '2.0', id: item?.id ?? null, error }))
  return { jsonrpc: '2.0', id: body?.id ?? null, error }
}

async function serveStatic (root, pathname, res) {
  const relativePath = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '')
  const isPublicAsset = relativePath === 'index.html' || relativePath.startsWith('ui/') || relativePath === 'player/mse-player.js'
  if (!isPublicAsset) {
    sendText(res, 404, 'Not found')
    return
  }
  const file = resolve(root, relativePath)
  if (file !== root && !file.startsWith(`${root}${sep}`)) {
    sendText(res, 403, 'Forbidden')
    return
  }

  try {
    const content = await readFile(file)
    res.writeHead(200, {
      'content-type': CONTENT_TYPES[extname(file)] || 'application/octet-stream',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff'
    })
    res.end(content)
  } catch (err) {
    if (err.code !== 'ENOENT' && err.code !== 'EISDIR') throw err
    sendText(res, 404, 'Not found')
  }
}

async function readJson (req) {
  if (req.method === 'GET' || req.method === 'HEAD') return {}
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const text = Buffer.concat(chunks).toString()
  return text ? JSON.parse(text) : {}
}

function normalizeWalletSlot (value) {
  const slot = Number(value)
  return Number.isInteger(slot) && slot > 0 ? slot : 1
}

function sendJson (res, statusCode, payload) {
  res.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(payload))
}

function sendRawJson (res, payload) {
  sendJson(res, 200, payload)
}

function sendText (res, statusCode, text) {
  res.writeHead(statusCode, { 'content-type': 'text/plain; charset=utf-8' })
  res.end(text)
}
