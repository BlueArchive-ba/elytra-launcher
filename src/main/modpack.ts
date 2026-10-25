import fsp from 'node:fs/promises'
import path from 'node:path'
import http from 'node:http'
import { AddressInfo } from 'node:net'
import type { InstanceRecord, LoaderSpec, LoaderType, ModpackInfo, ModpackRef } from '../shared/types'
import { gameDataDirFor } from './paths'

const MAX_MANIFEST_BYTES = 12 * 1024 * 1024
const VALID_LOADERS: LoaderType[] = ['vanilla', 'forge', 'neoforge', 'fabric', 'quilt']
const CFWIDGET = 'https://api.cfwidget.com'
const USER_AGENT = 'ELYTRA/1.1 (modpack importer)'

interface ManifestFile {
  path: string
  url: string
  sha1?: string
  size?: number
  type?: string
}

interface CurseForgeFile {
  projectID: number
  fileID: number
  required?: boolean
  isLocked?: boolean
}

interface RawManifest {
  name?: string
  version?: string
  minecraftVersion?: string
  loader?: string
  loaderVersion?: string
  minecraft?: {
    version?: string
    loader?: { loader?: string; version?: string } | string
    modLoaders?: { id?: string; primary?: boolean }[]
    recommendedRam?: number
  }
  manifestType?: string
  overrides?: string
  files?: (ManifestFile & Partial<CurseForgeFile>)[]
  elytraFiles?: { fileName: string; name?: string; version?: string; size?: number; sha1?: string }[]
}

interface CfwidgetProject {
  id: number
  title?: string
  type?: string
  files?: {
    id: number
    name?: string
    display?: string
    filesize?: number
    versions?: string[]
    type?: string
  }[]
}

type ModpackFormat = 'eml' | 'curseforge' | 'elytra'

function safeRelative(p: string): boolean {
  if (!p || p.includes('\0')) return false
  const normalized = p.replace(/\\/g, '/')
  if (normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) return false
  return !normalized.split('/').some((part) => part === '..')
}

function normalizeLoader(raw: unknown, version?: unknown): LoaderSpec | undefined {
  if (raw && typeof raw === 'object') {
    const obj = raw as { loader?: unknown; type?: unknown; version?: unknown }
    const type = String(obj.loader ?? obj.type ?? '').toLowerCase()
    if (VALID_LOADERS.includes(type as LoaderType)) {
      return { type: type as LoaderType, version: String(obj.version ?? version ?? '') }
    }
  }
  if (typeof raw === 'string') {
    const type = raw.toLowerCase()
    if (VALID_LOADERS.includes(type as LoaderType)) {
      return { type: type as LoaderType, version: String(version ?? '') }
    }
  }
  return undefined
}

function parseLoaderId(id: unknown): LoaderSpec | undefined {
  const match = /^(forge|neoforge|fabric|quilt)(?:[-_ ](.+))?$/i.exec(String(id ?? '').trim())
  if (!match) return undefined
  return { type: match[1].toLowerCase() as LoaderType, version: String(match[2] ?? '') }
}

function formatOf(raw: RawManifest): ModpackFormat {
  const hasCurseForgeIds =
    Array.isArray(raw.files) && raw.files.some((file) => Number(file?.projectID) > 0 && Number(file?.fileID) > 0)
  if (!hasCurseForgeIds && Array.isArray(raw.elytraFiles) && raw.elytraFiles.length) return 'elytra'
  if (/minecraftmodpack/i.test(String(raw.manifestType ?? ''))) return 'curseforge'
  if (hasCurseForgeIds) return 'curseforge'
  return 'eml'
}

function cfContentDir(type: unknown): string {
  const value = String(type ?? '').toLowerCase()
  if (value.includes('texture') || value.includes('resource')) return 'resourcepacks'
  if (value.includes('shader')) return 'shaderpacks'
  return 'mods'
}

function cfCdnUrl(fileID: number, fileName: string): string {
  const id = String(fileID)
  const encoded = encodeURIComponent(fileName).replace(/%2F/gi, '/')
  return `https://mediafilez.forgecdn.net/files/${id.slice(0, 4)}/${id.slice(4)}/${encoded}`
}

function refKey(ref: ModpackRef): string {
  return ref.kind === 'local' ? `local:${ref.localPath ?? ''}` : `url:${ref.url ?? ''}`
}

export class ModpackService {
  private servers = new Map<string, { url: string; server: http.Server }>()
  private cfProjects = new Map<number, CfwidgetProject>()
  private normalized = new Map<string, string>()

  private async readRaw(ref: ModpackRef): Promise<RawManifest> {
    if (ref.kind === 'local') {
      if (!ref.localPath) throw new Error('没有选择本地清单文件')
      const stat = await fsp.stat(ref.localPath)
      if (stat.size > MAX_MANIFEST_BYTES) throw new Error('清单文件过大（超过 12 MB）')
      return JSON.parse(await fsp.readFile(ref.localPath, 'utf8')) as RawManifest
    }
    if (!ref.url || !/^https?:\/\//i.test(ref.url)) throw new Error('清单 URL 需要以 http:// 或 https:// 开头')
    const res = await fetch(ref.url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(30_000)
    })
    if (!res.ok) throw new Error(`清单请求失败：HTTP ${res.status}`)
    const body = await res.text()
    if (Buffer.byteLength(body) > MAX_MANIFEST_BYTES) throw new Error('清单文件过大（超过 12 MB）')
    return JSON.parse(body) as RawManifest
  }

  private fallbackName(ref: ModpackRef): string {
    if (ref.name) return ref.name
    if (ref.kind === 'local' && ref.localPath) return path.basename(path.dirname(ref.localPath))
    return decodeURIComponent(new URL(ref.url ?? 'https://example.invalid/manifest.json').pathname.split('/').pop() ?? '整合包').replace(/\.json$/i, '')
  }

  async inspect(ref: ModpackRef): Promise<ModpackInfo> {
    const raw = await this.readRaw(ref)
    const format = formatOf(raw)
    const fallbackName = this.fallbackName(ref)
    const warnings: string[] = []

    if (format === 'elytra') {
      const pending = raw.elytraFiles ?? []
      const minecraftVersion = raw.minecraft?.version
      const loaderRaw =
        raw.minecraft?.modLoaders?.find((loader) => loader.primary)?.id ??
        raw.minecraft?.modLoaders?.[0]?.id
      const suggestedLoader = parseLoaderId(loaderRaw)
      if (!minecraftVersion) warnings.push('ELYTRA 清单没有指定 Minecraft 版本')
      if (!suggestedLoader) warnings.push('ELYTRA 清单没有识别到加载器，请手动选择')
      warnings.push('这是 ELYTRA 导出的模组清单：只保存了模组元数据，不包含下载地址')
      warnings.push('导入会创建实例并保存待恢复清单；请从完整整合包 ZIP 的 overrides/mods 或模组库恢复文件')
      return {
        source: { ...ref, name: (raw.name || fallbackName || '整合包').trim() },
        name: (raw.name || fallbackName || '整合包').trim(),
        format,
        fileCount: pending.length,
        totalSize: pending.reduce((sum, file) => sum + (Number(file.size) || 0), 0),
        hosts: [],
        warnings,
        valid: !!minecraftVersion && !!suggestedLoader,
        suggestedMcVersion: minecraftVersion,
        suggestedLoader,
        recommendedRam: Number(raw.minecraft?.recommendedRam) || undefined,
        pendingFiles: pending
      }
    }

    if (format === 'curseforge') {
      const files = (raw.files ?? []).filter((file) => Number(file.projectID) > 0 && Number(file.fileID) > 0)
      const minecraftVersion = raw.minecraft?.version
      const loaderRaw =
        raw.minecraft?.modLoaders?.find((loader) => loader.primary)?.id ??
        raw.minecraft?.modLoaders?.[0]?.id
      const suggestedLoader = parseLoaderId(loaderRaw)
      if (!files.length) warnings.push('CurseForge 清单没有可用的 projectID/fileID 条目')
      if (!minecraftVersion) warnings.push('CurseForge 清单没有指定 Minecraft 版本')
      if (!suggestedLoader) warnings.push('CurseForge 清单没有识别到加载器，请手动选择')
      warnings.push('CurseForge 文件将在首次启动时通过项目文件索引解析，文件较多时需要等待')
      return {
        source: { ...ref, name: (raw.name || fallbackName || '整合包').trim() },
        name: (raw.name || fallbackName || '整合包').trim(),
        format,
        fileCount: files.length,
        totalSize: 0,
        hosts: ['mediafilez.forgecdn.net', 'api.cfwidget.com'],
        warnings,
        valid: files.length > 0 && !!minecraftVersion && !!suggestedLoader,
        suggestedMcVersion: minecraftVersion,
        suggestedLoader,
        recommendedRam: Number(raw.minecraft?.recommendedRam) || undefined
      }
    }

    const files = Array.isArray(raw.files) ? raw.files : []
    if (!files.length) warnings.push('清单中没有 files 数组或文件数量为 0，EML 将不会下载任何整合包内容')
    let totalSize = 0
    const hosts = new Set<string>()
    let unsafe = 0
    for (const file of files) {
      if (!file || typeof file.url !== 'string' || !/^https?:\/\//i.test(file.url)) {
        unsafe++
        continue
      }
      if (!safeRelative(file.path)) {
        unsafe++
        continue
      }
      try {
        hosts.add(new URL(file.url).host)
      } catch {
        unsafe++
      }
      totalSize += Number(file.size) || 0
    }
    if (unsafe) warnings.push(`${unsafe} 个文件条目缺少合法 URL 或包含不安全的相对路径`)
    const minecraftVersion =
      raw.minecraftVersion ??
      raw.minecraft?.version ??
      (typeof raw.minecraft === 'string' ? raw.minecraft : undefined)
    const loaderRaw =
      raw.loader ??
      (raw.minecraft && typeof raw.minecraft === 'object' ? raw.minecraft.loader : undefined)
    const suggestedLoader = normalizeLoader(loaderRaw, raw.loaderVersion)
    const name = (raw.name || fallbackName || '整合包').trim()
    return {
      source: { ...ref, name },
      name,
      format,
      fileCount: files.length,
      totalSize,
      hosts: [...hosts].slice(0, 8),
      warnings,
      valid: files.length > 0 && unsafe === 0,
      suggestedMcVersion: minecraftVersion,
      suggestedLoader
    }
  }

  private async cfProject(projectID: number, attempt = 0): Promise<CfwidgetProject> {
    const cached = this.cfProjects.get(projectID)
    if (cached) return cached
    const res = await fetch(`${CFWIDGET}/${projectID}`, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(30_000)
    })
    if (res.status === 429 && attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)))
      return this.cfProject(projectID, attempt + 1)
    }
    if (!res.ok) throw new Error(`CurseForge 项目 ${projectID} 查询失败：HTTP ${res.status}`)
    const data = (await res.json()) as CfwidgetProject
    if (!data || !Array.isArray(data.files)) throw new Error(`CurseForge 项目 ${projectID} 没有文件索引`)
    this.cfProjects.set(projectID, data)
    return data
  }

  private async buildCurseForgeManifest(raw: RawManifest): Promise<string> {
    const entries = (raw.files ?? []).filter((file) => Number(file.projectID) > 0 && Number(file.fileID) > 0)
    if (!entries.length) throw new Error('CurseForge 清单没有可下载文件')
    const resolved = new Array<{
      name: string
      path: string
      url: string
      size: number
      curseforgeProjectID: number
      curseforgeFileID: number
    } | null>(entries.length)
    const errors: string[] = []
    let cursor = 0
    let done = 0
    const workers = 6
    await Promise.all(
      Array.from({ length: workers }, async () => {
        while (cursor < entries.length) {
          const index = cursor++
          const entry = entries[index]
          try {
            const project = await this.cfProject(Number(entry.projectID))
            let file = project.files?.find((item) => Number(item.id) === Number(entry.fileID))
            if (!file) {
              const fallback =
                project.files?.find((item) => item.versions?.includes(raw.minecraft?.version ?? '')) ??
                project.files?.[0]
              if (!fallback) throw new Error(`文件 ${entry.fileID} 不在项目文件索引中，且没有可用替代文件`)
              console.log(
                `[modpack] 项目 ${entry.projectID} 缺少文件 ${entry.fileID}，使用可用版本 ${fallback.id}：${fallback.name ?? fallback.display ?? ''}`
              )
              file = fallback
            }
            const name = path.basename(String(file.name || file.display || `file-${entry.fileID}.jar`))
            const dir = cfContentDir(project.type)
            if (!safeRelative(name)) throw new Error(`文件名不安全：${name}`)
            resolved[index] = {
              name,
              path: `${dir}/`,
              url: cfCdnUrl(Number(file.id), name),
              size: Number(file.filesize) || 0,
              curseforgeProjectID: Number(entry.projectID),
              curseforgeFileID: Number(file.id)
            }
          } catch (err) {
            errors.push(`项目 ${entry.projectID} / 文件 ${entry.fileID}：${err instanceof Error ? err.message : String(err)}`)
          }
          done++
          if (done % 10 === 0) console.log(`[modpack] CurseForge 文件解析 ${done}/${entries.length}`)
        }
      })
    )
    if (errors.length) {
      throw new Error(`CurseForge 文件解析失败（${errors.length} 个）：${errors.slice(0, 4).join('；')}`)
    }
    const files = resolved.filter((file): file is NonNullable<(typeof resolved)[number]> => !!file)
    const seen = new Set<string>()
    const unique = files
      .filter((file) => (seen.has(`${file.path}${file.name}`) ? false : (seen.add(`${file.path}${file.name}`), true)))
      .map((file) => ({ ...file, type: 'MOD' }))
    console.log(`[modpack] CurseForge 清单解析完成：${unique.length} 个文件`)
    return JSON.stringify({
      name: raw.name,
      version: raw.version,
      minecraftVersion: raw.minecraft?.version,
      files: unique
    })
  }

  private async serveJson(key: string, content: string): Promise<string> {
    const existing = this.servers.get(key)
    if (existing) return existing.url
    const server = http.createServer((req, res) => {
      if (req.method !== 'GET' || !req.url?.startsWith('/manifest')) {
        res.writeHead(404, { 'content-type': 'application/json' })
        res.end('{"error":"not found"}')
        return
      }
      const data = Buffer.from(content, 'utf8')
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': data.length,
        'cache-control': 'no-store'
      })
      res.end(data)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address() as AddressInfo
    const url = `http://127.0.0.1:${address.port}/manifest.json`
    this.servers.set(key, { url, server })
    return url
  }

  async manifestUrl(ref: ModpackRef, cacheDir?: string): Promise<string | undefined> {
    const raw = await this.readRaw(ref)
    const format = formatOf(raw)
    if (format === 'eml') {
      if (ref.kind === 'url') return ref.url
      if (!ref.localPath) return undefined
      return this.serveJson(refKey(ref), await fsp.readFile(ref.localPath, 'utf8'))
    }
    const key = refKey(ref)
    let content = this.normalized.get(key)
    if (!content && cacheDir) {
      const cacheFile = path.join(cacheDir, '.elytra-modpack-manifest.json')
      const cached = await fsp.readFile(cacheFile, 'utf8').catch(() => '')
      if (cached) {
        try {
          const parsed = JSON.parse(cached) as {
            files?: { name?: string; path?: string; url?: string; curseforgeProjectID?: number; curseforgeFileID?: number }[]
          }
          if (
            parsed.files?.length &&
            parsed.files.every(
              (file) => !!file.name && !!file.path && !!file.url && !!file.curseforgeProjectID && !!file.curseforgeFileID
            )
          ) {
            content = cached
            this.normalized.set(key, content)
          }
        } catch {
          /* stale cache */
        }
      }
    }
    if (!content) {
      content = await this.buildCurseForgeManifest(raw)
      this.normalized.set(key, content)
      if (cacheDir) {
        await fsp.mkdir(cacheDir, { recursive: true })
        await fsp.writeFile(path.join(cacheDir, '.elytra-modpack-manifest.json'), content, 'utf8').catch(() => undefined)
      }
    }
    return this.serveJson(key, content)
  }

  async prepare(instance: InstanceRecord): Promise<void> {
    if (!instance.modpack || instance.modpack.kind !== 'local' || !instance.modpack.localPath) return
    const raw = await this.readRaw(instance.modpack)
    const base = path.dirname(instance.modpack.localPath)
    const overrideName = (raw.overrides || 'overrides').replace(/\\/g, '/')
    if (!safeRelative(overrideName)) return
    const source = path.join(base, overrideName)
    if (!(await fsp.stat(source).catch(() => null))?.isDirectory()) return
    const target = gameDataDirFor(instance)
    await fsp.mkdir(target, { recursive: true })
    for (const entry of await fsp.readdir(source)) {
      await fsp.cp(path.join(source, entry), path.join(target, entry), { recursive: true, force: true })
    }
    console.log(`[modpack] 已复制 overrides：${source}`)
  }

  dispose(): void {
    for (const { server } of this.servers.values()) {
      try {
        server.close()
      } catch {
      }
    }
    this.servers.clear()
    this.normalized.clear()
  }
}
