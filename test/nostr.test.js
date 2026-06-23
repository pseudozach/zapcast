import test from 'node:test'
import assert from 'node:assert/strict'
import { buildZapcastEndedEvent, buildZapcastLiveEvent, NIP53_LIVE_EVENT_KIND } from '../src/nostr/event-builder.js'
import { extractZapcastStreamId, filterLiveZapcastEvents } from '../src/nostr/parser.js'
import { parseRelayList } from '../src/nostr/relays.js'

const streamId = 'zc1:abcde:12345'

test('builds valid kind 30311 ZapCast live event template', () => {
  const event = buildZapcastLiveEvent({ streamId, title: 'zapcast live stream', description: 'unstoppable live stream', createdAt: 123 })
  assert.equal(event.kind, NIP53_LIVE_EVENT_KIND)
  assert.equal(event.created_at, 123)
  assert.equal(event.content, 'unstoppable live stream')
  assert.deepEqual(event.tags.find(tag => tag[0] === 'd'), ['d', streamId])
  assert.deepEqual(event.tags.find(tag => tag[0] === 'zapcast'), ['zapcast', streamId])
  assert.deepEqual(event.tags.find(tag => tag[0] === 'streaming'), ['streaming', 'zapcast:' + streamId])
  assert.deepEqual(event.tags.find(tag => tag[0] === 'status'), ['status', 'live'])
})

test('extracts ZapCast stream ID from event tags', () => {
  assert.equal(extractZapcastStreamId({ tags: [['zapcast', streamId]] }), streamId)
  assert.equal(extractZapcastStreamId({ tags: [['streaming', 'zapcast:' + streamId]] }), streamId)
  assert.equal(extractZapcastStreamId({ tags: [['d', streamId]] }), streamId)
})

test('filters only live ZapCast events', () => {
  const live = signedLike(buildZapcastLiveEvent({ streamId, title: 'Live', description: 'Now', createdAt: 10 }))
  const ended = signedLike(buildZapcastEndedEvent({ streamId: 'zc1:ended:stream', title: 'Ended', createdAt: 11 }))
  const missingZapcastTag = signedLike({ ...live, tags: live.tags.filter(tag => tag[0] !== 'zapcast') })
  const wrongKind = signedLike({ ...live, kind: 1 })
  const result = filterLiveZapcastEvents([ended, missingZapcastTag, wrongKind, live], { now: 20 })
  assert.equal(result.length, 1)
  assert.equal(result[0].streamId, streamId)
})

test('filters out live ZapCast events older than 24 hours', () => {
  const fresh = signedLike(buildZapcastLiveEvent({ streamId, title: 'Fresh', createdAt: 100 }))
  const stale = signedLike(buildZapcastLiveEvent({ streamId: 'zc1:stale:stream', title: 'Stale', createdAt: 100 - (24 * 60 * 60) - 1 }))
  const result = filterLiveZapcastEvents([fresh, stale], { now: 100 })
  assert.equal(result.length, 1)
  assert.equal(result[0].streamId, streamId)
})

test('ended event uses same d tag', () => {
  const live = buildZapcastLiveEvent({ streamId, title: 'Live' })
  const ended = buildZapcastEndedEvent({ streamId, title: 'Live' })
  assert.deepEqual(ended.tags.find(tag => tag[0] === 'd'), live.tags.find(tag => tag[0] === 'd'))
  assert.equal(ended.tags.find(tag => tag[0] === 'status')[1], 'ended')
})

test('parses relay list', () => {
  assert.deepEqual(parseRelayList('wss://relay.damus.io, https://bad.example wss://nos.lol/ wss://nos.lol'), [
    'wss://relay.damus.io',
    'wss://nos.lol'
  ])
})

function signedLike (event) {
  return { id: 'id', pubkey: 'f'.repeat(64), sig: '0'.repeat(128), ...event }
}
