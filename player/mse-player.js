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
      this.video.play?.().catch?.(() => {})
      this.flush()
    })
    this.sourceBuffer.addEventListener('error', () => this.onerror?.(new Error('MediaSource buffer error')))
    this.video.addEventListener('error', () => this.onerror?.(this.video.error || new Error('Video playback error')))
    this.started = true
    return true
  }

  append (buffer, meta = {}) {
    if (!this.started) return
    this.queue.push({ buffer, meta })
    this.flush()
  }

  flush () {
    if (!this.sourceBuffer || this.sourceBuffer.updating || this.queue.length === 0) return
    const next = this.queue.shift()
    try {
      this.lastAppend = next.meta
      this.sourceBuffer.appendBuffer(next.buffer)
    } catch (err) {
      this.onerror?.(new Error(`append failed seq=${next.meta?.seq ?? ''} type=${next.meta?.type ?? ''} bytes=${next.buffer?.byteLength || 0}: ${err.message}`))
    }
  }

  stop () {
    this.queue.length = 0
    this.started = false
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
