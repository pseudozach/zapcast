import Hyperswarm from 'hyperswarm'
import b4a from 'b4a'
import crypto from 'hypercore-crypto'
import { deriveTopic } from '../utils/crypto.js'

export class ZapSwarm {
  constructor ({ streamPublicKeyHex, logger, metrics, role }) {
    this.streamPublicKeyHex = streamPublicKeyHex
    this.topic = deriveTopic(streamPublicKeyHex)
    this.logger = logger
    this.metrics = metrics
    this.role = role
    this.swarm = new Hyperswarm({ keyPair: crypto.keyPair() })
    this.peerId = b4a.toString(this.swarm.keyPair.publicKey, 'hex')
  }

  on (...args) {
    this.swarm.on(...args)
  }

  async join ({ client = true, server = true } = {}) {
    const discovery = this.swarm.join(this.topic, { client, server })
    await discovery.flushed()
    this.metrics?.set({ peerId: this.peerId })
    this.logger?.add('data_swarm_joined', {
      role: this.role,
      peerId: this.peerId,
      message: `client=${client} server=${server} topic=${b4a.toString(this.topic, 'hex').slice(0, 12)}`
    })
    return {
      topic: b4a.toString(this.topic, 'hex'),
      peerId: this.peerId
    }
  }

  connections () {
    return [...this.swarm.connections]
  }

  destroy () {
    return this.swarm.destroy()
  }
}
