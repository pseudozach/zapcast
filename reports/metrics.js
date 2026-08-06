export function buildReportMetrics ({ config, metrics, eventLog, payments }) {
  const snapshot = metrics.snapshot()
  const events = eventLog.list()
  return {
    config,
    network: {
      peerId: snapshot.peerId,
      role: snapshot.role,
      connectedPeers: snapshot.connectedPeers,
      connectedToBroadcaster: snapshot.connectedToBroadcaster
    },
    stream: {
      streamId: snapshot.streamId,
      chunksProduced: snapshot.chunksProduced,
      chunksAppended: snapshot.chunksAppended,
      latestSequence: snapshot.latestSequence,
      chunkDuration: snapshot.chunkDuration
    },
    playback: {
      state: snapshot.playbackState,
      liveLatency: snapshot.liveLatency,
      bufferSize: snapshot.bufferSize,
      currentSequence: snapshot.currentSequence,
      rebufferCount: snapshot.rebufferCount,
      rebufferDuration: snapshot.rebufferDuration
    },
    relay: {
      bytesUploaded: snapshot.bytesUploaded,
      bytesDownloaded: snapshot.bytesDownloaded,
      uploadDownloadRatio: snapshot.uploadDownloadRatio,
      chunksServed: snapshot.chunksServed,
      chunksReceived: snapshot.chunksReceived,
      chunkSources: snapshot.chunkSources,
      chunkDestinations: snapshot.chunkDestinations,
      missingChunks: snapshot.missingChunks,
      skippedChunks: snapshot.skippedChunks
    },
    latency: {
      propagationLatency: snapshot.propagationLatency,
      liveLatency: snapshot.liveLatency
    },
    payments: {
      ...payments,
      selectedNetwork: snapshot.wallet?.network || config.paymentNetwork?.key || '',
      chainId: snapshot.wallet?.chainId ?? config.paymentNetwork?.chainId ?? null,
      publicWalletAddress: snapshot.wallet?.address || '',
      asset: snapshot.wallet?.asset || config.paymentNetwork?.asset || '',
      lastTransaction: snapshot.lastTransfer || null,
      forwardingTransaction: snapshot.lastTransfer?.forwardingTransaction || ''
    },
    errors: snapshot.errors,
    events
  }
}
