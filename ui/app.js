import { MsePlayer } from '../player/mse-player.js'

const app = window.zapCastApp
const $ = id => document.getElementById(id)
let mse = null
let loadedNostrSecret = ''
let walletBalance = null
let balanceRefreshing = false
let loadedWalletMnemonic = ''
let nostrIdentity = null
let nostrStreams = []
let nostrPage = 0
let nostrDiscoveryLoading = false
let lastNostrAnnouncement = null
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
setLaunchStatus('boot')
render()
runStartup()
setInterval(render, 1000)
setInterval(reportPlaybackState, 1000)

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
  onClick('announceNostr', async () => run(async () => withBusy('announceNostr', 'Publishing...', async () => announceOnNostr())))
  onClick('copyBroadcasterMetrics', () => copyText(metricsText(['streamId', 'uptime', 'chunksProduced', 'chunksAppended', 'uploadMbps', 'connectedPeers', 'bytesServed', 'chunksServed'])))
  onClick('copyFfmpegStatus', () => copyText($('ffmpegStatus')?.textContent || ''))
  onClick('copyViewerMetrics', () => copyText(viewerMetricsText()))
  onClick('copyConnectedPeers', () => copyText(JSON.stringify(app.status().metrics.connectedPeers || [], null, 2)))
  onClick('copyAllMetrics', () => copyText(JSON.stringify(app.status().metrics, null, 2)))
  onClick('copyChunkSources', () => copyText(JSON.stringify(app.status().metrics.chunkSources || {}, null, 2)))
  onClick('copyEventLog', () => copyText(eventLogText()))
  onClick('revealWallet', async () => run(async () => revealWalletSecret()))
  onClick('refreshBalance', async () => run(async () => refreshWalletBalance()))
  onClick('refreshNostrStreams', async () => run(async () => refreshNostrStreams()))
  onClick('nostrPrev', () => { nostrPage = Math.max(0, nostrPage - 1); renderNostrStreams() })
  onClick('nostrNext', () => { nostrPage++; renderNostrStreams() })
  onClick('copyNpub', () => copyButtonText('copyNpub', nostrIdentity?.npub || ''))
  onClick('revealNostr', async () => run(async () => revealNostrSecret()))
  onClick('saveNostrIdentity', async () => run(async () => withSavedBusy('saveNostrIdentity', 'Saving...', 'Saved', async () => saveNostrIdentity())))
  onClick('savePaymentSettings', async () => run(async () => withSavedBusy('savePaymentSettings', 'Saving...', 'Saved', async () => {
    const mnemonic = $('walletSecret').value.trim()
    let importedMnemonic = ''
    if (mnemonic) {
      const candidate = await walletFromMnemonic(mnemonic)
      if (candidate.mnemonic !== loadedWalletMnemonic) {
        const imported = await app.importWallet(candidate)
        importedMnemonic = imported.mnemonic
        loadedWalletMnemonic = imported.mnemonic
        walletBalance = null
        renderBalance()
      }
    }
    const wallet = await app.updatePaymentSettings({
      forwardingAddress: $('forwardingAddress').value.trim(),
      forwardThreshold: $('forwardThreshold').value.trim()
    })
    renderWallet(wallet)
    setWalletSecretField(loadedWalletMnemonic)
    if (importedMnemonic) {
      await refreshWalletBalance({ silent: true })
    }
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
    if (!$('rtmpUrl').value.trim()) {
      throw new Error('Enter a source URL.')
    }
    await app.startIngest({
      rtmpUrl: $('rtmpUrl').value.trim()
    })
  })))
  onClick('stopIngest', async () => run(async () => withBusy('stopIngest', 'Stopping...', async () => {
    const announcement = lastNostrAnnouncement
    await app.stopIngest()
    if (announcement?.streamId) await publishNostrEnded(announcement).catch(err => setStatus('nostrPublishStatus', `Failed to publish ended status: ${err.message}`))
    render()
  })))
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

function showTab (id) {
  for (const button of document.querySelectorAll('[data-tab]')) button.classList.toggle('active', button.dataset.tab === id)
  for (const tab of document.querySelectorAll('.tab')) tab.classList.toggle('active', tab.id === id)
}

async function runStartup () {
  const failures = []
  const steps = [
    ['backend', () => app.ready],
    ['wallet', () => ensureWallet()],
    ['nostr key', () => ensureNostrIdentity()],
    ['balance', () => refreshWalletBalance({ silent: true })],
    ['nostr live', () => refreshNostrStreams({ silent: true })]
  ]

  for (const [index, [label, task]] of steps.entries()) {
    setLaunchStatus(`${index + 1}/${steps.length} ${label}`)
    await paint()
    try {
      await withTimeout(Promise.resolve().then(task), 15000, label)
    } catch (err) {
      console.error(`ZapCast startup step failed: ${label}`, err)
      failures.push(label)
      app.reportError?.(err).catch(() => {})
      setLaunchStatus(`${label} failed`)
      await paint()
      await delay(900)
    } finally {
      render()
    }
  }

  if (failures.length) {
    setLaunchStatus(`ready · ${failures.length} err`, `Failed startup step(s): ${failures.join(', ')}`)
    console.error(`ZapCast startup completed with failed step(s): ${failures.join(', ')}`)
  } else {
    clearLaunchStatus()
  }
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
  renderNostrIdentity(nostrIdentity || status.nostr)
  renderNostrRefreshButton()
  renderNostrStreams()
  if ($('copyStreamId')) $('copyStreamId').disabled = !$('streamIdOut').value.trim()
  if ($('announceNostr') && !$('announceNostr').classList.contains('busy')) $('announceNostr').disabled = !$('streamIdOut').value.trim() || !nostrIdentity?.hasSecret
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
  if (tip && !tip.classList.contains('busy')) {
    tip.disabled = !broadcasterPaymentAddress() || !hasSpendableBalance()
  }
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
    return 'Enter a valid source URL.'
  }
  const supportedProtocols = new Set(['rtmp:', 'rtmps:', 'http:', 'https:'])
  if (!supportedProtocols.has(url.protocol)) return 'Source URL must start with rtmp://, rtmps://, http://, or https://.'
  if (!url.hostname) return 'Source URL must include a host.'
  if ((url.protocol === 'rtmp:' || url.protocol === 'rtmps:') && url.pathname === '/') return 'RTMP source URLs must include a stream path.'
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

function renderNostrIdentity (identity = {}) {
  if (!identity) return
  nostrIdentity = identity
  const details = $('nostrDetails')
  if (details) {
    renderMetrics(details, {
      npub: identity.npub || 'generating Nostr key...',
      relays: (identity.relays || []).length
    })
  }
  if ($('nostrRelays') && document.activeElement !== $('nostrRelays')) $('nostrRelays').value = (identity.relays || []).join('\n')
  if ($('copyNpub')) $('copyNpub').disabled = !identity.npub
}

function renderNostrRefreshButton () {
  const button = $('refreshNostrStreams')
  if (!button) return
  button.disabled = nostrDiscoveryLoading
  button.classList.toggle('busy', nostrDiscoveryLoading)
  const label = button.querySelector('.button-label')
  if (label) label.textContent = nostrDiscoveryLoading ? 'Loading Nostr Streams' : 'Refresh Nostr Streams'
}

function paginateStreams (streams = [], { page = 0, pageSize = 10 } = {}) {
  const safePageSize = Math.max(1, Number(pageSize) || 10)
  const safePage = Math.max(0, Number(page) || 0)
  const start = safePage * safePageSize
  return {
    page: safePage,
    pageSize: safePageSize,
    total: streams.length,
    items: streams.slice(start, start + safePageSize),
    hasPrevious: safePage > 0,
    hasNext: start + safePageSize < streams.length
  }
}

function renderNostrStreams () {
  const container = $('nostrStreams')
  if (!container) return
  const page = paginateStreams(nostrStreams, { page: nostrPage, pageSize: 10 })
  nostrPage = page.page

  if ($('nostrPrev')) $('nostrPrev').disabled = !page.hasPrevious || nostrDiscoveryLoading
  if ($('nostrNext')) $('nostrNext').disabled = !page.hasNext || nostrDiscoveryLoading
  if ($('nostrPage')) $('nostrPage').textContent = page.total ? `Page ${page.page + 1} of ${Math.max(1, Math.ceil(page.total / page.pageSize))}` : 'Page 1'

  if (!page.items.length) {
    container.innerHTML = '<div class="empty-state">No streams found.</div>'
    return
  }

  container.innerHTML = page.items.map(stream => `
    <div class="nostr-stream-row">
      <div>
        <strong>${escapeHtml(stream.title)}</strong>
        <p>${escapeHtml(stream.summary || '')}</p>
        <small>${escapeHtml(stream.npub || short(stream.pubkey))} · ${escapeHtml(formatTime(stream.createdAt))} · ${escapeHtml(shortStreamId(stream.streamId))}</small>
      </div>
      ${nostrStreamActionButton(stream)}
    </div>
  `).join('')

  for (const button of container.querySelectorAll('[data-watch-stream]')) {
    button.addEventListener('click', () => run(async () => watchDiscoveredStream(button.dataset.watchStream)))
  }
  for (const button of container.querySelectorAll('[data-stop-nostr-stream]')) {
    button.addEventListener('click', () => run(async () => stopDiscoveredNostrStream(button.dataset.stopNostrStream)))
  }
}

function nostrStreamActionButton (stream) {
  const mine = stream.pubkey && nostrIdentity?.pubkey && stream.pubkey === nostrIdentity.pubkey
  if (mine) return `<button type="button" class="danger" data-stop-nostr-stream="${escapeHtml(stream.streamId)}">Stop</button>`
  return `<button type="button" class="secondary" data-watch-stream="${escapeHtml(stream.streamId)}">Watch</button>`
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

async function ensureNostrIdentity () {
  const existing = await app.nostr()
  if (existing?.pubkey && existing?.hasSecret) {
    renderNostrIdentity(existing)
    await loadNostrSecret()
    return existing
  }

  const nostrClient = await import('./vendor/nostr-client.js')
  const generated = nostrClient.generateNostrIdentity()
  const imported = await app.importNostr(generated)
  renderNostrIdentity(imported)
  setNostrSecretField(imported.nsec || imported.secretKeyHex || '')
  return imported
}

async function saveNostrIdentity () {
  let identity = nostrIdentity || await app.nostr()
  const secret = $('nostrSecret')?.value.trim() || ''
  if (secret && secret !== loadedNostrSecret) {
    const nostrClient = await import('./vendor/nostr-client.js')
    identity = await app.importNostr(nostrClient.identityFromSecret(secret))
    setNostrSecretField(identity.nsec || identity.secretKeyHex || '')
  }
  identity = await app.updateNostrRelays({ relayText: $('nostrRelays').value })
  renderNostrIdentity(identity)
  setStatus('nostrSettingsStatus', 'Nostr identity saved.')
  return identity
}

async function revealNostrSecret () {
  const input = $('nostrSecret')
  const button = $('revealNostr')
  if (!input || !button) return
  const revealing = input.type === 'password'
  if (revealing && !input.value) await loadNostrSecret()
  input.type = revealing ? 'text' : 'password'
  button.title = revealing ? 'Hide Nostr secret' : 'Reveal Nostr secret'
  button.setAttribute('aria-label', button.title)
}

function setNostrSecretField (secret) {
  loadedNostrSecret = secret || ''
  const input = $('nostrSecret')
  const button = $('revealNostr')
  if (input) {
    input.type = 'password'
    input.value = loadedNostrSecret
  }
  if (button) {
    button.title = 'Reveal Nostr secret'
    button.setAttribute('aria-label', button.title)
  }
}

async function loadNostrSecret () {
  const identity = await app.revealNostr()
  setNostrSecretField(identity.nsec || identity.secretKeyHex || '')
  nostrIdentity = { ...nostrIdentity, ...identity }
  return loadedNostrSecret
}

async function announceOnNostr () {
  const streamId = $('streamIdOut').value.trim()
  if (!streamId) throw new Error('Create a stream before announcing on Nostr.')
  const title = $('nostrStreamTitle').value.trim() || 'zapcast live stream'
  const description = $('nostrStreamDescription').value.trim() || 'unstoppable live stream'
  const identity = await app.revealNostr()
  const nostrClient = await import('./vendor/nostr-client.js')
  const result = await nostrClient.publishLiveStream({ identity, relays: nostrIdentity?.relays || identity.relays, streamId, title, description })
  lastNostrAnnouncement = { streamId, title, description }
  setStatus('nostrPublishStatus', `Published to ${result.success} relay(s), failed on ${result.failure}.`)
  return result
}

async function publishNostrEnded ({ streamId, title = 'zapcast live stream', description = '' }) {
  const identity = await app.revealNostr()
  const nostrClient = await import('./vendor/nostr-client.js')
  const result = await nostrClient.publishEndedStream({ identity, relays: nostrIdentity?.relays || identity.relays, streamId, title, description })
  setStatus('nostrPublishStatus', `Ended status published to ${result.success} relay(s), failed on ${result.failure}.`)
  return result
}

async function refreshNostrStreams ({ silent = false } = {}) {
  nostrDiscoveryLoading = true
  setStatus('nostrDiscoveryStatus', silent ? 'Loading live streams from Nostr relays...' : 'Refreshing Nostr streams...')
  renderNostrRefreshButton()
  renderNostrStreams()
  try {
    const identity = nostrIdentity || await app.nostr()
    const nostrClient = await import('./vendor/nostr-client.js')
    const result = await nostrClient.discoverLiveStreams({ relays: identity.relays, limit: 50 })
    nostrStreams = result.streams
    nostrPage = 0
    setStatus('nostrDiscoveryStatus', nostrStreams.length ? `${nostrStreams.length} live ZapCast stream(s) found.` : 'No streams found.')
    return result
  } catch (err) {
    nostrStreams = []
    setStatus('nostrDiscoveryStatus', `Nostr discovery failed: ${err.message}`)
    throw err
  } finally {
    nostrDiscoveryLoading = false
    renderNostrRefreshButton()
    renderNostrStreams()
  }
}

async function stopDiscoveredNostrStream (streamId) {
  if (!streamId) throw new Error('Invalid Nostr event: missing ZapCast stream ID.')
  const stream = nostrStreams.find(item => item.streamId === streamId) || {}
  const current = app.status()
  if (current.metrics?.streamId === streamId && current.ffmpeg?.running) {
    await app.stopIngest().catch(() => {})
  }
  await publishNostrEnded({
    streamId,
    title: stream.title || 'zapcast live stream',
    description: stream.summary || ''
  })
  nostrStreams = nostrStreams.filter(item => item.streamId !== streamId)
  setStatus('nostrDiscoveryStatus', 'Stream marked ended on Nostr relays.')
  renderNostrStreams()
}

async function watchDiscoveredStream (streamId) {
  if (!streamId) throw new Error('Invalid Nostr event: missing ZapCast stream ID.')
  showTab('viewer')
  $('streamIdIn').value = streamId
  await app.joinStream(streamId)
  mse = new MsePlayer($('video'))
  mse.onerror = err => app.reportError?.(err)
  const started = await mse.start(app.status().config?.defaults?.mime || 'video/mp4; codecs="avc1.42c01e,mp4a.40.2"')
  if (!started) throw new Error('This runtime does not support the ZapCast fMP4 playback codec.')
  while (pendingRecords.length) appendRecord(pendingRecords.shift())
  playbackUi.pendingRecords = 0
}

async function ensureWallet () {
  const existing = await app.wallet()
  if (existing.address) {
    renderWallet(existing)
    await loadWalletSecret()
    return existing
  }

  const generated = await generateViemWallet()
  const imported = await app.importWallet({ ...generated, createIfEmpty: true })
  renderWallet(imported)
  setWalletSecretField(imported.mnemonic)
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
    updateViewingButtons(app.status())
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

function shortStreamId (value = '') {
  const text = String(value)
  if (text.length <= 13) return text
  return `${text.slice(0, 5)}...${text.slice(-5)}`
}

function formatTime (unixSeconds) {
  const time = Number(unixSeconds) * 1000
  if (!Number.isFinite(time) || time <= 0) return ''
  return new Date(time).toLocaleString()
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
  const input = $('walletSecret')
  const button = $('revealWallet')
  if (!input || !button) return
  const revealing = input.type === 'password'
  if (revealing && !input.value) {
    await loadWalletSecret()
  }
  input.type = revealing ? 'text' : 'password'
  button.title = revealing ? 'Hide wallet secret' : 'Reveal wallet secret'
  button.setAttribute('aria-label', button.title)
}

function setWalletSecretField (mnemonic) {
  const input = $('walletSecret')
  const button = $('revealWallet')
  if (input) {
    input.type = 'password'
    input.value = mnemonic || ''
  }
  if (button) {
    button.title = 'Reveal wallet secret'
    button.setAttribute('aria-label', button.title)
  }
}

async function loadWalletSecret () {
  const wallet = await app.revealWallet()
  loadedWalletMnemonic = wallet.mnemonic || ''
  setWalletSecretField(loadedWalletMnemonic)
  return loadedWalletMnemonic
}

async function generateViemWallet () {
  const walletClient = await import('./vendor/wallet-client.js')
  return walletClient.generateWallet()
}

async function walletFromMnemonic (mnemonic) {
  const walletClient = await import('./vendor/wallet-client.js')
  return walletClient.walletFromMnemonic(mnemonic)
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

function hasSpendableBalance () {
  const balance = Number(walletBalance?.formatted)
  return Number.isFinite(balance) && balance > 0
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

function paint () {
  return new Promise(resolve => requestAnimationFrame(() => resolve()))
}

function withTimeout (promise, ms, label) {
  return Promise.race([
    promise,
    delay(ms).then(() => {
      throw new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)
    })
  ])
}

function setStatus (id, text) {
  const node = $(id)
  if (node) node.textContent = text
}

function setLaunchStatus (text, title = '') {
  const node = $('launchStatus')
  if (!node) return
  node.hidden = false
  node.textContent = `Launch: ${text}`
  node.title = title || node.textContent
}

function clearLaunchStatus () {
  const node = $('launchStatus')
  if (!node) return
  node.textContent = ''
  node.title = ''
  node.hidden = true
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
