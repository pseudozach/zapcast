export function splitZap ({ sats = 1000, relayers = [], currentPeerId = '' }) {
  const streamer = Math.floor(sats * 0.7)
  const relayerPool = Math.floor(sats * 0.2)
  const protocol = sats - streamer - relayerPool
  const scores = relayers.map(relayer => ({
    peerId: relayer.peerId,
    score: (relayer.bytesUploaded || 0) * Math.min(1, (relayer.uptime || 0) / 300)
  }))
  const totalScore = scores.reduce((sum, relayer) => sum + relayer.score, 0)
  const relayerSplits = scores.map(relayer => ({
    peerId: relayer.peerId,
    sats: totalScore > 0 ? Math.floor((relayer.score / totalScore) * relayerPool) : 0
  }))
  const current = relayerSplits.find(split => split.peerId === currentPeerId)?.sats || 0
  return {
    zapSats: sats,
    streamerPendingSats: streamer,
    relayerPendingSats: relayerPool,
    protocolPendingSats: protocol,
    currentUserPendingSats: current,
    relayerSplits
  }
}
