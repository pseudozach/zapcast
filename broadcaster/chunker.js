import { DEFAULTS } from '../src/config.js'
import { fsPromises, joinPath, subprocess } from '../utils/platform.js'

export class FfmpegChunker {
  constructor ({ chunkDirectory = DEFAULTS.chunkDirectory, chunkDurationSeconds = DEFAULTS.chunkDurationSeconds, logger, metrics } = {}) {
    this.chunkDirectory = chunkDirectory
    this.chunkDurationSeconds = chunkDurationSeconds
    this.logger = logger
    this.metrics = metrics
    this.process = null
    this.logs = []
    this.lastStatus = {
      running: false,
      input: '',
      mode: '',
      outputDirectory: '',
      args: [],
      error: ''
    }
  }

  async start ({ input, mode = 'rtmp', streamId }) {
    if (this.process) throw new Error('ffmpeg is already running')
    if (!input) throw new Error('Missing RTMP URL or video file path')

    const fs = await fsPromises()
    const { spawn } = await subprocess()
    const outputDirectory = joinPath(this.chunkDirectory, streamId)
    await fs.rm(outputDirectory, { recursive: true, force: true }).catch(() => {})
    await fs.mkdir(outputDirectory, { recursive: true })

    const args = buildFfmpegArgs({
      input,
      mode,
      outputDirectory,
      chunkDurationSeconds: this.chunkDurationSeconds
    })

    this.process = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    this.lastStatus = { running: true, input, mode, outputDirectory, args, error: '' }
    this.metrics?.set({ chunkDuration: this.chunkDurationSeconds })

    const onLog = data => {
      const message = data.toString()
      this.logs.push(message)
      if (this.logs.length > 200) this.logs.shift()
    }
    this.process.stdout.on('data', onLog)
    this.process.stderr.on('data', onLog)
    this.process.once('error', err => {
      const message = err?.message || String(err)
      this.lastStatus.running = false
      this.lastStatus.error = message
      this.logs.push(message)
      this.metrics?.recordError(err)
      this.logger?.add('error', {
        role: 'broadcaster',
        streamId,
        message
      })
    })

    this.process.once('exit', code => {
      this.lastStatus.running = false
      if (code !== 0) this.lastStatus.error = `ffmpeg exited with code ${code}`
      this.logger?.add(code === 0 ? 'ffmpeg_stopped' : 'error', {
        role: 'broadcaster',
        streamId,
        message: `ffmpeg exited with code ${code}`
      })
      this.process = null
    })

    return { outputDirectory, args }
  }

  stop () {
    if (!this.process) return
    this.process.kill('SIGTERM')
    this.process = null
  }

  status () {
    return {
      ...this.lastStatus,
      running: Boolean(this.process),
      logs: this.logs.slice(-80)
    }
  }
}

export function buildFfmpegArgs ({ input, mode, outputDirectory, chunkDurationSeconds }) {
  const args = ['-hide_banner', '-loglevel', 'info']
  if (mode === 'file') args.push('-re')
  args.push('-i', input)
  args.push(
    '-c:v', 'libx264',
    '-profile:v', 'baseline',
    '-level:v', '3.0',
    '-pix_fmt', 'yuv420p',
    '-preset', 'veryfast',
    '-tune', 'zerolatency',
    '-g', String(Math.max(24, chunkDurationSeconds * 30)),
    '-keyint_min', String(Math.max(24, chunkDurationSeconds * 30)),
    '-sc_threshold', '0',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-movflags', '+frag_keyframe+empty_moov+default_base_moof',
    '-f', 'hls',
    '-hls_segment_type', 'fmp4',
    '-hls_time', String(chunkDurationSeconds),
    '-hls_list_size', '6',
    '-hls_flags', 'delete_segments+append_list+program_date_time+independent_segments',
    '-hls_fmp4_init_filename', 'init.mp4',
      '-hls_segment_filename', joinPath(outputDirectory, 'chunk-%09d.m4s'),
      joinPath(outputDirectory, 'chunk-stream.m3u8')
  )
  return args
}
