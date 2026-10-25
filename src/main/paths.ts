import { app } from 'electron'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import type { InstanceRecord } from '../shared/types'
import { resolveLaunchMode } from '../shared/utils'

export const EML_ROOT = 'ember'

export function defaultGameDir(slug: string): string {
  // Match EML's getAppDataFolder() so the derived path is identical.
  const base =
    process.platform === 'linux'
      ? process.env.HOME || app.getPath('home')
      : app.getPath('appData')
  const serverFolder = path.join(base, process.platform === 'darwin' ? EML_ROOT : `.${EML_ROOT}`)
  return path.join(serverFolder, slug)
}

export function gameDirFor(instance: InstanceRecord): string {
  return instance.customDir ? path.resolve(instance.customDir) : defaultGameDir(instance.slug)
}

/**
 * The folder Minecraft actually uses as its working/game directory.
 *
 * PCL's version isolation puts mods, config and saves in
 * `versions/<version-id>`, while assets/libraries stay under `.minecraft`.
 * The EML path must keep its own root, so the two concepts are separate.
 */
export function gameDataDirFor(instance: InstanceRecord): string {
  if (resolveLaunchMode(instance) === 'local' && instance.localVersionDir) {
    if (instance.localIsolated === false) {
      return instance.localGameRoot ? path.resolve(instance.localGameRoot) : gameDirFor(instance)
    }
    return path.resolve(instance.localVersionDir)
  }
  return gameDirFor(instance)
}

export async function ensureGameDataDir(instance: InstanceRecord): Promise<string> {
  const dir = gameDataDirFor(instance)
  await fsp.mkdir(dir, { recursive: true })
  return dir
}

export function instanceLinkPath(instance: InstanceRecord): string {
  return defaultGameDir(instance.slug)
}

export async function pathExists(target: string): Promise<boolean> {
  try {
    await fsp.access(target)
    return true
  } catch {
    return false
  }
}

async function isJunction(target: string): Promise<boolean> {
  try {
    const stat = await fsp.lstat(target)
    return stat.isSymbolicLink()
  } catch {
    return false
  }
}

/**
 * EML always derives its instance path from appData / .ember / slug. For a
 * custom instance directory we keep that path as a directory junction, so all
 * of EML's file operations transparently land in the user's chosen folder.
 */
export async function ensureInstanceDirectory(instance: InstanceRecord): Promise<string> {
  if (!instance.customDir) {
    const dir = defaultGameDir(instance.slug)
    await fsp.mkdir(dir, { recursive: true })
    return dir
  }
  const target = path.resolve(instance.customDir)
  const link = defaultGameDir(instance.slug)
  await fsp.mkdir(target, { recursive: true })
  await fsp.mkdir(path.dirname(link), { recursive: true })

  if (await pathExists(link)) {
    if (await isJunction(link)) {
      const real = await fsp.realpath(link).catch(() => '')
      if (real && path.resolve(real) === target) return link
      await fsp.unlink(link)
    } else {
      const entries = await fsp.readdir(link).catch(() => [])
      if (entries.length === 0) {
        await fsp.rmdir(link)
      } else {
        // Keep using the real folder instead of destroying data.
        console.warn('[paths] custom dir link exists as a real folder, leaving as-is:', link)
        return link
      }
    }
  }
  try {
    await fsp.symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir')
  } catch (err) {
    console.error('[paths] failed to create instance junction:', err)
    throw new Error(`无法创建实例目录联接：${err instanceof Error ? err.message : String(err)}`)
  }
  return link
}

export async function directorySize(dir: string, limit = 120_000): Promise<number> {
  let total = 0
  let seen = 0
  const stack = [dir]
  while (stack.length && seen < limit) {
    const current = stack.pop()!
    let entries: fs.Dirent[]
    try {
      entries = await fsp.readdir(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name)
      try {
        if (entry.isDirectory()) stack.push(full)
        else if (entry.isFile()) {
          const stat = await fsp.stat(full)
          total += stat.size
          seen++
        }
      } catch {
      }
    }
  }
  return total
}

export async function moveDirectoryContents(from: string, to: string): Promise<void> {
  if (path.resolve(from) === path.resolve(to)) return
  await fsp.mkdir(to, { recursive: true })
  const entries = await fsp.readdir(from, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    const source = path.join(from, entry.name)
    const dest = path.join(to, entry.name)
    try {
      await fsp.rename(source, dest)
    } catch {
      await fsp.cp(source, dest, { recursive: true, force: true })
      await fsp.rm(source, { recursive: true, force: true })
    }
  }
}

export function isSubPath(parent: string, child: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child))
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel)
}
