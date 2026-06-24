import test from 'node:test'
import assert from 'node:assert/strict'
import { hasVideoTrack } from '../broadcaster/chunk-watcher.js'

test('detects video track markers in fMP4 init data', () => {
  assert.equal(hasVideoTrack(Buffer.from('ftyp....moov....trak....avc1....avcC')), true)
  assert.equal(hasVideoTrack(Buffer.from('ftyp....moov....trak....mp4a....esds')), false)
})
