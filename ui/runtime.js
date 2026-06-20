import ui from 'pear-electron'

class ApiClient {
  constructor (instanceId) {
    this.instanceId = instanceId
    this.listeners = new Map()
    this.lastEventCount = 0
    this.lastRecordSeq = -1
    this.lastStatus = emptyStatus()
    this.recordPollDebug = {
      polls: 0,
      recordsReceived: 0,
      recordsEmitted: 0,
      lastCount: 0,
      lastAfter: -1,
      lastSeq: -1,
      lastDataShape: ''
    }
    this.failedPolls = new Map()
    this.suspendedPolls = new Set()
    this.ready = this.initialize()
    this.poll()
    this.pollRecords()
    this.pollWindowCommands()
    this.timers = [
      setInterval(() => this.poll(), 1000),
      setInterval(() => this.pollRecords(), 500),
      setInterval(() => this.pollWindowCommands(), 1000)
    ]
  }

  on (event, handler) {
    const handlers = this.listeners.get(event) || new Set()
    handlers.add(handler)
    this.listeners.set(event, handlers)
  }

  emit (event, payload) {
    for (const handler of this.listeners.get(event) || []) handler(payload)
  }

  async createStream () {
    return this.post('/api/create-stream')
  }

  async startIngest (payload) {
    const result = await this.post('/api/start-ingest', payload)
    await this.poll()
    return result
  }

  async stopIngest () {
    const result = await this.post('/api/stop-ingest')
    await this.poll()
    return result
  }

  async joinStream (streamId) {
    this.lastRecordSeq = -1
    return this.post('/api/join-stream', { streamId })
  }

  async stopViewing () {
    const result = await this.post('/api/stop-viewing')
    this.lastRecordSeq = -1
    await this.poll()
    return result
  }

  async updateTopology (payload) {
    return this.post('/api/topology', payload)
  }

  async zap (sats = 1000) {
    return this.post('/api/zap', { sats })
  }

  async tip (payload) {
    return this.post('/api/tip', payload)
  }

  async importWallet (payload) {
    const wallet = await this.post('/api/import-wallet', payload)
    await this.poll()
    return wallet
  }

  async recordTransfer (payload) {
    const result = await this.post('/api/record-transfer', payload)
    await this.poll()
    return result
  }

  async updatePaymentSettings (payload) {
    const result = await this.post('/api/payment-settings', payload)
    await this.poll()
    return result
  }

  async revealWallet () {
    return this.post('/api/reveal-wallet')
  }

  async wallet () {
    const wallet = await this.get('/api/wallet')
    this.lastStatus = {
      ...this.status(),
      wallet,
      metrics: {
        ...this.status().metrics,
        wallet,
        payment: wallet.address
          ? { type: 'arc-testnet', chain: 'arc-testnet', asset: wallet.asset, address: wallet.address }
          : this.status().metrics.payment
      }
    }
    this.emit('metrics', this.lastStatus.metrics)
    return wallet
  }

  async exportJson () {
    return this.post('/api/export-json')
  }

  async exportCsv () {
    return this.post('/api/export-csv')
  }

  async reportError (err) {
    return this.post('/api/error', { message: err?.message || String(err) }).catch(() => {})
  }

  async reportPlayback (snapshot) {
    return this.post('/api/playback-report', snapshot).catch(() => {})
  }

  status () {
    return this.lastStatus || emptyStatus()
  }

  async initialize () {
    await this.wallet().catch(err => this.handlePollError('wallet', err))
    await this.poll()
  }

  recordDebug () {
    return { ...this.recordPollDebug }
  }

  async poll () {
    if (this.suspendedPolls.has('status')) return
    try {
      const status = await this.get('/api/status')
      this.resetPollError('status')
      this.lastStatus = status
      this.emit('metrics', status.metrics)
      const events = status.events || []
      for (const event of events.slice(this.lastEventCount)) this.emit('event', event)
      this.lastEventCount = events.length
    } catch (err) {
      this.handlePollError('status', err)
    }
  }

  async pollRecords () {
    if (this.suspendedPolls.has('record')) return
    try {
      this.recordPollDebug.polls++
      this.recordPollDebug.lastAfter = this.lastRecordSeq
      const records = await this.get(`/api/records?after=${encodeURIComponent(this.lastRecordSeq)}`)
      this.resetPollError('record')
      this.recordPollDebug.lastCount = Array.isArray(records) ? records.length : 0
      for (const record of records) {
        const seq = Number(record.meta?.seq ?? -1)
        this.recordPollDebug.recordsReceived++
        this.recordPollDebug.lastSeq = seq
        this.recordPollDebug.lastDataShape = describeData(record.data)
        this.emit('record', record)
        this.recordPollDebug.recordsEmitted++
        this.lastRecordSeq = Math.max(this.lastRecordSeq, seq)
      }
    } catch (err) {
      this.handlePollError('record', err)
    }
  }

  async get (path) {
    const response = await fetch(this.path(path), { headers: { accept: 'application/json' } })
    return this.unwrap(response)
  }

  async post (path, body = {}) {
    const response = await fetch(this.path(path), {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body)
    })
    return this.unwrap(response)
  }

  async unwrap (response) {
    const payload = await response.json()
    if (!payload.ok) throw new Error(payload.error || `Request failed: ${response.status}`)
    return payload.result
  }

  async pollWindowCommands () {
    try {
      const commands = await this.get('/api/window-commands')
      this.resetPollError('window command')
      for (const command of commands) {
        if (command.type !== 'open-window') continue
        console.info(`ZapCast opening secondary window for instance ${command.instanceId}`)
        const win = new ui.Window(`./index.html?instance=${encodeURIComponent(command.instanceId)}`, {
          width: 1180,
          height: 820,
          minWidth: 920,
          minHeight: 640,
          center: true,
          show: true,
          backgroundColor: '#f5f7f9'
        })
        await win.open({ show: true })
        await win.focus({ steal: true })
      }
    } catch (err) {
      this.handlePollError('window command', err)
    }
  }

  handlePollError (label, err) {
    const count = (this.failedPolls.get(label) || 0) + 1
    this.failedPolls.set(label, count)
    if (count <= 3 || count % 30 === 0) {
      console.error(`ZapCast ${label} poll failed`, err)
    }

    if (label !== 'window command' && count > 5) {
      this.suspendedPolls.add(label)
      const status = this.lastStatus || emptyStatus()
      status.metrics = {
        ...status.metrics,
        playbackState: 'disconnected',
        connectedToBroadcaster: false
      }
      this.lastStatus = status
      this.emit('metrics', status.metrics)
      console.error(`ZapCast ${label} polling suspended after repeated failures. Window-command polling is still active.`)
    }
  }

  resetPollError (label) {
    this.failedPolls.delete(label)
    this.suspendedPolls.delete(label)
  }

  path (path) {
    const separator = path.includes('?') ? '&' : '?'
    return `${path}${separator}instance=${encodeURIComponent(this.instanceId)}`
  }
}

function describeData (data) {
  if (data instanceof Uint8Array) return `Uint8Array(${data.byteLength})`
  if (typeof data === 'string') return `string(${data.length})`
  if (Array.isArray(data)) return `array(${data.length})`
  if (Array.isArray(data?.data)) return `${data.type || 'object'}.data(${data.data.length})`
  if (data && typeof data === 'object') return `object(${Object.keys(data).length})`
  return String(data)
}

const instanceId = getInstanceId()
window.__zapcastInitialInstanceId = instanceId
window.zapCastApp = new ApiClient(instanceId)

if (typeof Pear !== 'undefined' && location.protocol === 'file:') {
  setInterval(async () => {
    const stamp = await devReloadStamp()
    if (!stamp) return
    if (!window.__zapcastReloadStamp) {
      window.__zapcastReloadStamp = stamp
      return
    }
    if (window.__zapcastReloadStamp !== stamp) location.reload()
  }, 1000)
}

function emptyStatus () {
  return {
    config: {},
    metrics: {
      peerId: '',
      connectedPeers: [],
      chunkSources: {}
    },
    events: [],
    payments: {},
    ffmpeg: { running: false, logs: [] },
    topology: {}
  }
}

function getInstanceId () {
  const url = new URL(location.href)
  const existing = url.searchParams.get('instance')
  if (existing) return existing
  const generated = crypto.getRandomValues(new Uint8Array(6))
  const instanceId = [...generated].map(byte => byte.toString(16).padStart(2, '0')).join('')
  url.searchParams.set('instance', instanceId)
  history.replaceState(null, '', url)
  return instanceId
}

async function devReloadStamp () {
  const files = [
    '../index.html',
    './app.js',
    './runtime.js',
    './style.css'
  ]
  try {
    const responses = await Promise.all(files.map(file => fetch(`${file}?mtime=${Date.now()}`)))
    const texts = await Promise.all(responses.map(response => response.ok ? response.text() : ''))
    return texts.map(text => `${text.length}:${hashString(text)}`).join('|')
  } catch {
    return ''
  }
}

function hashString (value) {
  let hash = 0
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0
  }
  return String(hash)
}
