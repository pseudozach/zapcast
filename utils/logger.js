import { SimpleEmitter } from './emitter.js'
import { nowIso } from './time.js'

export class EventLog extends SimpleEmitter {
  constructor ({ max = 5000 } = {}) {
    super()
    this.max = max
    this.events = []
  }

  add (event, fields = {}) {
    const record = {
      timestamp: nowIso(),
      event,
      role: fields.role || '',
      peerId: fields.peerId || '',
      streamId: fields.streamId || '',
      seq: fields.seq ?? '',
      bytes: fields.bytes ?? '',
      sourcePeerId: fields.sourcePeerId || '',
      targetPeerId: fields.targetPeerId || '',
      message: fields.message || ''
    }
    this.events.push(record)
    if (this.events.length > this.max) this.events.shift()
    this.emit('event', record)
    return record
  }

  list () {
    return [...this.events]
  }
}
