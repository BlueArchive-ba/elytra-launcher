import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import Downloader from 'eml-lib/lib/utils/downloader.js'
import emlUtils from 'eml-lib/lib/utils/utils.js'
import emlLoader from 'eml-lib/lib/utils/loader.js'

/**
 * Network layer for EML.
 *
 * EML's own downloader uses eight hard-coded workers and no mirrors. This
 * module keeps its event/progress contract but replaces the transport with:
 *  - adaptive multi-file concurrency,
 *  - live source health (official / BMCLAPI / QLU mirror),
 *  - per-file range probes for large artifacts,
 *  - timeouts and mirror retry,
 *  - SHA-1 verification before the .part file is moved into place.
 */

interface DownloadOptions {
  threads: number
  smartMirror: boolean
  maxSpeed: number
}

interface Candidate {
  url: string
  key: string
  label: string
}

interface Health {
  speed: number
  latency: number
  failures: number
  success: number
  at: number
}

const BMCL = 'https://bmclapi2.bangbang93.com'
const QLU = 'https://mirrors4.qlu.edu.cn/bmclapi'

const options: DownloadOptions = { threads: 32, smartMirror: true, maxSpeed: 0 }
const health = new Map<string, Health>()
const probeCache = new Map<string, { at: number; candidates: Candidate[] }>()
let logger: ((line: string) => void) | null = null
let installed = false
let lastReport = 0

export function configureDownload(next: Partial<DownloadOptions>): void {
  if (typeof next.threads === 'number') options.threads = Math.max(4, Math.min(128, Math.round(next.threads)))
  if (typeof next.smartMirror === 'boolean') options.smartMirror = next.smartMirror
  if (typeof next.maxSpeed === 'number') options.maxSpeed = Math.max(0, Math.min(20 * 1024 * 1024, Math.round(next.maxSpeed)))
}

export function setDownloadLogger(fn: ((line: string) => void) | null): void {
  logger = fn
}

function log(line: string): void {
  try {
    logger?.(line)
  } catch {
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

function getHealth(key: string): Health {
  const existing = health.get(key)
  if (existing) return existing
  const created: Health = { speed: 0, latency: 0, failures: 0, success: 0, at: 0 }
  health.set(key, created)
  return created
}

function record(key: string, bytes: number, ms: number, ok: boolean): void {
  const h = getHealth(key)
  h.at = Date.now()
  if (!ok) {
    h.failures++
    return
  }
  h.success++
  h.latency = h.latency ? h.latency * 0.7 + ms * 0.3 : ms
  if (ms > 25 && bytes > 0) {
    const speed = bytes / (ms / 1000)
    h.speed = h.speed ? h.speed * 0.65 + speed * 0.35 : speed
  }
}

function score(key: string, preference: number): number {
  const h = health.get(key)
  if (!h || (!h.speed && !h.latency)) return preference
  const speedScore = h.speed > 0 ? Math.log10(1 + h.speed / 1024) * 2.2 : 0.5
  const latencyScore = h.latency > 0 ? Math.log10(1 + 1500 / (h.latency + 60)) : 1
  return speedScore + latencyScore - h.failures * 0.7
}

function hostOf(raw: string): string {
  try {
    return new URL(raw).hostname.toLowerCase()
  } catch {
    return ''
  }
}

function mavenUrl(raw: string, prefix: string): string | null {
  try {
    const parsed = new URL(raw)
    const host = parsed.hostname.toLowerCase()
    let rest = parsed.pathname.replace(/^\/+/, '')
    if (host === 'libraries.minecraft.net' || host === 'maven.fabricmc.net') {
      /* path already starts with the group */
    } else if (host === 'maven.neoforged.net') {
      rest = rest.replace(/^releases\//, '')
    } else if (host === 'maven.minecraftforge.net') {
      /* path already starts with the group */
    } else if (host === 'maven.quiltmc.org') {
      rest = rest.replace(/^repository\/release\//, '')
    } else if (host === 'repo1.maven.org') {
      rest = rest.replace(/^maven2\//, '')
    } else {
      return null
    }
    return `${prefix}/${rest}${parsed.search}`
  } catch {
    return null
  }
}

function mirrorCandidates(raw: string): Candidate[] {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return [{ url: raw, key: 'official', label: '官方' }]
  }
  const host = parsed.hostname.toLowerCase()
  if (host === 'bmclapi2.bangbang93.com') return [{ url: raw, key: 'bmcl', label: 'BMCLAPI' }]
  if (host === 'mirrors4.qlu.edu.cn' || host === 'mirror.qlu.edu.cn') return [{ url: raw, key: 'qlu', label: 'QLU 镜像' }]
  if (!options.smartMirror) return [{ url: raw, key: 'official', label: '官方' }]
  if (host.endsWith('forgecdn.net')) {
    const candidates: Candidate[] = [{ url: raw, key: 'official', label: 'CurseForge CDN' }]
    const altHost = host === 'edge.forgecdn.net' ? 'mediafilez.forgecdn.net' : 'edge.forgecdn.net'
    candidates.push({
      url: `https://${altHost}${parsed.pathname}${parsed.search}`,
      key: 'edge',
      label: 'CurseForge Edge'
    })
    return candidates
  }

  const candidates: Candidate[] = [{ url: raw, key: 'official', label: '官方' }]
  const pathname = parsed.pathname
  const push = (url: string | null, key: string, label: string) => {
    if (!url) return
    if (!candidates.some((item) => item.url === url)) candidates.push({ url, key, label })
  }

  if (
    host === 'libraries.minecraft.net' ||
    host === 'maven.neoforged.net' ||
    host === 'maven.minecraftforge.net' ||
    host === 'maven.fabricmc.net' ||
    host === 'maven.quiltmc.org' ||
    host === 'repo1.maven.org'
  ) {
    push(mavenUrl(raw, `${BMCL}/maven`), 'bmcl', 'BMCLAPI')
    push(mavenUrl(raw, QLU), 'qlu', 'QLU 镜像')
  } else if (host === 'meta.fabricmc.net') {
    push(`${BMCL}/fabric-meta${pathname}`, 'bmcl', 'BMCLAPI')
  } else if (host === 'meta.quiltmc.org') {
    push(`${BMCL}/quilt-meta${pathname}`, 'bmcl', 'BMCLAPI')
  } else if (host === 'resources.download.minecraft.net') {
    push(`${BMCL}/assets${pathname}`, 'bmcl', 'BMCLAPI')
  } else if (
    host === 'piston-meta.mojang.com' ||
    host === 'piston-data.mojang.com' ||
    host === 'launchermeta.mojang.com' ||
    host === 'launcher.mojang.com'
  ) {
    push(`${BMCL}${pathname}${parsed.search}`, 'bmcl', 'BMCLAPI')
  }

  const neoforge = host === 'maven.neoforged.net'
  const preference = (key: string): number => {
    if (neoforge) return key === 'qlu' ? 6 : key === 'bmcl' ? 5 : 1
    if (key === 'official') return 4
    if (key === 'bmcl') return 2
    return 0.5
  }
  candidates.sort((a, b) => score(b.key, preference(b.key)) - score(a.key, preference(a.key)))
  return candidates
}

function combineSignals(ms: number, source?: AbortSignal | null): { signal: AbortSignal; done: () => void } {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  const signal = source ? AbortSignal.any([source, controller.signal]) : controller.signal
  return {
    signal,
    done: () => clearTimeout(timer)
  }
}

async function probe(candidate: Candidate): Promise<number> {
  const started = Date.now()
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), 2600)
  try {
    const res = await originalFetch(candidate.url, {
      headers: { Range: 'bytes=0-65535' },
      signal: abort.signal
    })
    if (!res.ok || !res.body) return 0
    const reader = res.body.getReader()
    let bytes = 0
    const first = await reader.read()
    if (first.value) bytes += first.value.byteLength
    await reader.cancel().catch(() => undefined)
    const elapsed = Date.now() - started
    if (!bytes) return 0
    const speed = bytes / (elapsed / 1000)
    record(candidate.key, bytes, elapsed, true)
    return speed
  } catch {
    record(candidate.key, 0, Date.now() - started, false)
    return 0
  } finally {
    clearTimeout(timer)
  }
}

const originalFetch = globalThis.fetch.bind(globalThis)

async function smartFetch(input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): Promise<Response> {
  const raw =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : typeof input === 'object' && 'url' in input
          ? String(input.url)
          : String(input)
  const candidates = mirrorCandidates(raw)
  if (candidates.length === 1) return originalFetch(input, init)

  const method = String(init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET')).toUpperCase()
  const timeout = method === 'HEAD' ? 6000 : 9000
  let lastResponse: Response | null = null
  let lastError: unknown = null
  for (const candidate of candidates) {
    const started = Date.now()
    const signal = combineSignals(timeout, init?.signal)
    try {
      const response = await originalFetch(candidate.url, { ...init, signal: signal.signal })
      if (response.ok) {
        record(candidate.key, Number(response.headers.get('content-length') ?? 0), Date.now() - started, true)
        return response
      }
      record(candidate.key, 0, Date.now() - started, false)
      lastResponse = response
    } catch (err) {
      record(candidate.key, 0, Date.now() - started, false)
      lastError = err
    } finally {
      signal.done()
    }
  }
  if (lastResponse) return lastResponse
  throw lastError ?? new Error(`All download sources failed for ${raw}`)
}

function installFetch(): void {
  if (globalThis.fetch !== smartFetch) {
    ;(globalThis as unknown as { fetch: typeof fetch }).fetch = smartFetch as typeof fetch
  }
}

function installSha1Fallback(): void {
  if (emlUtils.__emberSha1Patched) return
  const original = emlUtils.getRemoteFileSha1.bind(emlUtils)
  emlUtils.getRemoteFileSha1 = async (url: string, message: string): Promise<string> => {
    if (/neoforged|neoforge/i.test(url)) return ''
    try {
      return await original(url, message)
    } catch (err) {
      throw err
    }
  }
  emlUtils.__emberSha1Patched = true
}

function emitProgress(downloader: any, file: any, force = false): void {
  const now = Date.now()
  if (!force && now - (downloader.__emberLastProgress ?? 0) < 140) return
  downloader.__emberLastProgress = now
  downloader.emit('download_progress', {
    total: { amount: downloader.amount, size: downloader.size },
    downloaded: downloader.downloaded,
    speed: Math.floor(downloader.speed ?? 0),
    type: file.type
  })
}

async function downloadFromSource(downloader: any, file: any, candidate: Candidate): Promise<void> {
  const dirPath = path.join(downloader.dest, file.path)
  const filePath = path.join(dirPath, file.name)
  const tempPath = `${filePath}.ember-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.part`
  await fsp.mkdir(dirPath, { recursive: true })
  const headers: Record<string, string> = {
    Accept: 'application/octet-stream',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ELYTRA/1.1',
    Referer: 'https://www.curseforge.com/'
  }
  if (downloader.token && file.url.includes('files/files-updater')) {
    headers.Authorization = `Bearer ${downloader.token}`
  }
  const controller = new AbortController()
  let idle: NodeJS.Timeout | null = null
  const resetIdle = (ms = 25_000) => {
    if (idle) clearTimeout(idle)
    idle = setTimeout(() => controller.abort(), ms)
  }
  resetIdle(12_000)
  const started = Date.now()
  let bytes = 0
  let firstChunk = true
  const hash = createHash('sha1')
  try {
    const response = await originalFetch(candidate.url, { headers, signal: controller.signal })
    if (!response.ok || !response.body) {
      throw new Error(`HTTP ${response.status}`)
    }
    const nodeStream = Readable.fromWeb(response.body as any)
    const out = fs.createWriteStream(tempPath)
    nodeStream.on('data', (chunk: Buffer) => {
      bytes += chunk.length
      hash.update(chunk)
      downloader.downloaded.size += chunk.length
      const now = Date.now()
      const diff = now - (downloader.lastTime || now)
      if (diff > 400) {
        const delta = downloader.downloaded.size - (downloader.lastSize || 0)
        downloader.speed = delta / (diff / 1000)
        downloader.lastTime = now
        downloader.lastSize = downloader.downloaded.size
      }
      if (firstChunk) {
        firstChunk = false
        resetIdle(25_000)
      } else {
        resetIdle(25_000)
      }
      if (options.maxSpeed > 0) {
        const perThread = options.maxSpeed / Math.max(1, options.threads)
        const delay = Math.min(500, (chunk.length / Math.max(1, perThread)) * 1000)
        if (delay > 1) {
          nodeStream.pause()
          setTimeout(() => nodeStream.resume(), delay)
        }
      }
      if (Date.now() - started > 12_000 && bytes < 256 * 1024) {
        controller.abort()
        return
      }
      emitProgress(downloader, file)
    })
    await pipeline(nodeStream, out)
    if (file.sha1 && hash.digest('hex') !== String(file.sha1).toLowerCase()) {
      throw new Error('SHA-1 mismatch')
    }
    await fsp.rm(filePath, { force: true }).catch(() => undefined)
    await fsp.rename(tempPath, filePath)
    await downloader.chmodJavaFiles?.(filePath, file)
    record(candidate.key, bytes, Date.now() - started, true)
    emitProgress(downloader, file, true)
  } catch (err) {
    downloader.downloaded.size -= bytes
    downloader.lastSize = Math.min(downloader.lastSize ?? 0, downloader.downloaded.size)
    record(candidate.key, bytes, Date.now() - started, false)
    await fsp.rm(tempPath, { force: true }).catch(() => undefined)
    throw err
  } finally {
    if (idle) clearTimeout(idle)
  }
}

async function pickCandidates(file: any): Promise<Candidate[]> {
  const base = mirrorCandidates(file.url)
  if (!options.smartMirror || !file.size || file.size < 1_500_000 || base.length < 2) return base
  const cached = probeCache.get(file.url)
  if (cached && Date.now() - cached.at < 120_000) return cached.candidates
  const ranked = base
    .map((candidate) => ({ candidate, score: score(candidate.key, candidate.key === 'official' ? 4 : 2) }))
    .sort((a, b) => b.score - a.score)
    .map((item) => item.candidate)
  // HEAD metadata usually already gave us a usable source speed. Do not spend
  // several seconds probing again when one source is clearly healthy.
  if (ranked.some((candidate) => (health.get(candidate.key)?.speed ?? 0) > 2 * 1024 * 1024)) {
    probeCache.set(file.url, { at: Date.now(), candidates: ranked })
    return ranked
  }
  const measured = await Promise.all(
    base.slice(0, 3).map(async (candidate) => ({ candidate, speed: await probe(candidate) }))
  )
  measured.sort((a, b) => b.speed - a.speed || score(b.candidate.key, 0) - score(a.candidate.key, 0))
  const sorted = measured.map((item) => item.candidate)
  for (const item of base.slice(3)) if (!sorted.includes(item)) sorted.push(item)
  probeCache.set(file.url, { at: Date.now(), candidates: sorted })
  return sorted
}

function sourceSummary(): string {
  const groups: Record<string, { speed: number; count: number }> = {}
  for (const [key, h] of health) {
    if (!h.speed) continue
    const group = key === 'official' ? '官方' : key === 'bmcl' ? 'BMCLAPI' : 'QLU'
    groups[group] ??= { speed: 0, count: 0 }
    groups[group].speed += h.speed
    groups[group].count++
  }
  return Object.entries(groups)
    .map(([name, value]) => `${name} ${(value.speed / value.count / 1024 / 1024).toFixed(1)} MB/s`)
    .join(' · ')
}

function installLoaderPatch(): void {
  if (emlLoader.__emberPatched) return
  const original = emlLoader.getInstaller.bind(emlLoader)
  emlLoader.getInstaller = async (config: any) => {
    const loader = config?.minecraft?.loader
    if (loader?.loader !== 'forge') return original(config)
    const mc = String(config?.minecraft?.version ?? '')
    const version = String(loader.version ?? '')
    const full = mc && !version.startsWith(`${mc}-`) ? `${mc}-${version}` : version
    if (!full) return original(config)
    const base = 'https://maven.minecraftforge.net/net/minecraftforge/forge'
    const url = `${base}/${full}/forge-${full}-installer.jar`
    const size = await emlUtils.getRemoteFileSize(url, 'Failed to fetch Forge artifact size')
    const sha1 = await emlUtils.getRemoteFileSha1(url, 'Failed to fetch Forge artifact SHA1').catch(() => '')
    return {
      name: `forge-${full}-installer.jar`,
      path: 'versions/',
      url,
      size,
      sha1,
      type: 'OTHER',
      format: 'INSTALLER'
    }
  }
  emlLoader.__emberPatched = true
}

function installDownloader(): void {
  if ((Downloader.prototype as any).__emberPatched) return
  const proto = Downloader.prototype as any

  proto.download = async function download(files: any[], skipCheck = false): Promise<void> {
    const list = !skipCheck ? await this.getFilesToDownload(files) : files
    this.CONCURRENCY_LIMIT = options.threads
    this.size = list.reduce((sum: number, file: any) => sum + (file.size ?? 0), 0)
    this.amount = list.length
    this.downloaded = { amount: 0, size: 0 }
    this.speed = 0
    this.lastTime = Date.now()
    this.lastSize = 0
    this.__emberLastProgress = 0
    if (!list.length || this.size === 0) {
      this.emit('download_end', { downloaded: this.downloaded })
      return
    }

    let target = clamp(options.threads, 4, 128)
    let active = 0
    let next = 0
    let finished = 0
    let firstError: unknown = null
    let sessionErrors = 0
    let lastErrors = 0
    let lastBytes = 0
    let lastAt = Date.now()
    log(`[下载优化] ${target} 线程 · 智能镜像 ${options.smartMirror ? '开启' : '关闭'} · 共 ${list.length} 个文件`)

    await new Promise<void>((resolve, reject) => {
      let settled = false
      const done = () => {
        if (settled) return
        settled = true
        clearInterval(tuner)
        const final = sourceSummary()
        log(`[下载优化] 完成 · ${(this.downloaded.size / 1024 / 1024).toFixed(1)} MB${final ? ` · ${final}` : ''}`)
        this.emit('download_end', { downloaded: this.downloaded })
        if (firstError) reject(firstError)
        else resolve()
      }
      const pump = () => {
        while (active < target && next < list.length) {
          const file = list[next++]
          active++
          void this.downloadFileWithRetry(file)
            .catch((err: unknown) => {
              firstError ??= err
              sessionErrors++
            })
            .finally(() => {
              active--
              finished++
              if (finished >= list.length) done()
              else pump()
            })
        }
      }
      const tuner = setInterval(() => {
        const now = Date.now()
        const seconds = (now - lastAt) / 1000
        const speed = seconds > 0 ? (this.downloaded.size - lastBytes) / seconds : 0
        const failures = sessionErrors
        if (speed > 7 * 1024 * 1024 && failures <= lastErrors) target = clamp(target + 4, 4, 32)
        else if (speed < 900 * 1024 || failures > lastErrors + 2) target = clamp(target - 2, 4, 32)
        lastErrors = failures
        lastBytes = this.downloaded.size
        lastAt = now
        pump()
        if (now - lastReport > 5000) {
          lastReport = now
          const summary = sourceSummary()
          log(`[下载优化] ${target} 线程 · ${(speed / 1024 / 1024).toFixed(1)} MB/s${summary ? ` · ${summary}` : ''}`)
        }
      }, 1300)
      pump()
    })
  }

  proto.downloadFile = async function downloadFile(file: any): Promise<void> {
    const candidates = await pickCandidates(file)
    let lastError: unknown = null
    for (const candidate of candidates) {
      try {
        await downloadFromSource(this, file, candidate)
        return
      } catch (err) {
        lastError = err
        if (candidates.length > 1) {
          log(`[下载优化] ${file.name} 从 ${candidate.label} 失败，切换下一个源`)
        }
      }
    }
    throw lastError ?? new Error(`Failed to download ${file.name}`)
  }

  proto.__emberPatched = true
}

export function installDownloadOptimizer(): void {
  if (installed) return
  installed = true
  installFetch()
  installSha1Fallback()
  installLoaderPatch()
  installDownloader()
}

// Debug/testing hook.
export function downloadHealthSnapshot(): Record<string, unknown> {
  return {
    options: { ...options },
    sources: [...health.entries()].map(([key, value]) => ({ key, ...value })),
    probes: probeCache.size
  }
}
