import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const runtimePath = join(root, 'node_modules', 'pear-electron', 'runtime.js')
const expected = "argv = ['run', '--rti', info, ...argv]"
const directAssetSpawn = "sp = spawn(this.bin, argv, options)"
const macAssetSpawn = "sp = isMac ? spawn('open', [this.bin.slice(0, this.bin.indexOf('.app') + 4), '--args', ...argv], options) : spawn(this.bin, argv, options)"
const inheritedEnv = "...{ env: { ...env, NODE_PRESERVE_SYMLINKS: 1 } }"
const cleanedEnv = "env: spawnEnv"
const optionsMarker = 'const options = {'

let source = await readFile(runtimePath, 'utf8')

if (source.includes(expected)) {
  console.log('[zapcast-postinstall] pear-electron runtime argv is unchanged')
} else if (source.includes("argv = ['--rti', info, ...argv]")) {
  source = source.replace("argv = ['--rti', info, ...argv]", expected)
  console.log('[zapcast-postinstall] restored pear-electron runtime argv')
} else {
  throw new Error('pear-electron runtime argv line not found; inspect node_modules/pear-electron/runtime.js')
}

if (source.includes(macAssetSpawn)) {
  source = source.replace(macAssetSpawn, directAssetSpawn)
  console.log('[zapcast-postinstall] restored pear-electron direct asset spawn')
} else if (source.includes(directAssetSpawn)) {
  console.log('[zapcast-postinstall] pear-electron direct asset spawn is unchanged')
} else {
  throw new Error('pear-electron asset spawn line not found; inspect node_modules/pear-electron/runtime.js')
}

if (source.includes(cleanedEnv)) {
  console.log('[zapcast-postinstall] pear-electron environment patch already applied')
} else if (source.includes(inheritedEnv)) {
  source = source
    .replace(optionsMarker, "const spawnEnv = { ...env, NODE_PRESERVE_SYMLINKS: 1 }\n    delete spawnEnv.ELECTRON_RUN_AS_NODE\n\n    const options = {")
    .replace(inheritedEnv, cleanedEnv)
  console.log('[zapcast-postinstall] patched pear-electron child environment')
} else {
  throw new Error('pear-electron child environment line not found; inspect node_modules/pear-electron/runtime.js')
}

await writeFile(runtimePath, source)
