export const DEFAULT_NOSTR_RELAYS = Object.freeze([
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://relay.snort.social',
  'wss://nostr.wine'
])

export function parseRelayList (value, { fallback = DEFAULT_NOSTR_RELAYS } = {}) {
  const items = Array.isArray(value)
    ? value
    : String(value || '').split(/[\s,]+/)

  const seen = new Set()
  const relays = []
  for (const item of items) {
    const relay = normalizeRelayUrl(item)
    if (!relay || seen.has(relay)) continue
    seen.add(relay)
    relays.push(relay)
  }

  return relays.length ? relays : [...fallback]
}

export function relayListText (relays = DEFAULT_NOSTR_RELAYS) {
  return parseRelayList(relays).join('\n')
}

export function normalizeRelayUrl (value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  let url
  try {
    url = new URL(raw)
  } catch {
    return ''
  }
  if (url.protocol !== 'wss:' && url.protocol !== 'ws:') return ''
  url.hash = ''
  url.search = ''
  return url.toString().replace(/\/$/, '')
}

export function nostrDiscoveryFilter ({ limit = 50 } = {}) {
  return {
    kinds: [30311],
    '#t': ['zapcast'],
    limit
  }
}
