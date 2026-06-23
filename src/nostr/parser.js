import { NIP53_LIVE_EVENT_KIND } from './event-builder.js'

export const LIVE_STREAM_MAX_AGE_SECONDS = 24 * 60 * 60

export function tagValue (event, name) {
  const tag = event?.tags?.find(tag => Array.isArray(tag) && tag[0] === name && tag[1])
  return tag ? String(tag[1]) : ''
}

export function tagValues (event, name) {
  return (event?.tags || [])
    .filter(tag => Array.isArray(tag) && tag[0] === name && tag[1])
    .map(tag => String(tag[1]))
}

export function hasTagValue (event, name, value) {
  return tagValues(event, name).some(item => item.toLowerCase() === String(value).toLowerCase())
}

export function extractZapcastStreamId (event) {
  const explicit = tagValue(event, 'zapcast')
  if (explicit) return explicit

  const streaming = tagValues(event, 'streaming').find(value => value.startsWith('zapcast:'))
  if (streaming) return streaming.slice('zapcast:'.length)

  const d = tagValue(event, 'd')
  return d.startsWith('zc1:') ? d : ''
}

export function parseZapcastLiveEvent (event, { now = unixNow(), maxAgeSeconds = LIVE_STREAM_MAX_AGE_SECONDS } = {}) {
  if (!event || event.kind !== NIP53_LIVE_EVENT_KIND) return invalid('invalid event kind')
  if (!hasTagValue(event, 't', 'zapcast')) return invalid('missing zapcast topic tag')
  if (tagValue(event, 'status') !== 'live') return invalid('stream is not live')
  const createdAt = Number(event.created_at || 0)
  if (!createdAt) return invalid('missing created_at')
  if (maxAgeSeconds > 0 && now - createdAt > maxAgeSeconds) return invalid('stream announcement is stale')

  const streamId = extractZapcastStreamId(event)
  const title = tagValue(event, 'title')
  const summary = tagValue(event, 'summary') || String(event.content || '')
  if (!streamId) return invalid('missing ZapCast stream ID')
  if (!title) return invalid('missing title')
  if (!tagValue(event, 'zapcast')) return invalid('missing ZapCast tag')

  return {
    ok: true,
    stream: {
      id: event.id || '',
      pubkey: event.pubkey || '',
      createdAt,
      title,
      summary,
      streamId
    }
  }
}

export function filterLiveZapcastEvents (events = [], options = {}) {
  const byStream = new Map()
  for (const event of events) {
    const parsed = parseZapcastLiveEvent(event, options)
    if (!parsed.ok) continue
    const existing = byStream.get(parsed.stream.streamId)
    if (!existing || parsed.stream.createdAt > existing.createdAt) byStream.set(parsed.stream.streamId, parsed.stream)
  }
  return [...byStream.values()].sort((a, b) => b.createdAt - a.createdAt)
}

function invalid (reason) {
  return { ok: false, reason }
}

function unixNow () {
  return Math.floor(Date.now() / 1000)
}
