import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type {
  InstanceRecord,
  ModrinthContentType,
  ModrinthDownloadResult,
  ModrinthGameVersionTag,
  ModrinthLoaderTag,
  ModrinthReleaseType,
  ModrinthSearchFilters,
  ModrinthSearchHit,
  ModrinthSearchResult,
  ModrinthTags,
  ModrinthUpdate,
  ModrinthVersion,
  ModrinthVersionFile
} from '../shared/types'
import { gameDataDirFor } from './paths'
import type { ConfigStore } from './store'

const API = 'https://api.modrinth.com/v3'
const USER_AGENT = 'ELYTRA/1.0 (local Minecraft launcher; contact: local)'
const MANIFEST = '.ember-modrinth.json'

interface ManifestEntry {
  fileName: string
  projectId: string
  slug: string
  title: string
  kind: ModrinthContentType
  versionId: string
  versionNumber: string
  versionType: ModrinthReleaseType
  gameVersions: string[]
  loaders: string[]
  downloadedAt: number
}

interface Manifest {
  version: 1
  downloads: Record<string, ManifestEntry>
}

interface CacheEntry<T> {
  at: number
  value: T
}

interface RawSearchHit {
  project_id: string
  slug: string
  name?: string
  title?: string
  summary?: string
  description?: string
  project_type?: string
  project_types?: string[]
  icon_url?: string
  downloads?: number
  follows?: number
  categories?: string[]
  display_categories?: string[]
  versions?: string[]
  game_versions?: string[]
  latest_version?: string
  version_id?: string
  date_modified?: string
  author?: string
  gallery?: string[]
}

function normalizeHit(raw: RawSearchHit, fallbackType: ModrinthContentType): ModrinthSearchHit {
  return {
    project_id: raw.project_id,
    slug: raw.slug,
    title: raw.name ?? raw.title ?? raw.slug,
    description: raw.summary ?? raw.description ?? '',
    project_type: normalizeType(raw.project_types?.[0] ?? raw.project_type ?? fallbackType),
    icon_url: raw.icon_url,
    downloads: Number(raw.downloads ?? 0),
    follows: Number(raw.follows ?? 0),
    categories: Array.from(new Set(raw.display_categories?.length ? raw.display_categories : raw.categories ?? [])),
    versions: raw.game_versions ?? raw.versions ?? [],
    latest_version: raw.version_id ?? raw.latest_version,
    date_modified: raw.date_modified ?? '',
    author: raw.author,
    gallery: raw.gallery
  }
}

export interface ModrinthProgress {
  phase: 'download'
  fileName: string
  received: number
  total: number
  percent: number
  speed: number
  threads: number
}

function contentTypeDir(kind: ModrinthContentType): string {
  if (kind === 'shader') return 'shaderpacks'
  if (kind === 'resourcepack') return 'resourcepacks'
  return 'mods'
}

function normalizeType(value: string): ModrinthContentType {
  return value === 'shader' || value === 'resourcepack' ? value : 'mod'
}

export class ModrinthService {
  private tagsCache: CacheEntry<ModrinthTags> | null = null
  private versionCache = new Map<string, CacheEntry<ModrinthVersion[]>>()

  constructor(private store: ConfigStore) {}

  private instance(id: string): InstanceRecord {
    const found = this.store.get().instances.find((item) => item.id === id)
    if (!found) throw new Error('实例不存在')
    return found
  }

  private async api<T>(route: string, params?: Record<string, string>, ms = 25_000): Promise<T> {
    const url = new URL(`${API}${route}`)
    for (const [key, value] of Object.entries(params ?? {})) url.searchParams.set(key, value)
    return this.fetchUrl<T>(url.toString(), ms)
  }

  private async fetchUrl<T>(raw: string, ms = 25_000): Promise<T> {
    const response = await fetch(raw, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(ms)
    })
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`Modrinth HTTP ${response.status}: ${body.slice(0, 180)}`)
    }
    return (await response.json()) as T
  }

  async tags(): Promise<ModrinthTags> {
    if (this.tagsCache && Date.now() - this.tagsCache.at < 6 * 3600_000) return this.tagsCache.value
    const [loaders, gameVersions] = await Promise.all([
      this.api<ModrinthLoaderTag[]>('/tag/loader'),
      // The v3 deployment currently omits /tag/game_version; the public v2
      // tag endpoint returns the exact same game-version metadata and needs no key.
      this.fetchUrl<ModrinthGameVersionTag[]>('https://api.modrinth.com/v2/tag/game_version')
    ])
    const value: ModrinthTags = {
      loaders: loaders.filter((item) => item.supported_project_types?.includes('mod')),
      gameVersions: gameVersions.sort((a, b) => b.date.localeCompare(a.date))
    }
    this.tagsCache = { at: Date.now(), value }
    return value
  }

  async versions(
    projectId: string,
    filters: { loader?: string; gameVersion?: string; releaseType?: ModrinthReleaseType }
  ): Promise<ModrinthVersion[]> {
    const key = `${projectId}:${filters.loader ?? ''}`
    const cached = this.versionCache.get(key)
    if (!cached || Date.now() - cached.at > 180_000) {
      const params: Record<string, string> = {}
      if (filters.loader) params.loaders = JSON.stringify([filters.loader])
      if (filters.gameVersion) params.game_versions = JSON.stringify([filters.gameVersion])
      const list = await this.api<ModrinthVersion[]>(`/project/${encodeURIComponent(projectId)}/version`, params)
      this.versionCache.set(key, { at: Date.now(), value: list })
    }
    let list = this.versionCache.get(key)?.value ?? []
    if (filters.loader) list = list.filter((version) => version.loaders?.includes(filters.loader!))
    if (filters.gameVersion) list = list.filter((version) => version.game_versions?.includes(filters.gameVersion!))
    if (filters.releaseType) list = list.filter((version) => version.version_type === filters.releaseType)
    return list
      .slice()
      .sort((a, b) => b.date_published.localeCompare(a.date_published))
  }

  private async filterByRelease(hits: ModrinthSearchHit[], filters: ModrinthSearchFilters): Promise<ModrinthSearchHit[]> {
    if (!filters.releaseType) return hits
    const filtered: ModrinthSearchHit[] = []
    const workers = 5
    let index = 0
    await Promise.all(
      Array.from({ length: workers }, async () => {
        while (index < hits.length) {
          const current = hits[index++]
          if (!current) continue
          try {
            const versions = await this.versions(current.project_id, {
              loader: current.project_type === 'mod' ? filters.loader : undefined,
              gameVersion: filters.gameVersion,
              releaseType: filters.releaseType
            })
            if (versions.length) {
              filtered.push({ ...current, latest_version: versions[0].id })
            }
          } catch {
            /* skip failed project filter */
          }
        }
      })
    )
    return filtered
  }

  async search(filters: ModrinthSearchFilters): Promise<ModrinthSearchResult> {
    const facets: string[][] = [[`project_types:${filters.type}`]]
    if (filters.type === 'mod' && filters.loader) facets.push([`loaders:${filters.loader}`])
    if (filters.gameVersion) facets.push([`game_versions:${filters.gameVersion}`])
    const params: Record<string, string> = {
      query: filters.query.trim(),
      facets: JSON.stringify(facets),
      limit: String(Math.min(40, Math.max(1, filters.limit ?? 20))),
      offset: String(Math.max(0, filters.offset ?? 0)),
      index: 'relevance'
    }
    const raw = await this.api<Omit<ModrinthSearchResult, 'hits'> & { hits: RawSearchHit[] }>('/search', params)
    const result: ModrinthSearchResult = {
      ...raw,
      hits: raw.hits.map((hit) => {
        const normalized = normalizeHit(hit, filters.type)
        normalized.versions = filters.gameVersion
          ? [filters.gameVersion]
          : normalized.versions.slice(-3)
        return normalized
      })
    }
    if (!filters.releaseType) return result
    const hits = await this.filterByRelease(result.hits, filters)
    return { ...result, hits, total_hits: hits.length }
  }

  private async chooseVersion(
    projectId: string,
    instance: InstanceRecord,
    kind: ModrinthContentType,
    versionId?: string,
    releaseType?: ModrinthReleaseType
  ): Promise<ModrinthVersion> {
    const versions = await this.versions(projectId, {
      loader: kind === 'mod' ? instance.loader.type : undefined,
      gameVersion: instance.mcVersion,
      releaseType
    })
    if (!versions.length) throw new Error('这个项目没有匹配当前实例版本与加载器的文件')
    if (versionId) {
      const found = versions.find((version) => version.id === versionId)
      if (found) return found
    }
    return versions[0]
  }

  private manifestPath(instance: InstanceRecord): string {
    return path.join(gameDataDirFor(instance), MANIFEST)
  }

  private async readManifest(instance: InstanceRecord): Promise<Manifest> {
    const file = this.manifestPath(instance)
    try {
      const parsed = JSON.parse(await fsp.readFile(file, 'utf8')) as Manifest
      if (parsed && parsed.downloads && typeof parsed.downloads === 'object') return parsed
    } catch {
      /* new manifest */
    }
    return { version: 1, downloads: {} }
  }

  private async writeManifest(instance: InstanceRecord, manifest: Manifest): Promise<void> {
    const file = this.manifestPath(instance)
    await fsp.mkdir(path.dirname(file), { recursive: true })
    await fsp.writeFile(file, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  }

  private pickFile(version: ModrinthVersion): ModrinthVersionFile {
    const primary = version.files?.find((file) => file.primary) ?? version.files?.[0]
    if (!primary) throw new Error('这个版本没有可下载的文件')
    return primary
  }

  private progressEmitter(
    fileName: string,
    total: number,
    threads: number,
    onProgress?: (progress: ModrinthProgress) => void
  ): (delta: number) => void {
    const started = Date.now()
    let received = 0
    let last = 0
    return (delta: number) => {
      received += delta
      const now = Date.now()
      if (onProgress && (now - last > 160 || received >= total)) {
        last = now
        const seconds = Math.max(0.05, (now - started) / 1000)
        onProgress({
          phase: 'download',
          fileName,
          received,
          total,
          percent: total ? Math.min(100, Math.round((received / total) * 100)) : 0,
          speed: received / seconds,
          threads
        })
      }
    }
  }

  private async downloadSingle(
    url: string,
    temp: string,
    total: number,
    emit: (delta: number) => void,
    maxSpeed = 0
  ): Promise<void> {
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(10 * 60_000)
    })
    if (!response.ok || !response.body) throw new Error(`下载失败：HTTP ${response.status}`)
    const stream = Readable.fromWeb(response.body as any)
    stream.on('data', (chunk: Buffer) => {
      emit(chunk.length)
      if (maxSpeed > 0) {
        const delay = Math.min(500, (chunk.length / Math.max(1, maxSpeed)) * 1000)
        if (delay > 1) {
          stream.pause()
          setTimeout(() => stream.resume(), delay)
        }
      }
    })
    await pipeline(stream, fs.createWriteStream(temp))
  }

  private async downloadParallel(
    url: string,
    temp: string,
    total: number,
    threads: number,
    emit: (delta: number) => void,
    maxSpeed = 0
  ): Promise<boolean> {
    const count = Math.max(2, Math.min(threads, Math.ceil(total / (1024 * 1024))))
    const size = Math.ceil(total / count)
    const handle = await fsp.open(temp, 'w')
    await handle.truncate(total)
    try {
      await Promise.all(
        Array.from({ length: count }, async (_, index) => {
          const start = index * size
          const end = Math.min(total - 1, start + size - 1)
          if (start > end) return
          const response = await fetch(url, {
            headers: { 'User-Agent': USER_AGENT, Range: `bytes=${start}-${end}` },
            signal: AbortSignal.timeout(10 * 60_000)
          })
          if (response.status !== 206) throw new Error('Range 不受支持')
          const buffer = Buffer.from(await response.arrayBuffer())
          if (buffer.length !== end - start + 1) throw new Error('分片长度不一致')
          const chunk = await fsp.open(temp, 'r+')
          await chunk.write(buffer, 0, buffer.length, start)
          await chunk.close()
          emit(buffer.length)
          if (maxSpeed > 0) {
            const delay = Math.min(500, (buffer.length / Math.max(1, maxSpeed / count)) * 1000)
            if (delay > 1) await new Promise((resolve) => setTimeout(resolve, delay))
          }
        })
      )
      await handle.close()
      return true
    } catch {
      await handle.close().catch(() => undefined)
      await fsp.rm(temp, { force: true }).catch(() => undefined)
      return false
    }
  }

  private async verifyHash(file: string, expected?: string): Promise<void> {
    if (!expected) return
    const hash = createHash('sha1')
    for await (const chunk of fs.createReadStream(file)) hash.update(chunk as Buffer)
    if (hash.digest('hex').toLowerCase() !== expected.toLowerCase()) {
      throw new Error('下载文件 SHA-1 校验失败')
    }
  }

  async download(
    instanceId: string,
    projectId: string,
    projectTitle: string,
    kind: ModrinthContentType,
    versionId?: string,
    releaseType?: ModrinthReleaseType,
    onProgress?: (progress: ModrinthProgress) => void,
    replaceFileName?: string
  ): Promise<ModrinthDownloadResult> {
    const instance = this.instance(instanceId)
    const version = await this.chooseVersion(projectId, instance, kind, versionId, releaseType)
    const file = this.pickFile(version)
    const dir = path.join(gameDataDirFor(instance), contentTypeDir(kind))
    await fsp.mkdir(dir, { recursive: true })
    const target = path.join(dir, path.basename(file.filename))
    const temp = `${target}.part`
    const total = Number(file.size ?? 0)
    const preferred = Math.max(1, Math.min(16, this.store.get().global.downloadThreads || 8))
    const threads =
      total > 2 * 1024 * 1024
        ? Math.max(2, Math.min(preferred, Math.ceil(total / (1024 * 1024))))
        : 1
    const emit = this.progressEmitter(file.filename, total, threads, onProgress)
    let parallel = false
    if (threads > 1) {
      parallel = await this.downloadParallel(file.url, temp, total, threads, emit, this.store.get().global.downloadLimit * 1024 * 1024)
    }
    if (!parallel) {
      await fsp.rm(temp, { force: true }).catch(() => undefined)
      await this.downloadSingle(file.url, temp, total, emit, this.store.get().global.downloadLimit * 1024 * 1024)
    }
    await this.verifyHash(temp, file.hashes?.sha1).catch(async (err) => {
      await fsp.rm(temp, { force: true }).catch(() => undefined)
      throw err
    })
    await fsp.rm(target, { force: true })
    await fsp.rename(temp, target)
    if (replaceFileName && replaceFileName !== path.basename(file.filename)) {
      await fsp.rm(path.join(dir, path.basename(replaceFileName)), { force: true }).catch(() => undefined)
    }
    this.versionCache.clear()
    const manifest = await this.readManifest(instance)
    for (const [name, entry] of Object.entries(manifest.downloads)) {
      if (entry.projectId === projectId && name !== path.basename(file.filename)) delete manifest.downloads[name]
    }
    manifest.downloads[path.basename(file.filename)] = {
      fileName: path.basename(file.filename),
      projectId,
      slug: projectId,
      title: projectTitle,
      kind,
      versionId: version.id,
      versionNumber: version.version_number,
      versionType: version.version_type,
      gameVersions: version.game_versions,
      loaders: version.loaders,
      downloadedAt: Date.now()
    }
    await this.writeManifest(instance, manifest)
    onProgress?.({ phase: 'download', fileName: file.filename, received: total, total, percent: 100, speed: 0, threads })
    return {
      fileName: path.basename(file.filename),
      path: target,
      version,
      projectId,
      projectTitle,
      kind
    }
  }

  async updates(instanceId: string): Promise<ModrinthUpdate[]> {
    const instance = this.instance(instanceId)
    const manifest = await this.readManifest(instance)
    const entries = Object.values(manifest.downloads)
    if (!entries.length) return []
    const tags = await this.tags().catch(() => ({ loaders: [], gameVersions: [] }) as ModrinthTags)
    const gameVersionType = tags.gameVersions.find((item) => item.version === instance.mcVersion)?.version_type
    const results: ModrinthUpdate[] = []
    let index = 0
    await Promise.all(
      Array.from({ length: 4 }, async () => {
        while (index < entries.length) {
          const entry = entries[index++]
          try {
            const versions = await this.versions(entry.projectId, {
              loader: entry.kind === 'mod' ? instance.loader.type : undefined,
              gameVersion: instance.mcVersion
            })
            const latest = versions[0]
            if (!latest || latest.id === entry.versionId) continue
            const file = this.pickFile(latest)
            results.push({
              projectId: entry.projectId,
              slug: entry.slug,
              title: entry.title,
              kind: entry.kind,
              currentVersionId: entry.versionId,
              currentVersionNumber: entry.versionNumber,
              currentVersionType: entry.versionType,
              latestVersionId: latest.id,
              latestVersionNumber: latest.version_number,
              latestVersionType: latest.version_type,
              gameVersions: latest.game_versions,
              loaders: latest.loaders,
              fileName: entry.fileName,
              downloadUrl: file.url,
              gameVersionType
            })
          } catch {
            /* keep checking other mods */
          }
        }
      })
    )
    return results.sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'))
  }

  async downloadUpdate(
    instanceId: string,
    update: ModrinthUpdate,
    onProgress?: (progress: ModrinthProgress) => void
  ): Promise<ModrinthDownloadResult> {
    return this.download(
      instanceId,
      update.projectId,
      update.title,
      update.kind,
      update.latestVersionId,
      undefined,
      onProgress,
      update.fileName
    )
  }

  async openFolder(instanceId: string, kind: ModrinthContentType): Promise<void> {
    const instance = this.instance(instanceId)
    const dir = path.join(gameDataDirFor(instance), contentTypeDir(kind))
    await fsp.mkdir(dir, { recursive: true })
    const { shell } = await import('electron')
    await shell.openPath(dir)
  }

  async simulateUpdate(instanceId: string): Promise<ModrinthUpdate[]> {
    const instance = this.instance(instanceId)
    let search = await this.search({ query: 'jei', type: 'mod', loader: instance.loader.type, gameVersion: instance.mcVersion, limit: 1 })
    if (!search.hits.length) {
      search = await this.search({ query: 'jei', type: 'mod', gameVersion: instance.mcVersion, limit: 1 })
    }
    const hit = search.hits[0]
    if (!hit) throw new Error('没有找到可用于模拟的项目')
    const versions = await this.versions(hit.project_id, {
      loader: instance.loader.type,
      gameVersion: instance.mcVersion
    })
    if (!versions.length) throw new Error('模拟项目没有可用版本')
    const manifest = await this.readManifest(instance)
    const before = JSON.parse(JSON.stringify(manifest)) as Manifest
    const manifestPath = this.manifestPath(instance)
    const existed = fs.existsSync(manifestPath)
    manifest.downloads[`simulated-${hit.slug}.jar`] = {
      fileName: `simulated-${hit.slug}.jar`,
      projectId: hit.project_id,
      slug: hit.slug,
      title: hit.title,
      kind: 'mod',
      versionId: 'simulated-old-version',
      versionNumber: '0.0.1-simulated',
      versionType: 'release',
      gameVersions: [instance.mcVersion],
      loaders: [instance.loader.type],
      downloadedAt: Date.now() - 86400000
    }
    await this.writeManifest(instance, manifest)
    this.versionCache.clear()
    try {
      return await this.updates(instanceId)
    } finally {
      if (existed) await this.writeManifest(instance, before)
      else await fsp.rm(manifestPath, { force: true }).catch(() => undefined)
    }
  }
}
