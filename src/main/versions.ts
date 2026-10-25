import path from 'node:path'
import fs from 'node:fs'
import { app } from 'electron'
import type { JavaInfo, LoaderType, LoaderVersion, MinecraftVersion } from '../shared/types'

const MC_MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'
const FABRIC_META = 'https://meta.fabricmc.net/v2/versions/loader'
const QUILT_META = 'https://meta.quiltmc.org/v3/versions/loader'
const FORGE_META = 'https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml'
const NEOFORGE_META = 'https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml'
const BMCL = 'https://bmclapi2.bangbang93.com'
const QLU = 'https://mirrors4.qlu.edu.cn/bmclapi'
const NEOFORGE_META_MIRRORS = [
  `${QLU}/net/neoforged/neoforge/maven-metadata.xml`,
  `${BMCL}/maven/net/neoforged/neoforge/maven-metadata.xml`,
  NEOFORGE_META
]
const FORGE_META_MIRRORS = [
  FORGE_META,
  `${BMCL}/maven/net/minecraftforge/forge/maven-metadata.xml`
]
const FABRIC_META_MIRRORS = [FABRIC_META, `${BMCL}/fabric-meta/v2/versions/loader`]
const QUILT_META_MIRRORS = [QUILT_META, `${BMCL}/quilt-meta/v3/versions/loader`]

const FALLBACK_MC: MinecraftVersion[] = [
  '1.21.8',
  '1.21.1',
  '1.20.6',
  '1.20.4',
  '1.20.1',
  '1.19.4',
  '1.19.2',
  '1.18.2',
  '1.17.1',
  '1.16.5',
  '1.12.2',
  '1.8.9'
].map((id) => ({ id, type: 'release', releaseTime: '' }))

const FALLBACK_LOADERS: Partial<Record<LoaderType, Record<string, string[]>>> = {
  neoforge: {
    '1.21.1': ['21.1.209', '21.1.186', '21.1.172'],
    '1.21.3': ['21.3.56'],
    '1.20.6': ['20.6.119'],
    '1.20.4': ['20.4.237'],
    '1.20.2': ['20.2.88']
  },
  forge: {
    '1.21.1': ['52.0.1', '52.0.0'],
    '1.20.1': ['47.3.0', '47.2.0', '47.1.106'],
    '1.19.2': ['43.4.0', '43.3.0'],
    '1.18.2': ['40.2.21', '40.2.0'],
    '1.16.5': ['36.2.39'],
    '1.12.2': ['14.23.5.2860'],
    '1.8.9': ['11.15.1.2318']
  },
  fabric: {
    '1.21.1': ['0.16.10', '0.16.9', '0.15.11'],
    '1.20.1': ['0.15.11', '0.16.10']
  },
  quilt: {
    '1.21.1': ['0.27.0', '0.26.4'],
    '1.20.1': ['0.24.0', '0.23.1']
  }
}

interface CacheEntry<T> {
  value: T
  at: number
}

async function fetchJson<T>(url: string, ms = 20_000): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(ms) })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`)
  return (await res.json()) as T
}

async function fetchText(url: string, ms = 30_000): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(ms) })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`)
  return await res.text()
}

async function fetchTextAny(urls: string[], ms = 12_000): Promise<string> {
  let lastError: unknown = null
  for (const url of urls) {
    try {
      return await fetchText(url, ms)
    } catch (err) {
      lastError = err
    }
  }
  throw lastError ?? new Error('No metadata source available')
}

async function fetchJsonAny<T>(urls: string[], ms = 15_000): Promise<T> {
  let lastError: unknown = null
  for (const url of urls) {
    try {
      return await fetchJson<T>(url, ms)
    } catch (err) {
      lastError = err
    }
  }
  throw lastError ?? new Error('No metadata source available')
}

function numericCompare(a: string, b: string): number {
  return b.localeCompare(a, undefined, { numeric: true, sensitivity: 'base' })
}

export class VersionService {
  private mcCache: CacheEntry<MinecraftVersion[]> | null = null
  private loaderCache = new Map<string, CacheEntry<LoaderVersion[]>>()
  private javaCache: CacheEntry<JavaInfo[]> | null = null
  private fallbackFile: string

  constructor() {
    this.fallbackFile = path.join(app.getPath('userData'), 'cache', 'minecraft-versions.json')
  }

  async minecraft(force = false): Promise<MinecraftVersion[]> {
    if (!force && this.mcCache && Date.now() - this.mcCache.at < 6 * 3600_000) return this.mcCache.value
    try {
      const data = await fetchJson<{
        versions: { id: string; type: MinecraftVersion['type']; releaseTime: string }[]
      }>(MC_MANIFEST)
      const versions = data.versions
        .filter((v) => ['release', 'snapshot', 'old_beta', 'old_alpha'].includes(v.type))
        .map((v) => ({ id: v.id, type: v.type, releaseTime: v.releaseTime }))
      this.mcCache = { value: versions, at: Date.now() }
      try {
        fs.mkdirSync(path.dirname(this.fallbackFile), { recursive: true })
        fs.writeFileSync(this.fallbackFile, JSON.stringify(versions), 'utf8')
      } catch {
        /* cache write is best-effort */
      }
      return versions
    } catch (err) {
      console.warn('[versions] Mojang manifest failed:', err)
      if (this.mcCache) return this.mcCache.value
      try {
        if (fs.existsSync(this.fallbackFile)) {
          const cached = JSON.parse(fs.readFileSync(this.fallbackFile, 'utf8')) as MinecraftVersion[]
          if (Array.isArray(cached) && cached.length) {
            this.mcCache = { value: cached, at: Date.now() - 5 * 3600_000 }
            return cached
          }
        }
      } catch {
      }
      return FALLBACK_MC
    }
  }

  async latest(): Promise<{ release: string; snapshot: string }> {
    const versions = await this.minecraft()
    const release = versions.find((v) => v.type === 'release')?.id ?? '1.21.1'
    const snapshot = versions.find((v) => v.type === 'snapshot')?.id ?? release
    return { release, snapshot }
  }

  async loaders(mcVersion: string, type: LoaderType, force = false): Promise<LoaderVersion[]> {
    if (type === 'vanilla') return [{ version: mcVersion, stable: true }]
    const key = `${type}:${mcVersion}`
    const cached = this.loaderCache.get(key)
    if (!force && cached && Date.now() - cached.at < 10 * 60_000) return cached.value
    let result: LoaderVersion[] = []
    try {
      if (type === 'fabric') {
        const data = await fetchJsonAny<{ loader: { version: string; stable?: boolean } }[]>(
          FABRIC_META_MIRRORS.map((url) => `${url}/${encodeURIComponent(mcVersion)}`),
          20_000
        )
        result = data
          .map((item) => ({ version: item.loader.version, stable: !!item.loader.stable }))
          .sort((a, b) => Number(!!b.stable) - Number(!!a.stable) || numericCompare(a.version, b.version))
      } else if (type === 'quilt') {
        const data = await fetchJsonAny<{ loader: { version: string } }[]>(
          QUILT_META_MIRRORS.map((url) => `${url}/${encodeURIComponent(mcVersion)}`),
          25_000
        )
        result = data
          .map((item) => ({ version: item.loader.version, stable: !item.loader.version.includes('-') }))
          .sort((a, b) => Number(!!b.stable) - Number(!!a.stable) || numericCompare(a.version, b.version))
      } else if (type === 'forge') {
        const xml = await fetchTextAny(FORGE_META_MIRRORS, 18_000)
        const prefix = `${mcVersion}-`
        const versions = [...xml.matchAll(/<version>([^<]+)<\/version>/g)]
          .map((m) => m[1])
          .filter((v) => v.startsWith(prefix))
          .map((v) => v.slice(prefix.length))
        result = versions.sort(numericCompare).map((version) => ({ version, stable: true }))
      } else if (type === 'neoforge') {
        const xml = await fetchTextAny(NEOFORGE_META_MIRRORS, 12_000)
        const short = mcVersion.startsWith('1.')
          ? mcVersion.split('.').slice(1).join('.')
          : mcVersion
        const prefix = mcVersion === '1.20.1' ? '47.1.' : `${short}.`
        const versions = [...xml.matchAll(/<version>([^<]+)<\/version>/g)]
          .map((m) => m[1])
          .filter((v) => v.startsWith(prefix))
        result = versions.sort(numericCompare).map((version) => ({ version, stable: true }))
      }
    } catch (err) {
      console.warn(`[versions] ${type} metadata failed:`, err)
      const fallback = FALLBACK_LOADERS[type]?.[mcVersion] ?? []
      result = fallback.map((version) => ({ version, stable: true }))
    }
    if (!result.length) {
      const fallback = FALLBACK_LOADERS[type]?.[mcVersion] ?? []
      result = fallback.map((version) => ({ version, stable: true }))
    }
    this.loaderCache.set(key, { value: result, at: Date.now() })
    return result
  }

  async detectJava(): Promise<JavaInfo[]> {
    if (this.javaCache && Date.now() - this.javaCache.at < 5 * 60_000) return this.javaCache.value
    const candidates = new Set<string>()
    if (process.env.JAVA_HOME) {
      candidates.add(path.join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java'))
    }
    if (process.platform === 'win32') {
      const roots = [
        process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Java'),
        process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Eclipse Adoptium'),
        process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Microsoft'),
        process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Zulu'),
        process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Amazon Corretto'),
        process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'Eclipse Adoptium'),
        process.env.USERPROFILE && path.join(process.env.USERPROFILE, '.jdks')
      ].filter(Boolean) as string[]
      for (const root of roots) {
        try {
          for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue
            const exe = path.join(root, entry.name, 'bin', 'java.exe')
            if (fs.existsSync(exe)) candidates.add(exe)
          }
        } catch {
        }
      }
      for (const p of (process.env.PATH ?? '').split(';')) {
        const exe = path.join(p, 'java.exe')
        if (fs.existsSync(exe)) candidates.add(exe)
      }
      // PCL keeps its detected Java list here. Imported PCL versions often use
      // a Microsoft Store runtime that is not on PATH or in Program Files.
      try {
        const pclConfig = path.join(app.getPath('appData'), 'PCL', 'config.json')
        if (fs.existsSync(pclConfig)) {
          const parsed = JSON.parse(fs.readFileSync(pclConfig, 'utf8')) as {
            JavaList?: { Folder?: string }[]
          }
          for (const item of parsed.JavaList ?? []) {
            if (!item.Folder) continue
            const exe = path.join(item.Folder.replace(/[\\/]+$/, ''), 'java.exe')
            if (fs.existsSync(exe)) candidates.add(exe)
          }
        }
      } catch {
        /* PCL is optional */
      }
    } else {
      for (const p of (process.env.PATH ?? '').split(':')) {
        const exe = path.join(p, 'java')
        if (fs.existsSync(exe)) candidates.add(exe)
      }
    }
    const found: JavaInfo[] = []
    for (const candidate of [...candidates].slice(0, 40)) {
      const info = await this.validateJava(candidate).catch(() => null)
      if (info && !found.some((f) => f.major === info.major && f.path === info.path)) found.push(info)
    }
    found.sort((a, b) => b.major - a.major)
    this.javaCache = { value: found, at: Date.now() }
    return found
  }

  async validateJava(javaPath: string): Promise<JavaInfo | null> {
    const clean = javaPath.replace(/^"|"$/g, '').trim()
    if (!clean) return null
    try {
      const { execFile } = await import('node:child_process')
      const output = await new Promise<string>((resolve, reject) => {
        execFile(clean, ['-version'], { timeout: 8000, windowsHide: true }, (err, _stdout, stderr) => {
          if (err) reject(err)
          else resolve(`${stderr}`)
        })
      })
      const versionMatch = output.match(/version "([^"]+)"/) ?? output.match(/openjdk (\S+)/)
      const version = versionMatch?.[1] ?? 'unknown'
      let major = 8
      if (version.startsWith('1.')) major = Number(version.split('.')[1])
      else major = Number(version.split(/[.+-]/)[0]) || 8
      const arch = /64-Bit|64-bit|x86_64|aarch64/i.test(output) ? '64-bit' : '32-bit'
      const vendor = /Temurin|Adoptium/i.test(output)
        ? 'Eclipse Temurin'
        : /Microsoft/i.test(output)
          ? 'Microsoft'
          : /Zulu/i.test(output)
            ? 'Azul Zulu'
            : /Corretto/i.test(output)
              ? 'Amazon Corretto'
              : /GraalVM/i.test(output)
                ? 'GraalVM'
                : /OpenJDK/i.test(output)
                  ? 'OpenJDK'
                  : 'Java'
      return { path: clean, version, major, arch, vendor }
    } catch {
      return null
    }
  }
}
