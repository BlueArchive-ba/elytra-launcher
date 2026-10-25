import { spawnSync } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'

const mode = process.argv[2] ?? 'nsis'
const cli = path.join(process.cwd(), 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js')
const electronDist = path.join(process.cwd(), 'node_modules', 'electron', 'dist')
const env = {
  ...process.env,
  ELECTRON_MIRROR:
    process.env.ELECTRON_MIRROR || 'https://npmmirror.com/mirrors/electron/',
  ELECTRON_BUILDER_BINARIES_MIRROR:
    process.env.ELECTRON_BUILDER_BINARIES_MIRROR ||
    'https://npmmirror.com/mirrors/electron-builder-binaries/',
  CSC_IDENTITY_AUTO_DISCOVERY: 'false'
}

function run(args) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    stdio: 'inherit',
    env
  })
  if (result.error) {
    console.error('[package] failed:', result.error)
    process.exit(1)
  }
  if (result.status !== 0) process.exit(result.status ?? 1)
}

// Build the unpacked app from the already installed Electron binary, then
// package that directory. This avoids re-downloading Electron/winCodeSign from
// GitHub on each build.
run(['--dir', `--config.electronDist=${electronDist}`])
if (mode !== 'dir') {
  run(['--win', 'nsis', '--x64', '--prepackaged', path.join('release', 'win-unpacked')])
}
