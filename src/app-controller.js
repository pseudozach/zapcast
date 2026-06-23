import { APP_VERSION, DEFAULTS, parseCliArgs, roleDataPaths } from './config.js'
import { generateStreamIdentity, encodeStreamId, parseStreamId, generateInstanceId } from '../utils/crypto.js'
import { EventLog } from '../utils/logger.js'
import { Metrics } from '../p2p/stats.js'
import { TopologyPolicy } from '../p2p/topology.js'
import { StreamFeed } from '../p2p/stream-feed.js'
import { ZapSwarm } from '../p2p/swarm.js'
import { attachReplication } from '../p2p/replication.js'
import { PeerControl } from '../p2p/peer-control.js'
import { IngestPipeline } from '../broadcaster/ingest.js'
import { splitZap } from '../payments/mock-split.js'
import { PaymentWallet } from '../payments/wallet.js'
import { exportCsvEvents, exportJsonReport } from '../reports/report.js'
import { SimpleEmitter } from '../utils/emitter.js'
import { joinPath, runtimeArgv } from '../utils/platform.js'
import { cleanupInstanceData } from '../utils/cleanup.js'
import { NostrIdentityStore } from './nostr/keys.js'

export class ZapCastApp extends SimpleEmitter {
  constructor (options = {}) {
    super()
    const cli = parseCliArgs(options.argv || runtimeArgv().slice(2))
    this.instanceId = options.instanceId || generateInstanceId()
    this.walletSlot = normalizeWalletSlot(options.walletSlot)
    this.dataPaths = {
      broadcaster: roleDataPaths('broadcaster', this.instanceId),
      viewer: roleDataPaths('viewer', this.instanceId)
    }
    this.role = options.role || cli.role
    this.currentDataPaths = this.dataPaths[this.role] || this.dataPaths.viewer
    this.eventLog = new EventLog()
    this.metrics = new Metrics({ role: this.role, peerId: '', eventLog: this.eventLog })
    this.topology = new TopologyPolicy({ ...cli, role: this.role })
    this.streamFeed = null
    this.swarm = null
    this.control = null
    this.ingest = null
    this.payments = splitZap({ sats: 0 })
    this.wallet = new PaymentWallet({
      directory: joinPath(DEFAULTS.walletDirectory, 'slots', `slot-${this.walletSlot}`),
      legacyDirectory: DEFAULTS.walletDirectory,
      slot: this.walletSlot,
      logger: this.eventLog
    })
    this.walletError = ''
    this.walletReady = this.initWallet()
    this.nostr = new NostrIdentityStore({
      directory: DEFAULTS.nostrDirectory,
      logger: this.eventLog
    })
    this.nostrReady = this.nostr.ready()
    this.records = []
    this.startedAt = Date.now()

    this.eventLog.add('app_start', { role: this.role, message: `ZapCast ${APP_VERSION} instance ${this.instanceId}` })
    this.metrics.on('change', snapshot => this.emit('metrics', snapshot))
    this.eventLog.on('event', event => this.emit('event', event))
  }

  async initWallet () {
    try {
      await this.wallet.ready()
      this.walletError = ''
      this.metrics.set({ payment: this.paymentMetadata(), wallet: this.wallet.snapshot() })
    } catch (err) {
      this.walletError = err?.message || String(err)
      this.metrics.recordError(err)
    }
  }

  async walletSnapshot ({ includeSecret = false } = {}) {
    await this.walletReady
    const wallet = this.wallet.snapshot({ includeSecret })
    return {
      ...wallet,
      ready: Boolean(wallet.address),
      error: this.walletError
    }
  }

  async nostrSnapshot ({ includeSecret = false } = {}) {
    await this.nostrReady
    return this.nostr.snapshot({ includeSecret })
  }

  async importNostrKey (identity) {
    await this.nostrReady
    const next = await this.nostr.importKey(identity)
    this.metrics.set({ nostr: await this.nostr.snapshot() })
    return next
  }

  async updateNostrRelays (settings) {
    await this.nostrReady
    const next = await this.nostr.updateRelays(settings)
    this.metrics.set({ nostr: next })
    return next
  }

  async forwardWalletBalance () {
    await this.walletReady
    return { forwarded: false, reason: 'renderer-wallet-transfer-required' }
  }

  async createStream () {
    await this.prepareRole('broadcaster')
    this.role = 'broadcaster'
    this.metrics.role = 'broadcaster'
    this.topology.role = 'broadcaster'
    this.metrics.set({ dataDirectory: this.currentDataPaths.baseDirectory })
    await this.walletReady
    const identity = generateStreamIdentity()
    this.streamFeed = await new StreamFeed({
      storageDirectory: this.currentDataPaths.storageDirectory,
      streamId: identity.publicKeyHex,
      writable: true,
      metrics: this.metrics,
      logger: this.eventLog
    }).open()
    const streamId = encodeStreamId({ publicKeyHex: identity.publicKeyHex, feedKeyHex: this.streamFeed.key })
    this.metrics.set({ streamId })
    await this.joinNetwork({ streamId, role: 'broadcaster' })
    this.ingest = new IngestPipeline({
      streamFeed: this.streamFeed,
      logger: this.eventLog,
      metrics: this.metrics,
      chunkDirectory: this.currentDataPaths.chunkDirectory
    })
    this.eventLog.add('stream_created', { role: 'broadcaster', peerId: this.metrics.peerId, streamId })
    return { streamId, publicKeyHex: identity.publicKeyHex, feedKeyHex: this.streamFeed.key, peerId: this.metrics.peerId }
  }

  async joinStream (streamId) {
    await this.prepareRole('viewer')
    this.role = 'viewer'
    this.metrics.role = 'viewer'
    this.topology.role = 'viewer'
    this.metrics.set({ dataDirectory: this.currentDataPaths.baseDirectory })
    await this.walletReady
    const parsed = parseStreamId(streamId)
    this.streamFeed = await new StreamFeed({
      storageDirectory: this.currentDataPaths.storageDirectory,
      streamId,
      key: parsed.feedKeyHex,
      metrics: this.metrics,
      logger: this.eventLog
    }).open()
    this.metrics.set({ streamId })
    await this.joinNetwork({ streamId, role: 'viewer' })
    this.startViewerLoop()
    this.eventLog.add('stream_joined', { role: 'viewer', peerId: this.metrics.peerId, streamId })
    return { streamId, peerId: this.metrics.peerId }
  }

  async joinNetwork ({ streamId, role }) {
    await this.walletReady
    const parsed = parseStreamId(streamId)
    this.swarm = new ZapSwarm({
      streamPublicKeyHex: parsed.publicKeyHex,
      logger: this.eventLog,
      metrics: this.metrics,
      role
    })
    this.metrics.peerId = this.swarm.peerId
    attachReplication({ swarm: this.swarm, streamFeed: this.streamFeed, logger: this.eventLog, metrics: this.metrics, role, streamId })
    await this.swarm.join(swarmJoinMode(role))

    this.control = new PeerControl({
      streamPublicKeyHex: parsed.publicKeyHex,
      role,
      streamId,
      metrics: this.metrics,
      logger: this.eventLog,
      topology: this.topology,
      streamFeed: this.streamFeed,
      payment: this.paymentMetadata()
    })
    await this.control.join(swarmJoinMode(role))
    this.metrics.peerId = this.control.peerId
    this.metrics.set({ peerId: this.control.peerId, dataPeerId: this.swarm.peerId, controlPeerId: this.control.peerId, streamId, payment: this.paymentMetadata(), wallet: this.wallet.snapshot() })
  }

  async startIngest ({ rtmpUrl }) {
    if (!this.ingest) throw new Error('Create a stream before starting ingest')
    const streamId = this.metrics.snapshot().streamId
    const input = String(rtmpUrl || '').trim()
    if (!input) throw new Error('Missing source URL')
    validateSourceUrl(input)
    const mode = 'url'
    this.eventLog.add('ingest_started', {
      role: 'broadcaster',
      peerId: this.metrics.peerId,
      streamId,
      message: `${mode}: ${input}`
    })
    const result = await this.ingest.start({ input, mode, streamId })
    this.metrics.startSession()
    this.metrics.set({ playbackState: 'streaming' })
    return result
  }

  stopIngest () {
    this.ingest?.stop()
    this.metrics.stopSession()
    this.metrics.set({ playbackState: 'idle' })
  }

  async stopViewing () {
    await this.closeActiveSession()
    this.metrics.stopSession()
    this.metrics.set({
      connectedPeers: [],
      connectedToBroadcaster: false,
      playbackState: 'idle',
      liveLatency: 0,
      bufferSize: 0,
      currentSequence: 0,
      latestSequence: 0
    })
    this.eventLog.add('viewing_stopped', {
      role: 'viewer',
      peerId: this.metrics.peerId,
      streamId: this.metrics.snapshot().streamId
    })
  }

  startViewerLoop () {
    if (this.viewerTimer) return
    let next = null
    let initDelivered = false
    let lastLoggedLength = -1
    this.metrics.startSession()
    this.metrics.set({ playbackState: 'buffering' })
    this.viewerTimer = setInterval(async () => {
      if (this.viewerTickRunning) return
      this.viewerTickRunning = true
      try {
        const length = await this.streamFeed.update()
        if (length !== lastLoggedLength) {
          this.eventLog.add('feed_update', {
            role: 'viewer',
            peerId: this.metrics.peerId,
            streamId: this.metrics.snapshot().streamId,
            message: `feed length ${length}, next ${next}`
          })
          lastLoggedLength = length
        }
        if (length === 0) return

        if (!initDelivered) {
          const init = await this.streamFeed.get(0)
          if (!init?.meta?.isInitSegment && init?.type !== 'init') {
            throw new Error('Stream feed does not begin with an initialization segment.')
          }
          this.acceptViewerRecord(init)
          initDelivered = true
          const liveWindowChunks = Math.max(1, Math.ceil(10 / DEFAULTS.chunkDurationSeconds))
          next = Math.max(1, length - liveWindowChunks)
          const skipped = Math.max(0, next - 1)
          this.metrics.set({ skippedChunks: skipped })
          this.eventLog.add('live_edge_selected', {
            role: 'viewer',
            peerId: this.metrics.peerId,
            streamId: this.metrics.snapshot().streamId,
            seq: next,
            message: `feed length ${length}, skipped ${skipped} historical chunks`
          })
        }

        while (next < length) {
          this.acceptViewerRecord(await this.streamFeed.get(next))
          next++
        }
      } catch (err) {
        this.metrics.recordError(err)
      } finally {
        this.viewerTickRunning = false
      }
    }, 750)
  }

  acceptViewerRecord (record) {
    this.records.push(record)
    if (this.records.length > DEFAULTS.chunkRetention) this.records.shift()
    const source = this.metrics.snapshot().connectedToBroadcaster ? 'broadcaster-or-peer' : 'relay-peer'
    this.metrics.recordSource(record.meta.seq, source, record.meta.byteLength)
    this.metrics.set({
      playbackState: 'buffering',
      currentSequence: record.meta.seq,
      latestSequence: Math.max(record.meta.seq, this.metrics.snapshot().latestSequence),
      bufferSize: this.records.length,
      liveLatency: Math.max(0, Date.now() - Date.parse(record.meta.appendedAt))
    })
    this.eventLog.add('chunk_received', {
      role: 'viewer',
      peerId: this.metrics.peerId,
      streamId: record.meta.streamId,
      seq: record.meta.seq,
      bytes: record.meta.byteLength,
      sourcePeerId: source
    })
    this.emit('record', record)
  }

  recordsAfter (after = -1) {
    const afterNumber = Number.isFinite(after) ? after : -1
    return this.records.filter(record => Number(record.meta?.seq ?? -1) > afterNumber)
  }

  updatePlaybackReport (report = {}) {
    const buffered = Array.isArray(report.buffered) ? report.buffered : []
    const hasBufferedVideo = buffered.some(range => Number(range.end) > Number(report.currentTime || 0))
    this.metrics.set({
      playbackDebug: report,
      playbackState: hasBufferedVideo && Number(report.videoReadyState || 0) >= 2 ? 'playing' : this.metrics.snapshot().playbackState
    })
    return this.metrics.snapshot()
  }

  updateTopology (patch) {
    this.topology.update(patch)
    this.control?.broadcast('topology', { policy: this.topology.snapshot() })
    return this.topology.snapshot()
  }

  zap (sats = 1000) {
    const snapshot = this.metrics.snapshot()
    const relayers = snapshot.connectedPeers.map(peer => ({
      peerId: peer.peerId,
      bytesUploaded: peer.bytesUploaded || 0,
      uptime: snapshot.uptime
    }))
    this.payments = splitZap({ sats, relayers, currentPeerId: snapshot.peerId })
    this.eventLog.add('mock_zap', {
      role: this.role,
      peerId: snapshot.peerId,
      streamId: snapshot.streamId,
      message: `${sats} sats`
    })
    return this.payments
  }

  async tipBroadcaster () {
    throw new Error('Tips are signed by the renderer wallet. Use /api/record-transfer after sending.')
  }

  async importWallet (wallet) {
    await this.walletReady
    const imported = await this.wallet.importWallet(wallet)
    this.walletError = ''
    const payment = this.paymentMetadata()
    if (this.control) {
      this.control.payment = payment
      this.control.broadcast('have')
    }
    this.metrics.set({ wallet: this.wallet.snapshot(), payment })
    return imported
  }

  async recordTransfer (transfer = {}) {
    await this.walletReady
    const snapshot = this.metrics.snapshot()
    await this.wallet.recordTransfer({
      ...transfer,
      role: transfer.role || this.role,
      streamId: transfer.streamId || snapshot.streamId
    })
    const result = {
      txHash: transfer.txHash || '',
      explorerUrl: transfer.explorerUrl || ''
    }
    this.metrics.set({ lastTransfer: result })
    this.eventLog.add(transfer.type === 'forward' ? 'wallet_forwarded' : 'tip_sent', {
      role: this.role,
      peerId: snapshot.peerId,
      streamId: snapshot.streamId,
      targetPeerId: transfer.to || '',
      message: `${transfer.amount || ''} ${transfer.asset || 'USDC'} ${transfer.txHash || ''}`
    })
    return result
  }

  async updatePaymentSettings (settings) {
    await this.walletReady
    const wallet = await this.wallet.updateSettings(settings)
    const payment = this.paymentMetadata()
    if (this.control) {
      this.control.payment = payment
      this.control.broadcast('have')
    }
    this.metrics.set({ wallet, payment })
    return wallet
  }

  async revealWallet () {
    return this.walletSnapshot({ includeSecret: true })
  }

  async exportJson () {
    return exportJsonReport({ config: this.configSnapshot(), metrics: this.metrics, eventLog: this.eventLog, payments: this.payments, directory: this.currentDataPaths.reportDirectory })
  }

  async exportCsv () {
    return exportCsvEvents({ metrics: this.metrics, eventLog: this.eventLog, directory: this.currentDataPaths.reportDirectory })
  }

  async status () {
    const wallet = await this.walletSnapshot()
    const nostr = await this.nostrSnapshot()
    return {
      config: this.configSnapshot(),
      metrics: this.metrics.snapshot(),
      events: this.eventLog.list(),
      payments: this.payments,
      wallet,
      nostr,
      ffmpeg: this.ingest?.status() || { running: false, logs: [] },
      topology: this.topology.snapshot()
    }
  }

  configSnapshot () {
    return {
      appVersion: APP_VERSION,
      instanceId: this.instanceId,
      walletSlot: this.walletSlot,
      defaults: DEFAULTS,
      dataPaths: this.currentDataPaths,
      topology: this.topology.snapshot()
    }
  }

  paymentMetadata () {
    const wallet = this.wallet.snapshot()
    return {
      type: 'arc-testnet',
      chain: 'arc-testnet',
      asset: wallet.asset,
      address: wallet.address,
      lightningAddress: wallet.lightningAddress || ''
    }
  }

  async prepareRole (role) {
    if (this.role === role || !this.streamFeed) {
      this.currentDataPaths = this.dataPaths[role] || this.currentDataPaths
      return
    }
    await this.closeActiveSession()
    this.currentDataPaths = this.dataPaths[role] || this.currentDataPaths
  }

  async closeActiveSession () {
    if (this.viewerTimer) {
      clearInterval(this.viewerTimer)
      this.viewerTimer = null
    }
    this.viewerTickRunning = false
    this.ingest?.stop()
    this.ingest = null
    await this.control?.destroy()
    this.control = null
    await this.swarm?.destroy()
    this.swarm = null
    await this.streamFeed?.close()
    this.streamFeed = null
    this.records = []
  }

  async close () {
    await this.closeActiveSession()
    await cleanupInstanceData(this.dataPaths)
  }
}

function normalizeWalletSlot (value) {
  const slot = Number(value)
  return Number.isInteger(slot) && slot > 0 ? slot : 1
}

function validateSourceUrl (value) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error('Source URL must be a valid rtmp://, rtmps://, http://, or https:// URL.')
  }
  const supportedProtocols = new Set(['rtmp:', 'rtmps:', 'http:', 'https:'])
  if (!supportedProtocols.has(url.protocol)) {
    throw new Error('Source URL must start with rtmp://, rtmps://, http://, or https://.')
  }
  if (!url.hostname) {
    throw new Error('Source URL must include a host.')
  }
  if ((url.protocol === 'rtmp:' || url.protocol === 'rtmps:') && url.pathname === '/') {
    throw new Error('RTMP source URLs must include a stream path, for example rtmp://host/app/key.')
  }
}

function swarmJoinMode (role) {
  if (role === 'broadcaster') return { client: false, server: true }
  return { client: true, server: false }
}
