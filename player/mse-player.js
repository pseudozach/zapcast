export class MsePlayer {
  constructor (video) {
    this.video = video
    this.mediaSource = null
    this.sourceBuffer = null
    this.queue = []
    this.started = false
    this.onerror = null
    this.appended = 0
    this.lastAppend = null
    this.objectUrl = ''
    this.failed = false
    this.lastError = ''
    this.positioned = false
  }

  async start (mime) {
    if (!this.video || typeof MediaSource === 'undefined' || !MediaSource.isTypeSupported(mime)) {
      return false
    }
    this.mediaSource = new MediaSource()
    this.objectUrl = URL.createObjectURL(this.mediaSource)
    this.video.src = this.objectUrl
    await new Promise(resolve => this.mediaSource.addEventListener('sourceopen', resolve, { once: true }))
    this.sourceBuffer = this.mediaSource.addSourceBuffer(mime)
    this.sourceBuffer.mode = 'segments'
    this.sourceBuffer.addEventListener('updateend', () => {
      this.appended++
      this.positionAtBufferedStart()
      this.video.play?.().catch?.(() => {})
      this.flush()
    })
    this.sourceBuffer.addEventListener('error', () => this.fail(new Error('MediaSource buffer error')))
    this.video.addEventListener('error', () => this.fail(this.video.error || new Error('Video playback error')))
    this.started = true
    return true
  }

  append (buffer, meta = {}) {
    if (!this.started || this.failed) return
    this.queue.push({ buffer, meta })
    this.flush()
  }

  flush () {
    if (!this.sourceBuffer || this.sourceBuffer.updating || this.queue.length === 0 || this.failed) return
    if (this.mediaSource?.readyState !== 'open') {
      this.fail(new Error('MediaSource closed before queued segments were appended.'))
      return
    }
    const next = this.queue.shift()
    try {
      this.lastAppend = next.meta
      this.sourceBuffer.appendBuffer(next.buffer)
    } catch (err) {
      this.fail(new Error(`append failed seq=${next.meta?.seq ?? ''} type=${next.meta?.type ?? ''} bytes=${next.buffer?.byteLength || 0}: ${err.message}`))
    }
  }

  fail (err) {
    if (this.failed) return
    this.failed = true
    this.started = false
    this.lastError = err?.message || String(err)
    this.queue.length = 0
    this.onerror?.(err)
  }

  positionAtBufferedStart () {
    if (this.positioned || !this.video?.buffered?.length) return
    const start = this.video.buffered.start(0)
    const end = this.video.buffered.end(0)
    if (this.video.currentTime < start || this.video.currentTime > end) {
      this.video.currentTime = Math.min(end, start + 0.05)
    }
    this.positioned = true
  }

  stop () {
    this.queue.length = 0
    this.started = false
    this.failed = false
    this.lastError = ''
    this.positioned = false
    if (this.mediaSource?.readyState === 'open') {
      try {
        this.mediaSource.endOfStream()
      } catch {}
    }
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl)
    this.objectUrl = ''
    this.mediaSource = null
    this.sourceBuffer = null
  }

  snapshot () {
    return {
      started: this.started,
      failed: this.failed,
      lastError: this.lastError,
      appended: this.appended,
      queueLength: this.queue.length,
      sourceBufferUpdating: Boolean(this.sourceBuffer?.updating),
      mediaSourceReadyState: this.mediaSource?.readyState || '',
      videoReadyState: this.video?.readyState ?? 0,
      videoNetworkState: this.video?.networkState ?? 0,
      currentTime: Number(this.video?.currentTime || 0).toFixed(3),
      paused: Boolean(this.video?.paused),
      ended: Boolean(this.video?.ended),
      buffered: bufferedRanges(this.video),
      lastAppend: this.lastAppend
    }
  }
}

function bufferedRanges (video) {
  const ranges = []
  const buffered = video?.buffered
  if (!buffered) return ranges
  for (let i = 0; i < buffered.length; i++) {
    ranges.push({
      start: Number(buffered.start(i).toFixed(3)),
      end: Number(buffered.end(i).toFixed(3))
    })
  }
  return ranges
}
