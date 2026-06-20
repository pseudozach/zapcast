export class TopologyPolicy {
  constructor (options = {}) {
    this.role = options.role || 'viewer'
    this.denyDirectBroadcaster = Boolean(options.denyDirectBroadcaster)
    this.preferRelayPeer = options.preferRelayPeer || ''
    this.allowPeer = new Set(options.allowPeer || [])
    this.blockPeer = new Set(options.blockPeer || [])
    this.maxBroadcasterConnections = Number.isFinite(options.maxBroadcasterConnections)
      ? options.maxBroadcasterConnections
      : Infinity
    this.broadcasterConnections = 0
  }

  update (patch = {}) {
    if ('denyDirectBroadcaster' in patch) this.denyDirectBroadcaster = Boolean(patch.denyDirectBroadcaster)
    if ('preferRelayPeer' in patch) this.preferRelayPeer = patch.preferRelayPeer || ''
    if ('allowPeer' in patch) this.allowPeer = new Set(toList(patch.allowPeer))
    if ('blockPeer' in patch) this.blockPeer = new Set(toList(patch.blockPeer))
    if ('maxBroadcasterConnections' in patch) this.maxBroadcasterConnections = Number(patch.maxBroadcasterConnections)
  }

  canConnect ({ remotePeerId, remoteRole }) {
    if (this.blockPeer.has(remotePeerId)) return { ok: false, reason: 'blocked peer' }
    if (this.allowPeer.size > 0 && !this.allowPeer.has(remotePeerId)) return { ok: false, reason: 'not in allowlist' }
    if (this.role === 'viewer' && this.denyDirectBroadcaster && remoteRole === 'broadcaster') {
      return { ok: false, reason: 'direct broadcaster denied' }
    }
    if (this.role === 'broadcaster' && this.broadcasterConnections >= this.maxBroadcasterConnections) {
      return { ok: false, reason: 'broadcaster connection limit reached' }
    }
    return { ok: true, reason: '' }
  }

  connected ({ remoteRole }) {
    if (this.role === 'broadcaster' && remoteRole === 'viewer') this.broadcasterConnections++
  }

  disconnected ({ remoteRole }) {
    if (this.role === 'broadcaster' && remoteRole === 'viewer') {
      this.broadcasterConnections = Math.max(0, this.broadcasterConnections - 1)
    }
  }

  snapshot () {
    return {
      role: this.role,
      denyDirectBroadcaster: this.denyDirectBroadcaster,
      preferRelayPeer: this.preferRelayPeer,
      allowPeer: [...this.allowPeer],
      blockPeer: [...this.blockPeer],
      maxBroadcasterConnections: this.maxBroadcasterConnections
    }
  }
}

function toList (value) {
  if (Array.isArray(value)) return value
  if (!value) return []
  return String(value).split(',').map(v => v.trim()).filter(Boolean)
}
