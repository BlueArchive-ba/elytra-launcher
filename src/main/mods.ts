import AdmZip from 'adm-zip'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import type { InstanceRecord, ModInfo, ModScanResult } from '../shared/types'
import { gameDataDirFor, ensureGameDataDir } from './paths'

interface ModMeta {
  id: string
  name: string
  version: string
  description: string
  authors: string[]
  loader: string
  icon?: string
}

interface CacheItem {
  mtime: number
  size: number
  meta: ModMeta
  invalid: boolean
  error?: string
}

const metaCache = new Map<string, CacheItem>()

function cleanText(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value
    .replace(/§[0-9a-fk-or]/gi, '')
    .replace(/\\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function unquote(value: string): string {
  let v = value.trim()
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1)
  }
  if (v.startsWith('"""') && v.endsWith('"""')) v = v.slice(3, -3)
  if (v.startsWith("'''") && v.endsWith("'''")) v = v.slice(3, -3)
  return v.replace(/\\"/g, '"').replace(/\\n/g, ' ').trim()
}

function parseTomlValues(block: string): Record<string, string> {
  const result: Record<string, string> = {}
  const lines = block.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const match = line.match(/^\s*([A-Za-z0-9_.-]+)\s*=\s*(.*)$/)
    if (!match) continue
    const key = match[1]
    let value = match[2].trim()
    if (value.startsWith('"""') || value.startsWith("'''")) {
      const delimiter = value.slice(0, 3)
      if (value.endsWith(delimiter) && value.length > 5) {
        result[key] = unquote(value)
        continue
      }
      let rest = value.slice(3)
      while (i + 1 < lines.length && !lines[i + 1].includes(delimiter)) {
        rest += `\n${lines[++i]}`
      }
      if (i + 1 < lines.length) {
        rest += `\n${lines[++i].split(delimiter)[0]}`
      }
      result[key] = unquote(rest)
    } else if (value.startsWith('[') && !value.includes(']')) {
      while (i + 1 < lines.length && !value.includes(']')) value += ` ${lines[++i].trim()}`
      result[key] = value
    } else {
      result[key] = unquote(value)
    }
  }
  return result
}

function firstModBlock(toml: string): Record<string, string> {
  const start = toml.indexOf('[[mods]]')
  if (start < 0) return parseTomlValues(toml)
  const rest = toml.slice(start + '[[mods]]'.length)
  const next = rest.search(/^\s*\[\[/m)
  return parseTomlValues(next >= 0 ? rest.slice(0, next) : rest)
}

function parseForgeToml(text: string, neo: boolean): Partial<ModMeta> & { logoFile?: string } {
  const block = firstModBlock(text)
  const authorsRaw = block.authors ?? ''
  const authors = authorsRaw
    .replace(/^\[|\]$/g, '')
    .split(/[,;]/)
    .map((s) => unquote(s).trim())
    .filter(Boolean)
  return {
    id: block.modId ?? block.modid ?? '',
    name: block.displayName ?? block.modId ?? '',
    version: block.version ?? '',
    description: block.description ?? '',
    authors,
    loader: neo ? 'NeoForge' : 'Forge',
    logoFile: block.logoFile
  }
}

function parseMcmodInfo(text: string): Partial<ModMeta> {
  try {
    const parsed = JSON.parse(text)
    const item = Array.isArray(parsed) ? parsed[0] : parsed.modList?.[0] ?? parsed
    return {
      id: item.modid ?? item.id ?? '',
      name: item.name ?? '',
      version: item.version ?? '',
      description: item.description ?? '',
      authors: Array.isArray(item.authorList) ? item.authorList : item.author ? [item.author] : [],
      loader: 'Legacy'
    }
  } catch {
    return {}
  }
}

function iconToDataUrl(zip: AdmZip, iconPath: string | undefined): string | undefined {
  const candidates: string[] = []
  if (iconPath) {
    candidates.push(iconPath.replace(/^\/+/, ''))
    candidates.push(`assets/${iconPath}`)
  }
  candidates.push('icon.png', 'logo.png', 'assets/icon.png', 'pack.png')
  for (const candidate of candidates) {
    const entry = zip.getEntry(candidate)
    if (!entry) continue
    const data = entry.getData()
    if (!data.length || data.length > 512 * 1024) continue
    const ext = path.extname(candidate).toLowerCase()
    const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.gif' ? 'image/gif' : 'image/png'
    return `data:${mime};base64,${data.toString('base64')}`
  }
  return undefined
}

function readMeta(file: string, stat: fs.Stats): CacheItem {
  const cached = metaCache.get(file)
  if (cached && cached.mtime === stat.mtimeMs && cached.size === stat.size) return cached
  let zip: AdmZip
  try {
    zip = new AdmZip(file)
  } catch (err) {
    const item: CacheItem = {
      mtime: stat.mtimeMs,
      size: stat.size,
      invalid: true,
      error: err instanceof Error ? err.message : String(err),
      meta: { id: '', name: path.basename(file, '.jar'), version: '', description: '', authors: [], loader: 'Unknown' }
    }
    metaCache.set(file, item)
    return item
  }
  let meta: ModMeta = {
    id: '',
    name: path.basename(file, '.jar'),
    version: '',
    description: '',
    authors: [],
    loader: 'Unknown'
  }
  let icon: string | undefined
  try {
    const fabricEntry = zip.getEntry('fabric.mod.json')
    const quiltEntry = zip.getEntry('quilt.mod.json')
    const neoEntry = zip.getEntry('META-INF/neoforge.mods.toml')
    const forgeEntry = zip.getEntry('META-INF/mods.toml')
    const legacyEntry = zip.getEntry('mcmod.info')
    if (fabricEntry) {
      const json = JSON.parse(fabricEntry.getData().toString('utf8'))
      const iconField = json.icon
      const iconPath =
        typeof iconField === 'string'
          ? iconField
          : iconField && typeof iconField === 'object'
            ? Object.values(iconField as Record<string, string>).pop()
            : undefined
      meta = {
        id: String(json.id ?? ''),
        name: cleanText(json.name ?? json.id) || meta.name,
        version: String(json.version ?? ''),
        description: cleanText(json.description),
        authors: Array.isArray(json.authors)
          ? json.authors.map((a: unknown) => (typeof a === 'string' ? a : (a as { name?: string })?.name)).filter(Boolean)
          : [],
        loader: 'Fabric'
      }
      icon = iconToDataUrl(zip, iconPath)
    } else if (quiltEntry) {
      const json = JSON.parse(quiltEntry.getData().toString('utf8'))
      const q = json.quilt_loader ?? {}
      const md = q.metadata ?? {}
      const iconPath = typeof md.icon === 'string' ? md.icon : undefined
      const contributors = md.contributors ?? {}
      meta = {
        id: String(q.id ?? json.id ?? ''),
        name: cleanText(md.name ?? q.id) || meta.name,
        version: String(q.version ?? ''),
        description: cleanText(md.description),
        authors: Object.keys(contributors),
        loader: 'Quilt'
      }
      icon = iconToDataUrl(zip, iconPath)
    } else if (neoEntry || forgeEntry) {
      const neo = !!neoEntry
      const parsed = parseForgeToml((neoEntry ?? forgeEntry)!.getData().toString('utf8'), neo)
      meta = {
        ...meta,
        ...parsed,
        id: parsed.id || meta.id,
        name: cleanText(parsed.name) || meta.name,
        description: cleanText(parsed.description)
      }
      icon = iconToDataUrl(zip, parsed.logoFile)
    } else if (legacyEntry) {
      const parsed = parseMcmodInfo(legacyEntry.getData().toString('utf8'))
      meta = {
        ...meta,
        ...parsed,
        id: parsed.id || meta.id,
        name: cleanText(parsed.name) || meta.name,
        description: cleanText(parsed.description)
      }
    } else {
      const manifest = zip.getEntry('META-INF/MANIFEST.MF')
      if (manifest) {
        const text = manifest.getData().toString('utf8')
        const title = text.match(/Implementation-Title:\s*(.+)/i)?.[1]
        const version = text.match(/Implementation-Version:\s*(.+)/i)?.[1]
        if (title) meta.name = cleanText(title)
        if (version) meta.version = cleanText(version)
      }
      icon = iconToDataUrl(zip, undefined)
    }
  } catch (err) {
    const item: CacheItem = {
      mtime: stat.mtimeMs,
      size: stat.size,
      invalid: true,
      error: err instanceof Error ? err.message : String(err),
      meta
    }
    metaCache.set(file, item)
    return item
  }
  if (!meta.id) meta.id = meta.name.toLowerCase().replace(/[^a-z0-9_.-]+/g, '-')
  const item: CacheItem = { mtime: stat.mtimeMs, size: stat.size, meta: { ...meta, icon }, invalid: false }
  metaCache.set(file, item)
  return item
}

async function readDir(dir: string): Promise<{ name: string; size: number; mtime: number }[]> {
  try {
    const entries = await fsp.readdir(dir, { withFileTypes: true })
    const out: { name: string; size: number; mtime: number }[] = []
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.jar')) continue
      const stat = await fsp.stat(path.join(dir, entry.name)).catch(() => null)
      if (stat) out.push({ name: entry.name, size: stat.size, mtime: stat.mtimeMs })
    }
    return out
  } catch {
    return []
  }
}

function demoMods(instance: InstanceRecord): ModScanResult {
  const base: [string, string, string, string, string, number, boolean][] = [
    ['betterclouds', 'Better Clouds', '2.4.1', 'NeoForge', '体积云与大气散射重制。为 Crimson Depths 的夜间探索提供层次。', 4_623_104, true],
    ['forgesight', 'ForgeSight', '1.8.2', 'NeoForge', '面向 NeoForge 的渲染管线优化与着色器缓存。', 2_148_882, true],
    ['sodium', 'Sodium', '0.6.9', 'Fabric', '现代化区块渲染器，大幅降低 GPU 压力。', 1_932_421, true],
    ['iris', 'Iris Shaders', '1.8.1', 'Fabric', '光影加载器，支持 Complementary / BSL 等主流光影。', 3_841_290, true],
    ['jei', 'Just Enough Items', '19.21.0', 'NeoForge', '物品与配方查询。按 R 查看用途，按 U 查看来源。', 1_442_011, true],
    ['farmers-delight', "Farmer's Delight", '1.2.7', 'NeoForge', '扩展农业、烹饪与食物系统。', 2_910_443, true],
    ['create', 'Create', '0.5.1', 'NeoForge', '机械动力与自动化工程。', 14_281_902, true],
    ['entityculling', 'Entity Culling', '1.7.3', 'Fabric', '跳过不可见实体的渲染，提升帧率。', 412_004, true],
    ['forge-config-api-port', 'Forge Config API Port', '3.1.4', 'NeoForge', '为 NeoForge 提供旧版 Forge 配置 API。', 287_123, true],
    ['forge-config-api-port-old', 'Forge Config API Port (old)', '2.1.1', 'NeoForge', '重复的旧版本前置，建议移除。', 241_990, false],
    ['modernfix', 'ModernFix', '5.19.4', 'NeoForge', '启动与内存优化，减少样板代码开销。', 3_210_881, false]
  ]
  const mods: ModInfo[] = base.map(([id, name, version, loader, description, size, enabled], index) => ({
    fileName: `${id}-${version}${loader === 'Fabric' ? '-fabric' : '-neoforge'}.jar`,
    enabled,
    size,
    modifiedAt: Date.now() - index * 3_600_000,
    id,
    name,
    version,
    description,
    authors: ['ELYTRA Demo'],
    loader,
    duplicate: id.startsWith('forge-config-api-port'),
    invalid: false,
    priority: index + 1
  }))
  return {
    mods,
    modsDir: `${gameDataDirFor(instance)}/mods`,
    enabledCount: mods.filter((m) => m.enabled).length,
    disabledCount: mods.filter((m) => !m.enabled).length,
    duplicateIds: ['forge-config-api-port'],
    invalidCount: 0
  }
}

export class ModService {
  constructor(private demo = false) {}

  async scan(instance: InstanceRecord): Promise<ModScanResult> {
    if (this.demo) return demoMods(instance)
    const root = await ensureGameDataDir(instance)
    const modsDir = path.join(root, 'mods')
    const disabledDir = path.join(root, 'mods-disabled')
    await fsp.mkdir(modsDir, { recursive: true })
    await fsp.mkdir(disabledDir, { recursive: true })

    const [enabled, disabled] = await Promise.all([readDir(modsDir), readDir(disabledDir)])
    const orderMap = new Map(instance.modOrder.map((name, index) => [name, index]))
    const items: ModInfo[] = []

    const add = (entry: { name: string; size: number; mtime: number }, enabledFlag: boolean, base: string) => {
      const full = path.join(base, entry.name)
      const stat = fs.statSync(full)
      const cached = readMeta(full, stat)
      items.push({
        fileName: entry.name,
        enabled: enabledFlag,
        size: entry.size,
        modifiedAt: entry.mtime,
        id: cached.meta.id,
        name: cached.meta.name,
        version: cached.meta.version,
        description: cached.meta.description,
        authors: cached.meta.authors,
        loader: cached.meta.loader,
        icon: cached.meta.icon,
        duplicate: false,
        invalid: cached.invalid,
        error: cached.error,
        priority: 0
      })
    }

    for (const item of enabled) add(item, true, modsDir)
    for (const item of disabled) add(item, false, disabledDir)

    const idCount = new Map<string, number>()
    for (const mod of items) {
      if (!mod.id || mod.invalid) continue
      idCount.set(mod.id, (idCount.get(mod.id) ?? 0) + 1)
    }
    for (const mod of items) {
      if (mod.id && (idCount.get(mod.id) ?? 0) > 1) mod.duplicate = true
    }
    items.sort((a, b) => {
      const ai = orderMap.get(a.fileName)
      const bi = orderMap.get(b.fileName)
      if (ai !== undefined || bi !== undefined) return (ai ?? 99999) - (bi ?? 99999)
      if (a.enabled !== b.enabled) return a.enabled ? -1 : 1
      return a.fileName.localeCompare(b.fileName)
    })
    items.forEach((mod, index) => (mod.priority = index + 1))
    const duplicates = [...idCount.entries()].filter(([, n]) => n > 1).map(([id]) => id)
    return {
      mods: items,
      modsDir,
      enabledCount: enabled.length,
      disabledCount: disabled.length,
      duplicateIds: duplicates,
      invalidCount: items.filter((m) => m.invalid).length
    }
  }

  async toggle(instance: InstanceRecord, fileName: string, enable: boolean): Promise<ModScanResult> {
    const root = gameDataDirFor(instance)
    const from = path.join(root, enable ? 'mods-disabled' : 'mods', path.basename(fileName))
    const toDir = path.join(root, enable ? 'mods' : 'mods-disabled')
    await fsp.mkdir(toDir, { recursive: true })
    let target = path.join(toDir, path.basename(fileName))
    if (await fs.promises.access(from).then(() => true, () => false)) {
      let n = 2
      while (await fs.promises.access(target).then(() => true, () => false)) {
        target = path.join(toDir, `${path.basename(fileName, '.jar')} (${n++}).jar`)
      }
      await fsp.rename(from, target)
    }
    return this.scan(instance)
  }

  async remove(instance: InstanceRecord, fileName: string): Promise<ModScanResult> {
    const root = gameDataDirFor(instance)
    const candidates = [
      path.join(root, 'mods', path.basename(fileName)),
      path.join(root, 'mods-disabled', path.basename(fileName))
    ]
    const { shell } = await import('electron')
    for (const candidate of candidates) {
      if (await fs.promises.access(candidate).then(() => true, () => false)) {
        await shell.trashItem(candidate)
        metaCache.delete(candidate)
      }
    }
    return this.scan(instance)
  }

  async quickCounts(instance: InstanceRecord): Promise<{ mods: number; disabled: number }> {
    const root = gameDataDirFor(instance)
    const [mods, disabled] = await Promise.all([readDir(path.join(root, 'mods')), readDir(path.join(root, 'mods-disabled'))])
    return { mods: mods.length, disabled: disabled.length }
  }

  invalidate(fileName: string): void {
    metaCache.delete(fileName)
  }
}
