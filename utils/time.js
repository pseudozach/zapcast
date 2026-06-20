export function nowIso () {
  return new Date().toISOString()
}

export function uptimeSeconds (startedAt) {
  return Math.max(0, Math.round((Date.now() - startedAt) / 1000))
}

export function elapsedMs (startedAt) {
  return Math.max(0, Date.now() - startedAt)
}
