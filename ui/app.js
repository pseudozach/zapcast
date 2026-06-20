import { MsePlayer } from '../player/mse-player.js'
import ui from 'pear-electron'

const app = window.zapCastApp
const $ = id => document.getElementById(id)
let mse = null
let selectedVideoPath = ''
let walletBalance = null
let balanceRefreshing = false
const pendingRecords = []
const playbackUi = {
  recordsSeen: 0,
  recordsAppended: 0,
  emptyRecords: 0,
  pendingRecords: 0,
  lastRecordMeta: null,
  lastRecordDataShape: '',
  lastAppendError: ''
}

bindTabs()
ensureViewerControls()
ensureCopyButtons()
bindActions()
bindFileInputs()
app.ready?.then(() => ensureWallet()).then(() => render()).catch(err => {
  console.error('ZapCast initial load failed', err)
})
setInterval(render, 1000)
setInterval(reportPlaybackState, 1000)
setInterval(() => refreshWalletBalance({ silent: true }).catch(() => {}), 30000)

app.on('metrics', render)
app.on('event', render)
app.on('record', record => {
  playbackUi.recordsSeen++
  playbackUi.lastRecordMeta = record?.meta || null
  playbackUi.lastRecordDataShape = dataShape(record?.data)
  if (!mse?.started) {
    pendingRecords.push(record)
    playbackUi.pendingRecords = pendingRecords.length
    return
  }
  appendRecord(record)
})

function bindTabs () {
  for (const button of document.querySelectorAll('[data-tab]')) {
    button.addEventListener('click', () => showTab(button.dataset.tab))
  }
}

function bindActions () {
  onClick('homeCreate', () => showTab('streamer'))
  onClick('homeJoin', () => showTab('viewer'))
  onClick('copyStreamId', () => copyButtonText('copyStreamId', $('streamIdOut').value))
  onClick('copyBroadcasterMetrics', () => copyText(metricsText(['streamId', 'uptime', 'chunksProduced', 'chunksAppended', 'uploadMbps', 'connectedPeers', 'bytesServed', 'chunksServed'])))
  onClick('copyFfmpegStatus', () => copyText($('ffmpegStatus')?.textContent || ''))
  onClick('copyViewerMetrics', () => copyText(viewerMetricsText()))
  onClick('copyConnectedPeers', () => copyText(JSON.stringify(app.status().metrics.connectedPeers || [], null, 2)))
  onClick('copyAllMetrics', () => copyText(JSON.stringify(app.status().metrics, null, 2)))
  onClick('copyChunkSources', () => copyText(JSON.stringify(app.status().metrics.chunkSources || {}, null, 2)))
  onClick('copyEventLog', () => copyText(eventLogText()))
  onClick('revealWallet', async () => run(async () => revealWalletSecret()))
  onClick('refreshBalance', async () => run(async () => refreshWalletBalance()))
  onClick('savePaymentSettings', async () => run(async () => withSavedBusy('savePaymentSettings', 'Saving...', 'Saved', async () => {
    const wallet = await app.updatePaymentSettings({
      forwardingAddress: $('forwardingAddress').value.trim(),
      forwardThreshold: $('forwardThreshold').value.trim()
    })
    renderWallet(wallet)
    await refreshWalletBalance({ silent: true }).catch(() => {})
  })))
  onClick('tipBroadcaster', async () => run(async () => withBusy('tipBroadcaster', 'Sending...', async () => {
    const amount = $('tipAmount').value.trim()
    const recipient = broadcasterPaymentAddress()
    const result = await sendTip({ amount, to: recipient })
    setStatus('tipStatus', `Tip sent: ${result.txHash}`)
    if (result.explorerUrl) setStatusLink('tipStatus', 'View tip transaction', result.explorerUrl)
  })))
  $('rtmpUrl')?.addEventListener('input', validateRtmpField)
  onClick('startIngest', async () => run(async () => withBusy('startIngest', 'Starting...', async () => {
    validateRtmpField({ strict: true })
    if (!$('streamIdOut').value.trim()) {
      const stream = await app.createStream()
      $('streamIdOut').value = stream.streamId
    }
    if (!$('rtmpUrl').value.trim() && !selectedVideoPath) {
      throw new Error('Choose a local video file, or enter an RTMP URL.')
    }
    await app.startIngest({
      rtmpUrl: $('rtmpUrl').value.trim(),
      videoFile: selectedVideoPath
    })
  })))
  onClick('stopIngest', () => {
    app.stopIngest()
    render()
  })
  onClick('joinStream', async () => run(async () => withBusy('joinStream', 'Joining...', async () => {
    await app.joinStream($('streamIdIn').value.trim())
    mse = new MsePlayer($('video'))
    mse.onerror = err => app.reportError?.(err)
    const started = await mse.start(app.status().config?.defaults?.mime || 'video/mp4; codecs="avc1.42c01e,mp4a.40.2"')
    if (!started) throw new Error('This runtime does not support the ZapCast fMP4 playback codec.')
    while (pendingRecords.length) appendRecord(pendingRecords.shift())
    playbackUi.pendingRecords = 0
  })))
  onClick('stopViewing', async () => run(async () => {
    await app.stopViewing()
    mse?.stop?.()
    mse = null
    pendingRecords.length = 0
    resetPlaybackUi()
    $('video').removeAttribute('src')
    $('video').load()
  }))
  onClick('applyTopology', () => {
    app.updateTopology({
      denyDirectBroadcaster: $('denyDirectBroadcaster').checked,
      preferRelayPeer: $('preferRelayPeer').value.trim(),
      allowPeer: $('allowPeer').value.trim(),
      blockPeer: $('blockPeer').value.trim(),
      maxBroadcasterConnections: $('maxBroadcasterConnections').value || Infinity
    })
    render()
  })
  onClick('exportJson', async () => run(async () => {
    downloadReport(await app.exportJson())
  }))
}

function ensureCopyButtons () {
  ensurePanelCopyButton('viewerMetrics', 'copyViewerMetrics', 'Copy viewer metrics')
  ensurePanelCopyButton('eventLog', 'copyEventLog', 'Copy event log')
  ensurePanelCopyButton('allMetrics', 'copyAllMetrics', 'Copy all metrics')
  ensurePanelCopyButton('broadcasterMetrics', 'copyBroadcasterMetrics', 'Copy broadcaster metrics')
  ensurePanelCopyButton('ffmpegStatus', 'copyFfmpegStatus', 'Copy ffmpeg status')
  ensurePanelCopyButton('peersTable', 'copyConnectedPeers', 'Copy connected peers')
  ensurePanelCopyButton('chunkSources', 'copyChunkSources', 'Copy chunk sources')
}

function ensureViewerControls () {
  if ($('stopViewing')) return
  const join = $('joinStream')
  const actions = join?.closest?.('.actions') || join?.parentElement
  if (!actions) return
  const button = document.createElement('button')
  button.type = 'button'
  button.id = 'stopViewing'
  button.className = 'secondary'
  button.textContent = 'Stop Viewing'
  actions.appendChild(button)
}

function ensurePanelCopyButton (contentId, buttonId, title) {
  const content = $(contentId)
  const panel = content?.closest?.('.panel')
  if (!panel) return
  let button = $(buttonId)
  panel.classList.add('has-panel-copy')
  if (!button) {
    button = document.createElement('button')
    button.type = 'button'
    button.id = buttonId
  }
  button.className = 'copy-button panel-copy'
  button.title = title
  button.setAttribute('aria-label', title)
  button.textContent = '⧉'
  panel.prepend(button)
}

function onClick (id, handler) {
  const node = $(id)
  if (!node) {
    console.warn(`ZapCast control missing: ${id}`)
    return
  }
  node.addEventListener('click', handler)
}

function bindFileInputs () {
  $('videoFile').addEventListener('change', async () => run(async () => {
    const file = $('videoFile').files[0]
    if (!file) return
    await selectVideoFile(file)
  }))
}

async function selectVideoFile (file) {
  selectedVideoPath = await getFilePath(file)
  const selected = $('selectedVideo')
  if (selectedVideoPath) {
    selected.textContent = file.name
    selected.title = selectedVideoPath
    return
  }

  selected.textContent = `${file.name} selected, but ZapCast could not resolve its local path.`
  selected.title = ''
}

async function getFilePath (file) {
  if (!file) return ''
  if (ui?.media?.getPathForFile) return ui.media.getPathForFile(file)
  if (file.path) return file.path
  return ''
}

function showTab (id) {
  for (const button of document.querySelectorAll('[data-tab]')) button.classList.toggle('active', button.dataset.tab === id)
  for (const tab of document.querySelectorAll('.tab')) tab.classList.toggle('active', tab.id === id)
}

async function run (fn) {
  try {
    await fn()
    render()
  } catch (err) {
    console.error(err)
    await app.reportError?.(err)
    render()
  }
}

function render () {
  const status = app.status()
  $('peerId').textContent = `Peer: ${short(status.metrics.peerId) || 'pending'}`
  renderBalance()
  if ($('copyStreamId')) $('copyStreamId').disabled = !$('streamIdOut').value.trim()
  updateStreamingButtons(status)
  updateViewingButtons(status)
  renderMetrics($('broadcasterMetrics'), status.metrics, ['streamId', 'uptime', 'chunksProduced', 'chunksAppended', 'uploadMbps', 'connectedPeers', 'bytesServed', 'chunksServed'])
  renderMetrics($('viewerMetrics'), status.metrics, ['streamId', 'uptime', 'connectedToBroadcaster', 'playbackState', 'liveLatency', 'bufferSize', 'currentSequence', 'latestSequence', 'bytesDownloaded', 'bytesUploaded', 'uploadDownloadRatio', 'chunksReceived', 'chunksServed', 'missingChunks', 'skippedChunks', 'playbackDebug'])
  renderMetrics($('allMetrics'), status.metrics)
  renderPayments(status.payments)
  renderWallet(status.wallet || status.metrics.wallet)
  $('ffmpegStatus').textContent = JSON.stringify(status.ffmpeg, null, 2)
  const lastError = status.metrics.errors?.at?.(-1)
  if (lastError && !status.ffmpeg.error) {
    $('ffmpegStatus').textContent = `${$('ffmpegStatus').textContent}\n\nLast error: ${lastError.message}`
  }
  renderPeers(status.metrics.connectedPeers)
  renderSources(status.metrics.chunkSources)
  renderEvents(status.events)
}

function updateStreamingButtons (status) {
  const start = $('startIngest')
  const stop = $('stopIngest')
  const running = Boolean(status.ffmpeg?.running)
  if (start && !start.classList.contains('busy')) start.disabled = running
  if (stop) stop.disabled = !running
}

function updateViewingButtons (status) {
  const join = $('joinStream')
  const stop = $('stopViewing')
  const tip = $('tipBroadcaster')
  const viewing = status.metrics.role === 'viewer' && ['buffering', 'playing'].includes(status.metrics.playbackState)
  if (join && !join.classList.contains('busy')) join.disabled = viewing
  if (stop) stop.disabled = !viewing
  if (tip && !tip.classList.contains('busy')) tip.disabled = !broadcasterPaymentAddress()
}

async function withBusy (id, label, fn) {
  const button = $(id)
  if (!button || button.disabled) return
  const original = button.textContent
  button.disabled = true
  button.classList.add('busy')
  button.textContent = label
  try {
    return await fn()
  } finally {
    button.textContent = original
    button.classList.remove('busy')
    button.disabled = false
    render()
  }
}

async function withSavedBusy (id, busyLabel, savedLabel, fn) {
  const button = $(id)
  if (!button || button.disabled) return
  const original = button.textContent
  button.disabled = true
  button.classList.add('busy')
  button.textContent = busyLabel
  try {
    const result = await fn()
    button.classList.remove('busy')
    button.textContent = savedLabel
    await delay(1400)
    return result
  } finally {
    button.textContent = original
    button.classList.remove('busy')
    button.disabled = false
    render()
  }
}

function validateRtmpField ({ strict = false } = {}) {
  const input = $('rtmpUrl')
  const error = $('rtmpError')
  const value = input?.value.trim() || ''
  const message = rtmpValidationMessage(value)
  const show = Boolean(message && (strict || value))
  if (error) {
    error.textContent = show ? message : ''
    error.hidden = !show
  }
  input?.classList.toggle('invalid', show)
  if (strict && message && value) throw new Error(message)
  return !message
}

function rtmpValidationMessage (value) {
  if (!value) return ''
  let url
  try {
    url = new URL(value)
  } catch {
    return 'Enter a valid RTMP URL.'
  }
  if (url.protocol !== 'rtmp:' && url.protocol !== 'rtmps:') return 'RTMP URL must start with rtmp:// or rtmps://.'
  if (!url.hostname || url.pathname === '/') return 'RTMP URL must include a host and stream path.'
  return ''
}

function renderMetrics (node, metrics, keys = Object.keys(metrics)) {
  if (!node) return
  node.innerHTML = ''
  for (const key of keys) {
    const row = document.createElement('div')
    row.innerHTML = `<span>${escapeHtml(key)}</span><strong>${escapeHtml(format(metrics[key]))}</strong>`
    node.appendChild(row)
  }
}

function renderPayments (payments) {
  renderMetrics($('paymentStats'), payments || {}, ['streamerPendingSats', 'relayerPendingSats', 'protocolPendingSats', 'currentUserPendingSats'])
}

function renderBalance () {
  const label = $('walletBalance')
  const refresh = $('refreshBalance')
  if (!label) return
  if (walletBalance?.error) {
    label.textContent = 'Balance: unavailable'
  } else if (walletBalance) {
    label.textContent = `Balance: ${formatBalance(walletBalance.formatted)} ${walletBalance.symbol || 'USDC'}`
  } else {
    label.textContent = 'Balance: -- USDC'
  }
  if (refresh) {
    refresh.disabled = balanceRefreshing || !walletAddress()
    refresh.classList.toggle('busy', balanceRefreshing)
  }
}

function renderWallet (wallet = {}) {
  const details = $('walletDetails')
  if (!details) return
  if (wallet.error) {
    renderMetrics(details, {
      network: wallet.network || 'arc-testnet',
      asset: wallet.asset || 'USDC',
      status: 'wallet unavailable',
      error: wallet.error
    })
    return
  }
  if (!wallet.address) {
    renderMetrics(details, {
      network: wallet.network || 'arc-testnet',
      asset: wallet.asset || 'USDC',
      status: 'generating wallet...'
    })
    return
  }
  renderMetrics(details, {
    network: wallet.network || 'arc-testnet',
    asset: wallet.asset || 'USDC',
    address: wallet.address || ''
  })
  if ($('forwardingAddress') && document.activeElement !== $('forwardingAddress')) $('forwardingAddress').value = wallet.forwardingAddress || ''
  if ($('forwardThreshold') && document.activeElement !== $('forwardThreshold')) $('forwardThreshold').value = wallet.forwardThreshold || '0.1'
}

async function ensureWallet () {
  const existing = await app.wallet()
  if (existing.address) {
    renderWallet(existing)
    await refreshWalletBalance({ silent: true }).catch(() => {})
    return existing
  }

  const generated = await generateViemWallet()
  const imported = await app.importWallet(generated)
  renderWallet(imported)
  await refreshWalletBalance({ silent: true }).catch(() => {})
  return imported
}

async function refreshWalletBalance ({ silent = false } = {}) {
  const address = walletAddress()
  if (!address) return null
  balanceRefreshing = true
  if (!silent) renderBalance()
  try {
    const walletClient = await import('./vendor/wallet-client.js')
    walletBalance = await walletClient.getNativeUsdcBalance({ address })
    return walletBalance
  } catch (err) {
    walletBalance = { error: err?.message || String(err) }
    throw err
  } finally {
    balanceRefreshing = false
    renderBalance()
  }
}

function renderPeers (peers = []) {
  $('peersTable').innerHTML = peers.map(peer => `<tr><td>${escapeHtml(short(peer.peerId))}</td><td>${escapeHtml(peer.role)}</td><td>${peer.latestSeq || 0}</td></tr>`).join('')
}

function renderSources (sources = {}) {
  $('chunkSources').innerHTML = Object.entries(sources).map(([source, count]) => `<tr><td>${escapeHtml(source)}</td><td>${escapeHtml(count)}</td></tr>`).join('')
}

function renderEvents (events = []) {
  $('eventLog').innerHTML = events.slice(-120).reverse().map(event => `<tr><td>${escapeHtml(event.timestamp)}</td><td>${escapeHtml(event.event)}</td><td>${escapeHtml(short(event.peerId))}</td><td>${escapeHtml(event.seq)}</td><td>${escapeHtml(event.message)}</td></tr>`).join('')
}

function short (value = '') {
  return String(value).slice(0, 12)
}

function format (value) {
  if (Array.isArray(value)) return `${value.length}`
  if (value && typeof value === 'object') return JSON.stringify(value)
  return value ?? ''
}

function escapeHtml (value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  })[char])
}

function recordBytes (record) {
  const data = record?.data
  if (data instanceof Uint8Array) return data
  if (typeof data === 'string') return base64ToBytes(data)
  if (Array.isArray(data)) return Uint8Array.from(data)
  if (Array.isArray(data?.data)) return Uint8Array.from(data.data)
  if (data && typeof data === 'object') {
    const numericKeys = Object.keys(data).filter(key => /^\d+$/.test(key))
    if (numericKeys.length > 0) {
      numericKeys.sort((a, b) => Number(a) - Number(b))
      return Uint8Array.from(numericKeys.map(key => Number(data[key])))
    }
  }
  return new Uint8Array()
}

function appendRecord (record) {
  const bytes = recordBytes(record)
  playbackUi.lastRecordMeta = record?.meta || null
  playbackUi.lastRecordDataShape = dataShape(record?.data)
  if (!bytes.byteLength) {
    playbackUi.emptyRecords++
    playbackUi.lastAppendError = `empty record data for seq=${record?.meta?.seq ?? ''}, shape=${playbackUi.lastRecordDataShape}`
    console.warn('ZapCast empty playback record', { meta: record?.meta, shape: playbackUi.lastRecordDataShape })
    return
  }
  playbackUi.recordsAppended++
  playbackUi.lastAppendError = ''
  mse.append(bytes, { ...record.meta, type: record.type, bytes: bytes.byteLength })
}

function base64ToBytes (value) {
  try {
    return Uint8Array.from(atob(value), char => char.charCodeAt(0))
  } catch (err) {
    playbackUi.lastAppendError = `base64 decode failed: ${err.message}`
    return new Uint8Array()
  }
}

function dataShape (data) {
  if (data instanceof Uint8Array) return `Uint8Array(${data.byteLength})`
  if (typeof data === 'string') return `string(${data.length})`
  if (Array.isArray(data)) return `array(${data.length})`
  if (Array.isArray(data?.data)) return `${data.type || 'object'}.data(${data.data.length})`
  if (data && typeof data === 'object') return `object(${Object.keys(data).length})`
  return String(data)
}

function downloadReport (report) {
  const blob = new Blob([report.content], { type: report.mime || 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = report.filename || 'zapcast-report'
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
  $('reportOutput').textContent = `Downloaded ${report.filename}`
}

async function copyText (text) {
  await navigator.clipboard.writeText(text)
}

async function copyButtonText (id, text) {
  const button = $(id)
  const original = button?.textContent || 'Copy'
  await copyText(text)
  if (!button) return
  button.textContent = 'Copied'
  setTimeout(() => {
    button.textContent = original
  }, 1200)
}

async function revealWalletSecret () {
  const wallet = await app.revealWallet()
  const input = $('walletSecret')
  const button = $('revealWallet')
  if (!input || !button) return
  const revealing = input.type === 'password'
  input.type = revealing ? 'text' : 'password'
  input.value = revealing ? wallet.mnemonic : 'Hidden'
  button.title = revealing ? 'Hide wallet secret' : 'Reveal wallet secret'
  button.setAttribute('aria-label', button.title)
}

async function generateViemWallet () {
  const walletClient = await import('./vendor/wallet-client.js')
  return walletClient.generateWallet()
}

async function sendTip ({ amount, to }) {
  if (!to) throw new Error('Broadcaster payment address is not available yet.')
  const wallet = await app.revealWallet()
  if (!wallet.mnemonic) throw new Error('Wallet secret is not available.')
  const walletClient = await import('./vendor/wallet-client.js')
  const result = await walletClient.sendNativeUsdc({
    mnemonic: wallet.mnemonic,
    to,
    amount
  })
  await app.recordTransfer({
    type: 'tip',
    status: 'sent',
    to,
    amount,
    asset: wallet.asset || 'USDC',
    txHash: result.txHash,
    explorerUrl: result.explorerUrl
  })
  await refreshWalletBalance({ silent: true }).catch(() => {})
  return result
}

function broadcasterPaymentAddress () {
  const peers = app.status().metrics.connectedPeers || []
  return peers.find(peer => peer.role === 'broadcaster')?.payment?.address || ''
}

function walletAddress () {
  const status = app.status()
  return status.wallet?.address || status.metrics.wallet?.address || ''
}

function formatBalance (value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return value || '0'
  if (number === 0) return '0'
  if (number < 0.000001) return '<0.000001'
  return number.toLocaleString(undefined, { maximumFractionDigits: 6 })
}

function delay (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function setStatus (id, text) {
  const node = $(id)
  if (node) node.textContent = text
}

function setStatusLink (id, label, href) {
  const node = $(id)
  if (!node) return
  node.innerHTML = `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${escapeHtml(label)}</a>`
}

async function reportPlaybackState () {
  if (!mse?.started) return
  playbackUi.pendingRecords = pendingRecords.length
  await app.reportPlayback?.({ ...mse.snapshot(), ui: { ...playbackUi }, recordPoll: app.recordDebug?.() }).catch(() => {})
}

function resetPlaybackUi () {
  playbackUi.recordsSeen = 0
  playbackUi.recordsAppended = 0
  playbackUi.emptyRecords = 0
  playbackUi.pendingRecords = 0
  playbackUi.lastRecordMeta = null
  playbackUi.lastRecordDataShape = ''
  playbackUi.lastAppendError = ''
}

function viewerMetricsText () {
  const keys = ['streamId', 'uptime', 'connectedToBroadcaster', 'playbackState', 'liveLatency', 'bufferSize', 'currentSequence', 'latestSequence', 'bytesDownloaded', 'bytesUploaded', 'uploadDownloadRatio', 'chunksReceived', 'chunksServed', 'missingChunks', 'skippedChunks', 'playbackDebug', 'connectedPeers', 'errors']
  return metricsText(keys)
}

function metricsText (keys) {
  const status = app.status()
  const metrics = {}
  for (const key of keys) metrics[key] = status.metrics[key]
  return JSON.stringify(metrics, null, 2)
}

function eventLogText () {
  const rows = app.status().events || []
  const columns = ['timestamp', 'event', 'role', 'peerId', 'streamId', 'seq', 'bytes', 'sourcePeerId', 'targetPeerId', 'message']
  return [
    columns.join('\t'),
    ...rows.map(row => columns.map(column => String(row[column] ?? '').replaceAll('\t', ' ')).join('\t'))
  ].join('\n')
}
