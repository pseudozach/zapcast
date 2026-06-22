import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectDirectory = dirname(dirname(fileURLToPath(import.meta.url)))
const executable = process.platform === 'win32'
  ? join(projectDirectory, 'node_modules', 'electron', 'dist', 'electron.exe')
  : process.platform === 'darwin'
    ? join(projectDirectory, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron')
    : join(projectDirectory, 'node_modules', 'electron', 'dist', 'electron')
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const child = spawn(executable, ['electron/main.cjs'], {
  cwd: projectDirectory,
  env,
  stdio: 'inherit'
})

child.once('error', err => {
  console.error(`[zapcast-desktop] failed to launch Electron: ${err.message}`)
  process.exitCode = 1
})
child.once('exit', code => {
  process.exitCode = code ?? 0
})
