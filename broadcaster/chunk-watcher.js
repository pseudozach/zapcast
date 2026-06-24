import { DEFAULTS } from '../src/config.js'
import { sha256Hex } from '../utils/crypto.js'
import { nowIso } from '../utils/time.js'
import { SimpleEmitter } from '../utils/emitter.js'
import { fsPromises, joinPath } from '../utils/platform.js'

export class ChunkWatcher extends SimpleEmitter {
  constructor ({ directory, streamId, intervalMs = 500, mime = DEFAULTS.mime, logger, metrics } = {}) {
    super()
    this.directory = directory
    this.streamId = streamId
    this.intervalMs = intervalMs
    this.mime = mime
    this.logger = logger
    this.metrics = metrics
    this.timer = null
    this.seen = new Set()
    this.seq = 0
  }

  start () {
    if (this.timer) return
    this.timer = setInterval(() => this.scan().catch(err => this.emit('error', err)), this.intervalMs)
    this.scan().catch(err => this.emit('error', err))
  }

  stop () {
    if (!this.timer) return
    clearInterval(this.timer)
    this.timer = null
  }

  async scan () {
    const fs = await fsPromises()
    const playlist = await fs.readFile(joinPath(this.directory, 'chunk-stream.m3u8'), 'utf8').catch(() => '')
    const files = playlistFiles(playlist)

    for (const file of files) {
      if (this.seen.has(file)) continue
      const absolute = joinPath(this.directory, file)
      const stat = await fs.stat(absolute).catch(() => null)
      if (!stat || stat.size === 0) continue
      const data = await fs.readFile(absolute)
      const isInitSegment = file === 'init.mp4'
      const seq = isInitSegment ? 0 : ++this.seq
      const meta = {
        streamId: this.streamId,
        seq,
        createdAt: stat.birthtime?.toISOString?.() || nowIso(),
        appendedAt: nowIso(),
        durationMs: isInitSegment ? 0 : DEFAULTS.chunkDurationSeconds * 1000,
        byteLength: data.byteLength,
        mime: this.mime,
        isInitSegment,
        sha256: sha256Hex(data),
        payment: this.metrics?.snapshot?.().payment || null
      }
      const record = {
        type: isInitSegment ? 'init' : 'chunk',
        meta,
        data
      }
      this.seen.add(file)
      this.metrics?.increment('chunksProduced')
      this.logger?.add('chunk_detected', {
        role: 'broadcaster',
        streamId: this.streamId,
        seq,
        bytes: data.byteLength,
        message: file
      })
      this.emit('chunk', record)
    }
  }
}

function sortChunks (a, b) {
  if (a === 'init.mp4') return -1
  if (b === 'init.mp4') return 1
  return a.localeCompare(b)
}

function playlistFiles (playlist) {
  if (!playlist) return []
  const files = []
  for (const line of playlist.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (trimmed.startsWith('#EXT-X-MAP:')) {
      const match = trimmed.match(/URI="([^"]+)"/)
      if (match) files.push(match[1])
      continue
    }
    if (!trimmed.startsWith('#') && trimmed.endsWith('.m4s')) files.push(trimmed)
  }
  return [...new Set(files)].sort(sortChunks)
}

export function hasVideoTrack (data) {
  return hasAscii(data, 'avc1') || hasAscii(data, 'avc3') || hasAscii(data, 'hvc1') || hasAscii(data, 'hev1') || hasAscii(data, 'vp09')
}

function hasAscii (data, text) {
  const needle = [...text].map(char => char.charCodeAt(0))
  for (let index = 0; index <= data.byteLength - needle.length; index++) {
    let matched = true
    for (let offset = 0; offset < needle.length; offset++) {
      if (data[index + offset] !== needle[offset]) {
        matched = false
        break
      }
    }
    if (matched) return true
  }
  return false
}
