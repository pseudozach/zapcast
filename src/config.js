import { joinPath, resolvePath } from '../utils/platform.js'

export const APP_NAME = 'ZapCast'
export const APP_VERSION = '0.1.0'
export const DOMAIN = 'zapcast.live'

export const DEFAULTS = Object.freeze({
  chunkRetention: 300,
  chunkDurationSeconds: 2,
  dataDirectory: resolvePath('tmp'),
  walletDirectory: resolvePath('data', 'wallet'),
  chunkDirectory: resolvePath('tmp', 'chunks'),
  storageDirectory: resolvePath('tmp', 'corestore'),
  playbackDirectory: resolvePath('tmp', 'playback'),
  reportDirectory: resolvePath('reports', 'exports'),
  mime: 'video/mp4; codecs="avc1.42c01e,mp4a.40.2"',
  maxBroadcasterConnections: Infinity
})

export function roleDataPaths (role, instanceId) {
  const bucket = role === 'broadcaster' ? 'creator' : 'viewer'
  const baseDirectory = joinPath(DEFAULTS.dataDirectory, bucket, instanceId)
  return {
    role,
    bucket,
    instanceId,
    baseDirectory,
    storageDirectory: joinPath(baseDirectory, 'corestore'),
    chunkDirectory: joinPath(baseDirectory, 'chunks'),
    playbackDirectory: joinPath(baseDirectory, 'playback'),
    reportDirectory: joinPath(baseDirectory, 'reports')
  }
}

export function parseCliArgs (argv = []) {
  const args = {}
  for (let i = 0; i < argv.length; i++) {
    const item = argv[i]
    if (!item.startsWith('--')) continue
    const key = item.slice(2)
    const next = argv[i + 1]
    if (!next || next.startsWith('--')) {
      args[key] = true
    } else {
      args[key] = next
      i++
    }
  }

  return {
    role: args.role || 'viewer',
    denyDirectBroadcaster: toBoolean(args['deny-direct-broadcaster']),
    preferRelayPeer: args['prefer-relay-peer'] || '',
    allowPeer: listValue(args['allow-peer']),
    blockPeer: listValue(args['block-peer']),
    maxBroadcasterConnections: args['max-broadcaster-connections']
      ? Number(args['max-broadcaster-connections'])
      : DEFAULTS.maxBroadcasterConnections
  }
}

function toBoolean (value) {
  return value === true || value === 'true' || value === '1'
}

function listValue (value) {
  if (!value) return []
  return String(value).split(',').map(v => v.trim()).filter(Boolean)
}
