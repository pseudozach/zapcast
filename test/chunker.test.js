import test from 'node:test'
import assert from 'node:assert/strict'
import { buildFfmpegArgs } from '../broadcaster/chunker.js'

test('ffmpeg ingest requires video and optionally maps audio', () => {
  const args = buildFfmpegArgs({
    input: 'rtmp://127.0.0.1/live/zapcast',
    mode: 'url',
    outputDirectory: '/tmp/zapcast',
    chunkDurationSeconds: 2
  })
  assert.deepEqual(args.slice(args.indexOf('-map'), args.indexOf('-map') + 4), ['-map', '0:v:0', '-map', '0:a:0?'])
  assert.ok(args.includes('-analyzeduration'))
  assert.ok(args.includes('-probesize'))
})
