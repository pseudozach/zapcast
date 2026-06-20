export function attachReplication ({ swarm, streamFeed, logger, metrics, role, streamId }) {
  swarm.on('connection', (socket, info = {}) => {
    const openedAt = Date.now()
    const remotePeerId = info.publicKey ? Buffer.from(info.publicKey).toString('hex') : ''
    logger?.add('peer_connected', { role, streamId, peerId: metrics.peerId, targetPeerId: remotePeerId })
    logger?.add('replication_connected', {
      role,
      streamId,
      peerId: metrics.peerId,
      targetPeerId: remotePeerId,
      message: `feed=${streamFeed.key?.slice(0, 12) || 'pending'} initiator=${socket.isInitiator === true} topics=${info.topics?.length || 0}`
    })
    socket.once('close', () => {
      logger?.add('peer_disconnected', {
        role,
        streamId,
        peerId: metrics.peerId,
        targetPeerId: remotePeerId,
        message: `replication closed after ${Date.now() - openedAt}ms`
      })
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
