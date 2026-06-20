import { APP_VERSION } from '../src/config.js'
import { uptimeSeconds } from '../utils/time.js'
import { SimpleEmitter } from '../utils/emitter.js'

export class Metrics extends SimpleEmitter {
  constructor ({ role, peerId, eventLog }) {
    super()
    this.startedAt = Date.now()
    this.sessionStartedAt = null
    this.sessionElapsed = 0
    this.role = role
    this.peerId = peerId
    this.eventLog = eventLog
    this.state = {
      appVersion: APP_VERSION,
      peerId,
      role,
      streamId: '',
      connectedPeers: [],
      connectedToBroadcaster: false,
      directViewers: 0,
      directRelayers: 0,
      chunksProduced: 0,
      chunksAppended: 0,
      chunkDuration: 0,
      bytesServed: 0,
      chunksServed: 0,
      bytesDownloaded: 0,
      bytesUploaded: 0,
      chunksReceived: 0,
      chunkSources: {},
      chunkDestinations: {},
      missingChunks: 0,
      skippedChunks: 0,
      rebufferCount: 0,
      rebufferDuration: 0,
      playbackState: 'idle',
      liveLatency: 0,
      bufferSize: 0,
      currentSequence: 0,
      latestSequence: 0,
      propagationLatency: [],
      errors: []
    }
  }

  set (patch) {
    Object.assign(this.state, patch)
    this.emit('change', this.snapshot())
  }

  increment (key, value = 1) {
    this.state[key] = (this.state[key] || 0) + value
    this.emit('change', this.snapshot())
  }

  startSession () {
    this.sessionStartedAt = Date.now()
    this.sessionElapsed = 0
    this.emit('change', this.snapshot())
  }

  stopSession () {
    if (this.sessionStartedAt !== null) {
      this.sessionElapsed += Date.now() - this.sessionStartedAt
      this.sessionStartedAt = null
    }
    this.emit('change', this.snapshot())
  }

  recordError (error) {
    const message = error?.message || String(error)
    this.state.errors.push({ at: new Date().toISOString(), message })
    this.eventLog?.add('error', { role: this.role, peerId: this.peerId, streamId: this.state.streamId, message })
    this.emit('change', this.snapshot())
  }

  recordSource (_seq, peerId, bytes) {
    this.state.chunkSources[peerId] = (this.state.chunkSources[peerId] || 0) + 1
    this.increment('chunksReceived')
    this.increment('bytesDownloaded', bytes)
  }

  recordDestination (seq, peerId, bytes) {
    if (!this.state.chunkDestinations[seq]) this.state.chunkDestinations[seq] = []
    this.state.chunkDestinations[seq].push(peerId)
    this.increment('chunksServed')
    this.increment('bytesServed', bytes)
    this.increment('bytesUploaded', bytes)
  }

  snapshot () {
    const elapsed = this.sessionElapsed + (this.sessionStartedAt === null ? 0 : Date.now() - this.sessionStartedAt)
    const uptime = Math.floor(elapsed / 1000)
    const uploaded = this.state.bytesUploaded
    const downloaded = this.state.bytesDownloaded
    return {
      ...this.state,
      uptime,
      uploadMbps: uptime > 0 ? Number(((uploaded * 8) / uptime / 1000000).toFixed(3)) : 0,
      uploadDownloadRatio: downloaded > 0 ? Number((uploaded / downloaded).toFixed(3)) : 0
    }
  }
}
