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
  }

  async start ({ input, mode, streamId }) {
    const { outputDirectory, args } = await this.chunker.start({ input, mode, streamId })
    this.watcher = new ChunkWatcher({
      directory: outputDirectory,
      streamId,
      logger: this.logger,
      metrics: this.metrics
    })
    this.watcher.on('chunk', async record => {
      try {
        await this.streamFeed.append(record)
        this.metrics?.increment('chunksAppended')
        this.metrics?.set({ latestSequence: record.meta.seq })
        this.logger?.add('chunk_appended', {
          role: 'broadcaster',
          streamId,
          seq: record.meta.seq,
          bytes: record.meta.byteLength
        })
      } catch (err) {
        this.metrics?.recordError(err)
      }
    })
    this.watcher.on('error', err => this.metrics?.recordError(err))
    this.watcher.start()
    return { outputDirectory, args }
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
