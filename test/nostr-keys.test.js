import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NostrIdentityStore } from '../src/nostr/keys.js'

const legacyIdentity = {
  pubkey: '1'.repeat(64),
  npub: 'npub-legacy',
  secretKeyHex: '2'.repeat(64),
  nsec: 'nsec-legacy',
  relays: ['wss://relay.example'],
  announceByDefault: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

test('slot 1 copies the legacy Nostr identity without modifying its source', async () => {
  const root = await mkdtemp(join(tmpdir(), 'zapcast-nostr-'))
  const slotDirectory = join(root, 'slots', 'slot-1')
  const source = `${JSON.stringify(legacyIdentity, null, 2)}\n`
  try {
    await writeFile(join(root, 'nostr.json'), source)
    const store = new NostrIdentityStore({ directory: slotDirectory, legacyDirectory: root, slot: 1 })
    await store.ready()

    assert.equal((await store.snapshot()).pubkey, legacyIdentity.pubkey)
    assert.equal(await readFile(join(root, 'nostr.json'), 'utf8'), source)
    assert.equal(await readFile(join(slotDirectory, 'nostr.json'), 'utf8'), source)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('later slots persist independent Nostr identities', async () => {
  const root = await mkdtemp(join(tmpdir(), 'zapcast-nostr-'))
  const slotDirectory = join(root, 'slots', 'slot-2')
  const source = `${JSON.stringify(legacyIdentity, null, 2)}\n`
  const slotIdentity = {
    secretKeyHex: '3'.repeat(64),
    pubkey: '4'.repeat(64),
    npub: 'npub-slot-2',
    nsec: 'nsec-slot-2'
  }
  try {
    await writeFile(join(root, 'nostr.json'), source)
    const store = new NostrIdentityStore({ directory: slotDirectory, legacyDirectory: root, slot: 2 })
    await store.ready()
    assert.equal((await store.snapshot()).pubkey, '')

    await store.importKey(slotIdentity)
    const reopened = new NostrIdentityStore({ directory: slotDirectory, legacyDirectory: root, slot: 2 })
    assert.equal((await reopened.snapshot()).pubkey, slotIdentity.pubkey)
    assert.notEqual((await reopened.snapshot()).pubkey, legacyIdentity.pubkey)
    assert.equal(await readFile(join(root, 'nostr.json'), 'utf8'), source)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('an existing slot identity wins over the legacy identity', async () => {
  const root = await mkdtemp(join(tmpdir(), 'zapcast-nostr-'))
  const slotDirectory = join(root, 'slots', 'slot-1')
  const existing = { ...legacyIdentity, pubkey: '5'.repeat(64), secretKeyHex: '6'.repeat(64) }
  const existingSource = `${JSON.stringify(existing, null, 2)}\n`
  try {
    await mkdir(slotDirectory, { recursive: true })
    await writeFile(join(root, 'nostr.json'), JSON.stringify(legacyIdentity))
    await writeFile(join(slotDirectory, 'nostr.json'), existingSource)

    const store = new NostrIdentityStore({ directory: slotDirectory, legacyDirectory: root, slot: 1 })
    await store.ready()
    assert.equal((await store.snapshot()).pubkey, existing.pubkey)
    assert.equal(await readFile(join(slotDirectory, 'nostr.json'), 'utf8'), existingSource)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
