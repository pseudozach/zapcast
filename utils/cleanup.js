import { DEFAULTS } from '../src/config.js'
import { fsPromises, joinPath } from './platform.js'

export async function cleanupInstanceData (pathsByRole = {}) {
  const fs = await fsPromises()
  const roots = Object.values(pathsByRole)
    .map(paths => paths?.baseDirectory)
    .filter(Boolean)

  for (const directory of roots) {
    if (!isInsideTempRoot(directory)) continue
    await fs.rm(directory, { recursive: true, force: true }).catch(() => {})
  }

  await removeEmptyDirectory(joinPath(DEFAULTS.dataDirectory, 'creator'))
  await removeEmptyDirectory(joinPath(DEFAULTS.dataDirectory, 'viewer'))
  await removeEmptyDirectory(DEFAULTS.dataDirectory)
}

function isInsideTempRoot (directory) {
  const root = `${DEFAULTS.dataDirectory.replace(/\/$/, '')}/`
  return directory.startsWith(root)
}

async function removeEmptyDirectory (directory) {
  const fs = await fsPromises()
  try {
    await fs.rmdir(directory)
  } catch {}
}
