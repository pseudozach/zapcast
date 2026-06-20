export function runtimeArgv () {
  if (globalThis.process?.argv) return globalThis.process.argv
  if (globalThis.Bare?.argv) return globalThis.Bare.argv
  return []
}

export function isNodeCliEntrypoint (file) {
  return Boolean(globalThis.process?.argv?.[1]?.endsWith(file))
}

export function resolvePath (...parts) {
  const joined = parts.filter(Boolean).join('/')
  const normalized = joined.replaceAll('\\', '/').replace(/\/+/g, '/')
  if (normalized.startsWith('/') || /^[a-zA-Z]:\//.test(normalized)) return normalized
  const cwd = globalThis.process?.cwd?.() || globalThis.Bare?.cwd?.() || '.'
  return `${cwd.replace(/\/$/, '')}/${normalized}`
}

export function joinPath (...parts) {
  return parts.filter(Boolean).join('/').replaceAll('\\', '/').replace(/\/+/g, '/')
}

export async function fsPromises () {
  if (globalThis.Bare) {
    const mod = await import('bare-fs')
    return (mod.default || mod).promises
  }
  return import('node:fs/promises')
}

export async function subprocess () {
  if (globalThis.Bare) {
    const mod = await import('bare-subprocess')
    return mod.default || mod
  }
  return import('node:child_process')
}
