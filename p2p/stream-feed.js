import Corestore from 'corestore'
import b4a from 'b4a'
import { DEFAULTS } from '../src/config.js'

export class StreamFeed {
  constructor ({ storageDirectory = DEFAULTS.storageDirectory, streamId, writable = false, key = null, metrics, logger } = {}) {
    this.storageDirectory = storageDirectory
    this.streamId = streamId
    this.writable = writable
    this.metrics = metrics
    this.logger = logger
    this.store = new Corestore(storageDirectory)
    this.core = null
    this.key = key
    this.cache = new Map()
    this.retention = DEFAULTS.chunkRetention
  }

  async open () {
    await this.store.ready()
    this.core = this.key
      ? this.store.get({ key: b4a.from(this.key, 'hex'), valueEncoding: 'json' })
      : this.store.get({ name: `stream-${this.streamId}`, valueEncoding: 'json' })
    await this.core.ready()
    this.key = b4a.toString(this.core.key, 'hex')
    this.logger?.add('feed_opened', {
      role: this.writable ? 'broadcaster' : 'viewer',
      streamId: this.streamId,
      message: `${this.writable ? 'writable' : 'readable'} key ${this.key.slice(0, 12)} storage ${this.storageDirectory}`
    })
    return this
  }

  async append (record) {
    const encoded = encodeRecord(record)
    await this.core.append(encoded)
    this.cacheRecord(record)
    this.logger?.add('feed_appended', {
      role: this.writable ? 'broadcaster' : 'viewer',
      streamId: this.streamId,
      seq: record.meta?.seq,
      bytes: record.meta?.byteLength,
      message: `core length ${this.core.length}`
    })
    return this.core.length - 1
  }

  async get (index) {
    const record = this.cache.get(index)
    if (record) return record
    const encoded = await this.core.get(index)
    const decoded = decodeRecord(encoded)
    this.cacheRecord(decoded)
    return decoded
  }

  async update () {
    const before = this.core.length
    await this.core.update()
    if (this.core.length !== before) {
      this.logger?.add('feed_length_changed', {
        role: this.writable ? 'broadcaster' : 'viewer',
        streamId: this.streamId,
        message: `${before} -> ${this.core.length}`
      })
    }
    this.metrics?.set({ latestSequence: Math.max(0, this.core.length - 1), bufferSize: this.core.length })
    return this.core.length
  }

  createReadStream ({ start = 0, live = true } = {}) {
    return this.core.createReadStream({ start, live })
  }

  replicate (socket) {
    return this.store.replicate(socket)
  }

  cacheRecord (record) {
    const seq = record?.meta?.seq
    if (seq === undefined) return
    this.cache.set(seq, record)
    while (this.cache.size > this.retention) {
      const oldest = Math.min(...this.cache.keys())
      this.cache.delete(oldest)
    }
  }

  availableRange () {
    if (this.cache.size === 0) return { start: 0, end: 0 }
    const keys = [...this.cache.keys()]
    return { start: Math.min(...keys), end: Math.max(...keys) }
  }

  close () {
    return this.store.close()
  }
}

export function encodeRecord (record) {
  return {
    ...record,
    data: Buffer.from(record.data).toString('base64')
  }
}

export function decodeRecord (record) {
  return {
    ...record,
    data: Buffer.from(record.data, 'base64')
  }
}
