export const NIP53_LIVE_EVENT_KIND = 30311
export const ZAPCAST_CLIENT_TAG = 'zapcast'
export const ZAPCAST_DISCOVERY_URL = 'https://zapcast.live'

export function buildZapcastLiveEvent ({ streamId, title, description, status = 'live', createdAt = unixNow() } = {}) {
  const normalizedStreamId = normalizeRequired(streamId, 'ZapCast stream ID')
  const normalizedTitle = normalizeRequired(title, 'Nostr stream title')
  const normalizedDescription = String(description || '').trim()
  const normalizedStatus = normalizeStatus(status)

  return {
    kind: NIP53_LIVE_EVENT_KIND,
    created_at: createdAt,
    content: normalizedDescription,
    tags: [
      ['d', normalizedStreamId],
      ['title', normalizedTitle],
      ['summary', normalizedDescription],
      ['status', normalizedStatus],
      ['t', 'zapcast'],
      ['t', 'livestream'],
      ['client', ZAPCAST_CLIENT_TAG],
      ['zapcast', normalizedStreamId],
      ['streaming', 'zapcast:' + normalizedStreamId],
      ['r', ZAPCAST_DISCOVERY_URL],
      ['alt', 'ZapCast live stream: ' + normalizedTitle]
    ]
  }
}

export function buildZapcastEndedEvent ({ streamId, title = 'zapcast live stream', description = '', createdAt = unixNow() } = {}) {
  return buildZapcastLiveEvent({ streamId, title, description, status: 'ended', createdAt })
}

function normalizeStatus (status) {
  const normalized = String(status || '').trim().toLowerCase()
  if (normalized === 'live' || normalized === 'ended') return normalized
  throw new Error('Nostr live stream status must be live or ended.')
}

function normalizeRequired (value, label) {
  const normalized = String(value || '').trim()
  if (!normalized) throw new Error(label + ' is required.')
  return normalized
}

function unixNow () {
  return Math.floor(Date.now() / 1000)
}
