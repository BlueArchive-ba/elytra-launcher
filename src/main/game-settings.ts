import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import type { ApplyGameOptionsResult, GameOptionsFile, InstanceRecord } from '../shared/types'
import { gameDataDirFor } from './paths'
import type { ConfigStore } from './store'

interface ParsedOptions {
  lines: string[]
  values: Record<string, string>
}

function parseOptions(raw: string): ParsedOptions {
  const lines = raw.split(/\r?\n/)
  const values: Record<string, string> = {}
  for (const line of lines) {
    const idx = line.indexOf(':')
    if (idx <= 0) continue
    const key = line.slice(0, idx)
    if (key.startsWith('#')) continue
    values[key] = line.slice(idx + 1)
  }
  return { lines, values }
}

function formatValue(key: string, value: string): string {
  if (['renderClouds', 'resourcePacks', 'incompatibleResourcePacks'].includes(key)) {
    const clean = value.replace(/^"+|"+$/g, '')
    return `"${clean}"`
  }
  return value
}

function mergeOptions(parsed: ParsedOptions, template: Record<string, string>): string {
  const pending = new Map(Object.entries(template))
  const output: string[] = []
  for (const line of parsed.lines) {
    const idx = line.indexOf(':')
    if (idx <= 0) {
      output.push(line)
      continue
    }
    const key = line.slice(0, idx)
    if (pending.has(key)) {
      output.push(`${key}:${formatValue(key, pending.get(key) ?? '')}`)
      pending.delete(key)
    } else {
      output.push(line)
    }
  }
  for (const [key, value] of pending) output.push(`${key}:${formatValue(key, value)}`)
  while (output.length && output[output.length - 1] === '') output.pop()
  return `${output.join('\n')}\n`
}

function optionsPath(instance: InstanceRecord): string {
  return path.join(gameDataDirFor(instance), 'options.txt')
}

export class GameSettingsService {
  constructor(private store: ConfigStore) {}

  private find(id: string): InstanceRecord {
    const instance = this.store.get().instances.find((item) => item.id === id)
    if (!instance) throw new Error('实例不存在')
    return instance
  }

  async read(instanceId: string): Promise<GameOptionsFile> {
    const instance = this.find(instanceId)
    const file = optionsPath(instance)
    if (!fs.existsSync(file)) return { instanceId, path: file, exists: false, values: {} }
    const raw = await fsp.readFile(file, 'utf8').catch(() => '')
    return { instanceId, path: file, exists: true, values: parseOptions(raw).values }
  }

  /**
   * Applies the unified template when a version is created/imported. Existing
   * instances are never touched by this method.
   */
  async applyDefaults(instance: InstanceRecord): Promise<boolean> {
    const template = this.store.gameOptions()
    if (!Object.keys(template).length) return false
    const file = optionsPath(instance)
    await fsp.mkdir(path.dirname(file), { recursive: true })
    const parsed = fs.existsSync(file)
      ? parseOptions(await fsp.readFile(file, 'utf8').catch(() => ''))
      : { lines: [], values: {} }
    await fsp.writeFile(file, mergeOptions(parsed, template), 'utf8')
    return true
  }

  /**
   * First launch of an instance created before the template was saved still
   * counts as a new download. Existing versions normally already have
   * options.txt, so they remain untouched.
   */
  async applyIfMissing(instance: InstanceRecord): Promise<boolean> {
    if (instance.lastPlayedAt || this.store.get().lastLaunches?.[instance.id]) return false
    const file = optionsPath(instance)
    if (fs.existsSync(file)) return false
    return this.applyDefaults(instance)
  }

  async applyExisting(instanceIds: string[]): Promise<ApplyGameOptionsResult> {
    const template = this.store.gameOptions()
    const result: ApplyGameOptionsResult = { applied: 0, failed: [] }
    if (!Object.keys(template).length) return result
    for (const id of [...new Set(instanceIds)]) {
      try {
        const instance = this.find(id)
        const file = optionsPath(instance)
        await fsp.mkdir(path.dirname(file), { recursive: true })
        const exists = fs.existsSync(file)
        const parsed = exists
          ? parseOptions(await fsp.readFile(file, 'utf8').catch(() => ''))
          : { lines: [], values: {} }
        if (exists) {
          const backup = `${file}.ember-backup-${new Date().toISOString().replace(/[:.]/g, '-')}`
          await fsp.copyFile(file, backup).catch(() => undefined)
        }
        await fsp.writeFile(file, mergeOptions(parsed, template), 'utf8')
        result.applied++
      } catch (err) {
        let name = id
        try {
          name = this.find(id).name
        } catch {
          /* removed */
        }
        result.failed.push({ instanceId: id, name, error: err instanceof Error ? err.message : String(err) })
      }
    }
    return result
  }
}
