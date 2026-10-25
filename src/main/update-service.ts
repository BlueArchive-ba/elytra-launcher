import { app, net } from 'electron'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

const REPO = 'BlueArchive-ba/elytra-launcher'
const API = `https://api.github.com/repos/${REPO}/releases?per_page=30`

interface GitHubAsset {
  name: string
  browser_download_url: string
  size: number
  updated_at?: string
}

interface GitHubRelease {
  tag_name?: string
  name?: string
  body?: string
  html_url?: string
  published_at?: string
  draft?: boolean
  prerelease?: boolean
  assets?: GitHubAsset[]
}

function isNewer(latest: string, current: string): boolean {
  const clean = (v: string) => v.replace(/^v/i, '').split(/[.+-]/).map((part) => Number(part) || 0)
  const a = clean(latest)
  const b = clean(current)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0)
  }
  return false
}

async function request(url: string, init: RequestInit): Promise<Response> {
  if (typeof net.fetch === 'function') {
    try {
      return await net.fetch(url, init)
    } catch {
      // Fall through to Node's fetch; some systems have a broken Chromium proxy.
    }
  }
  return fetch(url, init)
}

function assetMatchesVersion(asset: GitHubAsset, version: string): boolean {
  const match = /ELYTRA-(\d+\.\d+\.\d+)/i.exec(asset.name)
  return !match || match[1] === version
}

function pickAsset(release: GitHubRelease): GitHubAsset | undefined {
  return release.assets?.find((item) => /\.exe$/i.test(item.name) && /x64|setup|installer/i.test(item.name))
    ?? release.assets?.find((item) => /\.exe$/i.test(item.name))
}

/** GitHub Releases based update check. No external updater runtime is required. */
export class UpdateService {
  async check(): Promise<LauncherUpdateInfo> {
    const current = app.getVersion()
    try {
      const response = await request(API, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': `ELYTRA/${current}` },
        signal: AbortSignal.timeout(15_000)
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const releases = (await response.json()) as GitHubRelease[]
      // Ignore the newest tag when it has no installer; an empty draft/placeholder
      // release must not block a real update behind it.
      const candidates = releases.filter((item) => {
        if (item.draft || item.prerelease) return false
        const asset = pickAsset(item)
        return !!asset && assetMatchesVersion(asset, String(item.tag_name ?? '').replace(/^v/i, ''))
      })
      const release = candidates[0]
      if (!release) {
        const fallback = releases.find((item) => !item.draft && !item.prerelease)
        return {
          available: false,
          current,
          latest: String(fallback?.tag_name ?? current).replace(/^v/i, ''),
          name: fallback?.name ?? '',
          notes: fallback?.body ?? '',
          pageUrl: fallback?.html_url ?? `https://github.com/${REPO}/releases`,
          assetUrl: null,
          assetName: null,
          size: 0,
          publishedAt: fallback?.published_at ?? '',
          error: '最新 Release 没有可下载的安装包'
        }
      }
      const asset = pickAsset(release)
      const latest = String(release.tag_name ?? '').replace(/^v/i, '')
      let installedAt = 0
      if (app.isPackaged) {
        try {
          installedAt = fs.statSync(app.getPath('exe')).mtimeMs
        } catch {
          installedAt = 0
        }
      }
      const releaseTime = Date.parse(asset?.updated_at ?? release.published_at ?? '')
      const sameVersionNewBuild = !!latest && latest === current && installedAt > 0 && releaseTime > installedAt + 60_000
      return {
        available: !!latest && (isNewer(latest, current) || sameVersionNewBuild),
        current,
        latest: latest || current,
        name: release.name ?? `ELYTRA ${latest}`,
        notes: release.body ?? '',
        pageUrl: release.html_url ?? `https://github.com/${REPO}/releases`,
        assetUrl: asset?.browser_download_url ?? null,
        assetName: asset?.name ?? null,
        size: asset?.size ?? 0,
        publishedAt: release.published_at ?? ''
      }
    } catch (error) {
      return {
        available: false,
        current,
        latest: current,
        name: '',
        notes: '',
        pageUrl: `https://github.com/${REPO}/releases`,
        assetUrl: null,
        assetName: null,
        size: 0,
        publishedAt: '',
        error: error instanceof Error ? `更新服务不可用：${error.message}` : '更新服务不可用'
      }
    }
  }

  async download(info: LauncherUpdateInfo): Promise<string> {
    if (!info.assetUrl) throw new Error('最新版本没有可下载的安装包')
    const parsed = new URL(info.assetUrl)
    if (parsed.protocol !== 'https:' || !/github(usercontent)?\.com$/i.test(parsed.hostname)) {
      throw new Error('不受信任的更新地址')
    }
    const dir = path.join(app.getPath('temp'), 'elytra-update')
    await fsp.mkdir(dir, { recursive: true })
    const target = path.join(dir, info.assetName || `ELYTRA-${info.latest}-x64.exe`)
    const response = await request(parsed.toString(), { headers: { 'User-Agent': `ELYTRA/${info.current}` } })
    if (!response.ok || !response.body) throw new Error(`下载失败：HTTP ${response.status}`)
    const buffer = Buffer.from(await response.arrayBuffer())
    await fsp.writeFile(target, buffer)
    return target
  }

  async install(file: string): Promise<void> {
    const resolved = path.resolve(file)
    if (!/-x64\.exe$/i.test(path.basename(resolved)) || !fs.existsSync(resolved)) {
      throw new Error('更新安装包不存在')
    }
    spawn(resolved, [], { detached: true, stdio: 'ignore' }).unref()
    setTimeout(() => app.quit(), 350)
  }
}

export interface LauncherUpdateInfo {
  available: boolean
  current: string
  latest: string
  name: string
  notes: string
  pageUrl: string
  assetUrl: string | null
  assetName: string | null
  size: number
  publishedAt: string
  error?: string
}
