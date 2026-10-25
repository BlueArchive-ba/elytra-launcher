import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const remove = (target) => {
  const resolved = path.resolve(root, target)
  if (!resolved.startsWith(root)) throw new Error(`unsafe clean target: ${target}`)
  fs.rmSync(resolved, { recursive: true, force: true })
}

for (const name of fs.readdirSync(root)) {
  if (name.startsWith('.tmp-')) remove(name)
  if (/\.log$/i.test(name) && name !== 'clean.log' && !name.startsWith('README')) remove(name)
}
for (const name of fs.readdirSync(root)) {
  if (/^release-v\d+$/i.test(name)) remove(name)
}

remove('builder-debug.yml')
remove('release/win-unpacked/screenshots')
const assets = path.join(root, 'out', 'renderer', 'assets')
if (fs.existsSync(assets)) {
  for (const name of fs.readdirSync(assets)) {
    if (name.endsWith('.map')) remove(path.join('out', 'renderer', 'assets', name))
  }
}

console.log('cleaned build artifacts and temporary files')
