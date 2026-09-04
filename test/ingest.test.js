import test from 'node:test'
import assert from 'node:assert/strict'
import { IngestPipeline } from '../broadcaster/ingest.js'

function pipelineWithStatus (status) {
  const pipeline = new IngestPipeline({ streamFeed: {}, metrics: {}, chunkDirectory: '/unused' })
  pipeline.chunker = { status: () => status }
  return pipeline
}

test('ingest readiness requires an appended media record', async () => {
  const pipeline = pipelineWithStatus({ running: true, logs: [] })
  pipeline.appendedCount = 1
  assert.equal(await pipeline.waitForFirstAppend({ timeoutMs: 10, intervalMs: 1 }), 1)
})

test('ingest readiness reports an early ffmpeg failure', async () => {
  const pipeline = pipelineWithStatus({
    running: false,
    error: 'ffmpeg exited with code 1',
    logs: ['Connection refused\nConversion failed!\n']
  })
  await assert.rejects(
    pipeline.waitForFirstAppend({ timeoutMs: 10, intervalMs: 1, exitGraceMs: 0 }),
    /ffmpeg stopped before producing a media segment: Connection refused/
  )
})

test('ingest readiness explains an RTMP video keyframe probe miss', async () => {
  const pipeline = pipelineWithStatus({
    running: false,
    error: 'ffmpeg exited with code 1',
    logs: ["Stream map '0:v:0' matches no streams.\nError opening output files: Invalid argument\n"]
  })
  await assert.rejects(
    pipeline.waitForFirstAppend({ timeoutMs: 10, intervalMs: 1, exitGraceMs: 0 }),
    /no video track was found before the input probe ended/
  )
})

test('ingest readiness times out without claiming the stream is live', async () => {
  const pipeline = pipelineWithStatus({ running: true, logs: [] })
  await assert.rejects(
    pipeline.waitForFirstAppend({ timeoutMs: 5, intervalMs: 1 }),
    /No media segment was produced/
  )
})
