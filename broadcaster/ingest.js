import { FfmpegChunker } from './chunker.js'
import { ChunkWatcher } from './chunk-watcher.js'

export class IngestPipeline {
  constructor ({ streamFeed, logger, metrics, chunkDirectory }) {
    this.streamFeed = streamFeed
    this.logger = logger
    this.metrics = metrics
    this.chunkDirectory = chunkDirectory
    this.chunker = new FfmpegChunker({ chunkDirectory, logger, metrics })
    this.watcher = null
    this.appendQueue = Promise.resolve()
    this.appendedCount = 0
  }

  async start ({ input, mode, streamId }) {
    this.appendedCount = 0
    const { outputDirectory, args } = await this.chunker.start({ input, mode, streamId })
    this.watcher = new ChunkWatcher({
      directory: outputDirectory,
      streamId,
      logger: this.logger,
      metrics: this.metrics
    })
    this.watcher.on('chunk', record => {
      this.appendQueue = this.appendQueue.then(async () => {
        await this.streamFeed.append(record)
        this.appendedCount++
        this.metrics?.increment('chunksAppended')
        this.metrics?.set({ latestSequence: record.meta.seq })
        this.logger?.add('chunk_appended', {
          role: 'broadcaster',
          streamId,
          seq: record.meta.seq,
          bytes: record.meta.byteLength
        })
      }).catch(err => {
        this.metrics?.recordError(err)
      })
    })
    this.watcher.on('error', err => this.metrics?.recordError(err))
    this.watcher.start()
    return { outputDirectory, args }
  }

  async waitForFirstAppend ({ timeoutMs = 45000, intervalMs = 250, exitGraceMs = 1000 } = {}) {
    const startedAt = Date.now()
    let stoppedAt = 0
    while (Date.now() - startedAt < timeoutMs) {
      if (this.appendedCount > 0) return this.appendedCount
      const status = this.status()
      if (!status.running) {
        stoppedAt ||= Date.now()
        if (Date.now() - stoppedAt >= exitGraceMs) throw new Error(ingestFailureMessage(status))
      } else {
        stoppedAt = 0
      }
      await delay(intervalMs)
    }
    throw new Error(`No media segment was produced within ${Math.round(timeoutMs / 1000)} seconds. Check that the source is live and reachable by ffmpeg.`)
  }

  stop () {
    this.watcher?.stop()
    this.watcher = null
    this.chunker.stop()
  }

  status () {
    return this.chunker.status()
  }
}

function ingestFailureMessage (status = {}) {
  const lines = (status.logs || [])
    .flatMap(message => String(message).split('\n'))
    .map(line => line.trim())
    .filter(Boolean)
  if (lines.some(line => /stream map .*0:v:0.*matches no streams/i.test(line))) {
    return 'ffmpeg stopped before producing a media segment: no video track was found before the input probe ended. The RTMP source may not have delivered a video keyframe yet; retry or shorten the publisher GOP/keyframe interval.'
  }
  const reversed = [...lines].reverse()
  const detail = reversed.find(line => /refused|not found|invalid|unable|premature|timed out/i.test(line)) ||
    reversed.find(line => /error|failed/i.test(line)) ||
    lines.at(-1) ||
    status.error
  return `ffmpeg stopped before producing a media segment${detail ? `: ${detail}` : '.'}`
}

function delay (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
