import { DEFAULTS } from '../src/config.js'
import { fsPromises, joinPath, subprocess } from '../utils/platform.js'

export class FallbackPlayer {
  constructor ({ directory = DEFAULTS.playbackDirectory, logger, metrics } = {}) {
    this.directory = directory
    this.logger = logger
    this.metrics = metrics
    this.process = null
  }

  async writeRecord (record) {
    const fs = await fsPromises()
    const streamDir = joinPath(this.directory, record.meta.streamId)
    await fs.mkdir(streamDir, { recursive: true })
    const name = record.meta.isInitSegment ? 'init.mp4' : `chunk-${String(record.meta.seq).padStart(9, '0')}.m4s`
    await fs.writeFile(joinPath(streamDir, name), record.data)
    return joinPath(streamDir, name)
  }

  async launch (streamId) {
    if (this.process) return
    const fs = await fsPromises()
    const { spawn } = await subprocess()
    const streamDir = joinPath(this.directory, streamId)
    const playlist = joinPath(streamDir, 'chunk-stream.m3u8')
    await fs.access(playlist)
    this.process = spawn('ffplay', ['-fflags', 'nobuffer', '-flags', 'low_delay', playlist], { stdio: 'ignore' })
    this.process.once('exit', () => { this.process = null })
  }

  stop () {
    this.process?.kill('SIGTERM')
    this.process = null
  }
}
