export function attachReplication ({ swarm, streamFeed, logger, metrics, role, streamId }) {
  swarm.on('connection', (socket, info = {}) => {
    const openedAt = Date.now()
    const remotePeerId = info.publicKey ? Buffer.from(info.publicKey).toString('hex') : ''
    const dataPeerId = remotePeerId || `data-${Date.now().toString(36)}`
    logger?.add('peer_connected', { role, streamId, peerId: metrics.peerId, targetPeerId: remotePeerId })
    logger?.add('replication_connected', {
      role,
      streamId,
      peerId: metrics.peerId,
      targetPeerId: remotePeerId,
      message: `feed=${streamFeed.key?.slice(0, 12) || 'pending'} initiator=${socket.isInitiator === true} topics=${info.topics?.length || 0}`
    })
    upsertDataPeer(metrics, {
      peerId: dataPeerId,
      role: role === 'viewer' ? 'broadcaster' : 'viewer',
      source: 'data',
      latestSeq: metrics.snapshot?.().latestSequence || 0,
      availableRange: streamFeed.availableRange?.() || { start: 0, end: metrics.snapshot?.().latestSequence || 0 }
    })
    socket.once('close', () => {
      logger?.add('peer_disconnected', {
        role,
        streamId,
        peerId: metrics.peerId,
        targetPeerId: remotePeerId,
        message: `replication closed after ${Date.now() - openedAt}ms`
      })
      removeDataPeer(metrics, dataPeerId)
    })
    socket.on('error', err => {
      metrics?.recordError(err)
      logger?.add('error', {
        role,
        streamId,
        peerId: metrics.peerId,
        targetPeerId: remotePeerId,
        message: `socket: ${err.message}`
      })
    })
    const replication = streamFeed.replicate(socket)
    replication?.on?.('error', err => {
      metrics?.recordError(err)
      logger?.add('error', {
        role,
        streamId,
        peerId: metrics.peerId,
        targetPeerId: remotePeerId,
        message: `replication: ${err.message}`
      })
    })
  })
}

function upsertDataPeer (metrics, peer) {
  if (!metrics || !peer.peerId) return
  const snapshot = metrics.snapshot?.() || {}
  const peers = (snapshot.connectedPeers || []).filter(existing => existing.peerId !== peer.peerId)
  peers.push(peer)
  metrics.set({
    connectedPeers: peers,
    connectedToBroadcaster: peers.some(existing => existing.role === 'broadcaster'),
    directViewers: peers.filter(existing => existing.role === 'viewer').length,
    directRelayers: peers.filter(existing => existing.role === 'relayer').length
  })
}

function removeDataPeer (metrics, peerId) {
  if (!metrics || !peerId) return
  const snapshot = metrics.snapshot?.() || {}
  const peers = (snapshot.connectedPeers || []).filter(peer => !(peer.peerId === peerId && peer.source === 'data'))
  metrics.set({
    connectedPeers: peers,
    connectedToBroadcaster: peers.some(peer => peer.role === 'broadcaster'),
    directViewers: peers.filter(peer => peer.role === 'viewer').length,
    directRelayers: peers.filter(peer => peer.role === 'relayer').length
  })
}
