import { DEFAULTS } from '../config.js'
import { DEFAULT_NOSTR_RELAYS, parseRelayList } from './relays.js'
import { fsPromises, joinPath } from '../../utils/platform.js'

const NOSTR_FILE = 'nostr.json'
const HEX_32 = /^[0-9a-f]{64}$/i

export class NostrIdentityStore {
  constructor ({ directory = DEFAULTS.nostrDirectory, logger } = {}) {
    this.directory = directory
    this.logger = logger
    this.identity = null
  }

  async ready () {
    if (this.identity) return this
    const fs = await fsPromises()
    await fs.mkdir(this.directory, { recursive: true })
    this.identity = await this.read(fs)
    return this
  }

  async snapshot ({ includeSecret = false } = {}) {
    await this.ready()
    const identity = this.identity || normalizeIdentity({})
    return includeSecret ? { ...identity, hasSecret: Boolean(identity.secretKeyHex || identity.nsec) } : withoutSecret(identity)
  }

  async importKey ({ secretKeyHex, pubkey, npub, nsec } = {}) {
    await this.ready()
    const next = normalizeIdentity({
      ...this.identity,
      secretKeyHex,
      pubkey,
      npub,
      nsec,
      updatedAt: new Date().toISOString(),
      createdAt: this.identity?.createdAt || new Date().toISOString()
    })
    validateIdentity(next)
    this.identity = next
    await this.write()
    this.logger?.add('nostr_key_imported', { message: next.npub || shortKey(next.pubkey) })
    return this.snapshot({ includeSecret: true })
  }

  async updateRelays ({ relays, relayText } = {}) {
    await this.ready()
    this.identity = normalizeIdentity({
      ...this.identity,
      relays: parseRelayList(relays || relayText),
      updatedAt: new Date().toISOString()
    })
    await this.write()
    return this.snapshot()
  }

  async read (fs) {
    try {
      return normalizeIdentity(JSON.parse(await fs.readFile(joinPath(this.directory, NOSTR_FILE), 'utf8')))
    } catch (err) {
      if (err.code === 'ENOENT') return normalizeIdentity({})
      throw err
    }
  }

  async write () {
    const fs = await fsPromises()
    await fs.mkdir(this.directory, { recursive: true })
    await fs.writeFile(joinPath(this.directory, NOSTR_FILE), JSON.stringify(this.identity, null, 2), { mode: 0o600 })
  }
}

export function normalizeIdentity (identity = {}) {
  const relays = parseRelayList(identity.relays || identity.relayText || DEFAULT_NOSTR_RELAYS)
  return {
    pubkey: String(identity.pubkey || '').trim().toLowerCase(),
    npub: String(identity.npub || '').trim(),
    secretKeyHex: String(identity.secretKeyHex || '').trim().toLowerCase(),
    nsec: String(identity.nsec || '').trim(),
    relays,
    createdAt: identity.createdAt || '',
    updatedAt: identity.updatedAt || ''
  }
}

export function validateIdentity (identity) {
  if (!HEX_32.test(identity.secretKeyHex)) throw new Error('Nostr private key must be a 64-character hex key.')
  if (!HEX_32.test(identity.pubkey)) throw new Error('Nostr public key must be a 64-character hex key.')
}

function withoutSecret (identity) {
  const { secretKeyHex, nsec, ...publicIdentity } = identity
  return {
    ...publicIdentity,
    hasSecret: Boolean(secretKeyHex || nsec)
  }
}

function shortKey (value = '') {
  return value ? value.slice(0, 8) : ''
}
