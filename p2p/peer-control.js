import Hyperswarm from 'hyperswarm'
import b4a from 'b4a'
import crypto from 'hypercore-crypto'
import { deriveControlTopic } from '../utils/crypto.js'
import { SimpleEmitter } from '../utils/emitter.js'

export class PeerControl extends SimpleEmitter {
  constructor ({ streamPublicKeyHex, role, streamId, metrics, logger, topology, streamFeed, payment = null, keyPair = null }) {
    super()
    this.topic = deriveControlTopic(streamPublicKeyHex)
    this.role = role
    this.streamId = streamId
    this.metrics = metrics
    this.logger = logger
    this.topology = topology
    this.streamFeed = streamFeed
    this.payment = payment
    this.swarm = new Hyperswarm({ keyPair: keyPair || crypto.keyPair() })
    this.peerId = b4a.toString(this.swarm.keyPair.publicKey, 'hex')
    this.peers = new Map()
  }

  async join ({ client = true, server = true } = {}) {
    this.swarm.on('connection', socket => this.handleConnection(socket))
    const discovery = this.swarm.join(this.topic, { client, server })
    await discovery.flushed()
    this.logger?.add('control_joined', {
      role: this.role,
      peerId: this.peerId,
      streamId: this.streamId,
      message: `client=${client} server=${server}`
    })
    return { peerId: this.peerId, topic: b4a.toString(this.topic, 'hex') }
  }

  handleConnection (socket) {
    const state = { peerId: '', role: '', buffer: '' }
    socket.setEncoding('utf8')
    socket.on('data', data => {
      state.buffer += data
      let offset
      while ((offset = state.buffer.indexOf('\n')) !== -1) {
        const line = state.buffer.slice(0, offset)
        state.buffer = state.buffer.slice(offset + 1)
        if (!line.trim()) continue
        this.handleMessage(socket, state, JSON.parse(line))
      }
    })
    socket.on('error', err => this.metrics?.recordError(err))
    socket.once('close', () => {
      if (state.peerId) {
        this.topology?.disconnected({ remoteRole: state.role })
        this.peers.delete(state.peerId)
        this.refreshPeerMetrics()
        this.logger?.add('peer_disconnected', {
          role: this.role,
          peerId: this.peerId,
          streamId: this.streamId,
          targetPeerId: state.peerId
        })
      }
    })
    this.send(socket, 'hello')
  }

  handleMessage (socket, state, message) {
    if (message.type === 'hello') {
      state.peerId = message.peerId
      state.role = message.role
      const decision = this.topology?.canConnect({ remotePeerId: state.peerId, remoteRole: state.role }) || { ok: true }
      if (!decision.ok) {
        this.send(socket, 'topology', { accepted: false, reason: decision.reason })
        socket.destroy()
        return
      }
      this.topology?.connected({ remoteRole: state.role })
      this.peers.set(state.peerId, { peerId: state.peerId, role: state.role, latestSeq: message.latestSeq, availableRange: message.availableRange, payment: message.payment })
      this.refreshPeerMetrics()
      this.logger?.add('peer_connected', {
        role: this.role,
        peerId: this.peerId,
        streamId: this.streamId,
        sourcePeerId: state.peerId,
        message: `control ${state.role}`
      })
      this.send(socket, 'have')
      this.send(socket, 'stats')
      this.send(socket, 'topology', { accepted: true, policy: this.topology?.snapshot() })
      return
    }

    if (message.type === 'have' && state.peerId) {
      const peer = this.peers.get(state.peerId) || { peerId: state.peerId, role: state.role }
      peer.latestSeq = message.latestSeq
      peer.availableRange = message.availableRange
      if (message.payment) peer.payment = message.payment
      this.peers.set(state.peerId, peer)
      this.refreshPeerMetrics()
      return
    }

    if (message.type === 'want') {
      this.emit('want', { peerId: state.peerId, seq: message.seq })
      return
    }

    if (message.type === 'stats') {
      this.emit('stats', { peerId: state.peerId, stats: message.stats })
      return
    }

    if (message.type === 'topology') {
      this.emit('topology', { peerId: state.peerId, topology: message })
    }
  }

  broadcast (type, payload = {}) {
    for (const socket of this.swarm.connections) this.send(socket, type, payload)
  }

  send (socket, type, payload = {}) {
    const latestSeq = this.metrics?.snapshot().latestSequence || 0
    const message = {
      type,
      peerId: this.peerId,
      role: this.role,
      streamId: this.streamId,
      latestSeq,
      availableRange: this.streamFeed?.availableRange?.() || { start: 0, end: latestSeq },
      stats: type === 'stats' ? this.metrics?.snapshot() : undefined,
      payment: this.payment,
      ...payload
    }
    socket.write(`${JSON.stringify(message)}\n`)
  }

  refreshPeerMetrics () {
    const peers = [...this.peers.values()]
    this.metrics?.set({
      connectedPeers: peers,
      connectedToBroadcaster: peers.some(peer => peer.role === 'broadcaster'),
      directViewers: peers.filter(peer => peer.role === 'viewer').length,
      directRelayers: peers.filter(peer => peer.role === 'relayer').length
    })
  }

  destroy () {
    return this.swarm.destroy()
  }
}
