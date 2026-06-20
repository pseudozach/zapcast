import crypto from 'hypercore-crypto'
import b4a from 'b4a'

export function sha256Buffer (input) {
  return crypto.hash(toBuffer(input))
}

export function sha256Hex (input) {
  return b4a.toString(sha256Buffer(input), 'hex')
}

export function deriveTopic (streamPublicKeyHex) {
  return sha256Buffer(`zapcast-live:${streamPublicKeyHex}`)
}

export function deriveControlTopic (streamPublicKeyHex) {
  return sha256Buffer(`zapcast-control:${streamPublicKeyHex}`)
}

export function generateStreamIdentity () {
  const publicKey = crypto.randomBytes(32)
  const secretKey = crypto.randomBytes(64)
  const streamPublicKeyHex = publicKey.toString('hex')
  return {
    publicKeyHex: streamPublicKeyHex,
    secretKeyHex: secretKey.toString('hex'),
    streamId: streamPublicKeyHex
  }
}

export function generateInstanceId () {
  return b4a.toString(crypto.randomBytes(6), 'hex')
}

function toBuffer (input) {
  if (typeof input === 'string') return b4a.from(input)
  return input
}

export function encodeStreamId ({ publicKeyHex, feedKeyHex }) {
  return `zc1:${publicKeyHex}:${feedKeyHex}`
}

export function parseStreamId (streamId) {
  if (!streamId) throw new Error('Missing stream ID')
  const parts = streamId.split(':')
  if (parts.length === 3 && parts[0] === 'zc1') {
    return { publicKeyHex: parts[1], feedKeyHex: parts[2] }
  }
  if (/^[a-f0-9]{64}$/i.test(streamId)) return { publicKeyHex: streamId, feedKeyHex: streamId }
  throw new Error('Invalid stream ID')
}

export function shortId (hex = '') {
  return hex ? hex.slice(0, 12) : ''
}
