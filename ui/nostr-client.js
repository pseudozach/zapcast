import { finalizeEvent, generateSecretKey, getPublicKey, nip19, SimplePool } from 'nostr-tools'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import { buildZapcastEndedEvent, buildZapcastLiveEvent } from '../src/nostr/event-builder.js'
import { filterLiveZapcastEvents } from '../src/nostr/parser.js'
import { nostrDiscoveryFilter, parseRelayList } from '../src/nostr/relays.js'

export function generateNostrIdentity () {
  const secret = generateSecretKey()
  const pubkey = getPublicKey(secret)
  return encodeIdentity(secret, pubkey)
}

export function identityFromSecret (value) {
  const secret = decodeSecret(value)
  const pubkey = getPublicKey(secret)
  return encodeIdentity(secret, pubkey)
}

export async function publishLiveStream ({ identity, relays, streamId, title, description }) {
  return publishEvent({
    identity,
    relays,
    template: buildZapcastLiveEvent({ streamId, title, description, status: 'live' })
  })
}

export async function publishEndedStream ({ identity, relays, streamId, title, description }) {
  return publishEvent({
    identity,
    relays,
    template: buildZapcastEndedEvent({ streamId, title, description })
  })
}

export async function discoverLiveStreams ({ relays, limit = 50, now } = {}) {
  const normalizedRelays = parseRelayList(relays)
  if (!normalizedRelays.length) throw new Error('No Nostr relays configured.')

  const pool = new SimplePool()
  try {
    const events = await pool.querySync(normalizedRelays, nostrDiscoveryFilter({ limit }), { maxWait: 5000 })
    const streams = filterLiveZapcastEvents(events, { now }).map(stream => ({
      ...stream,
      npub: stream.pubkey ? nip19.npubEncode(stream.pubkey) : ''
    }))
    return { streams, eventCount: events.length, relays: normalizedRelays }
  } finally {
    pool.destroy()
  }
}

async function publishEvent ({ identity, relays, template }) {
  const normalizedRelays = parseRelayList(relays)
  if (!normalizedRelays.length) throw new Error('No Nostr relays configured.')
  const secret = decodeSecret(identity?.secretKeyHex || identity?.nsec)
  const event = finalizeEvent(template, secret)
  const pool = new SimplePool()
  try {
    const results = await Promise.allSettled(pool.publish(normalizedRelays, event, { maxWait: 5000 }))
    const successes = []
    const failures = []
    results.forEach((result, index) => {
      const relay = normalizedRelays[index]
      if (result.status === 'fulfilled') successes.push({ relay, message: String(result.value || 'ok') })
      else failures.push({ relay, error: String(result.reason?.message || result.reason || 'publish failed') })
    })
    return { event, relays: normalizedRelays, success: successes.length, failure: failures.length, successes, failures }
  } finally {
    pool.destroy()
  }
}

function encodeIdentity (secret, pubkey) {
  const secretKeyHex = bytesToHex(secret)
  return {
    secretKeyHex,
    pubkey,
    npub: nip19.npubEncode(pubkey),
    nsec: nip19.nsecEncode(secret)
  }
}

function decodeSecret (value) {
  const raw = String(value || '').trim()
  if (!raw) throw new Error('Nostr private key is required.')
  if (raw.startsWith('nsec')) {
    const decoded = nip19.decode(raw)
    if (decoded.type !== 'nsec') throw new Error('Expected a Nostr nsec private key.')
    return decoded.data
  }
  if (!/^[0-9a-f]{64}$/i.test(raw)) throw new Error('Nostr private key must be nsec or 64-character hex.')
  return hexToBytes(raw)
}
