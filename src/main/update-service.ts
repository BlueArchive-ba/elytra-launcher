import { app } from 'electron'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

const REPO = 'BlueArchive-ba/elytra-launcher'
const API = `https://api.github.com/repos/${REPO}/releases/latest`

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

/** GitHub Releases based update check. No external updater runtime is required. */
export class UpdateService {
  async check(): Promise<LauncherUpdateInfo> {
    const current = app.getVersion()
    try {
      const response = await fetch(API, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': `ELYTRA/${current}` },
        signal: AbortSignal.timeout(15_000)
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = (await response.json()) as {
        tag_name?: string
        name?: string
        body?: string
        html_url?: string
        published_at?: string
        assets?: { name: string; browser_download_url: string; size: number }[]
      }
      const latest = String(data.tag_name ?? '').replace(/^v/i, '')
      const asset = data.assets?.find((item) => /\.exe$/i.test(item.name) && /x64|setup|installer/i.test(item.name))
        ?? data.assets?.find((item) => /\.exe$/i.test(item.name))
      return {
        available: !!latest && isNewer(latest, current),
        current,
        latest: latest || current,
        name: data.name ?? `ELYTRA ${latest}`,
        notes: data.body ?? '',
        pageUrl: data.html_url ?? `https://github.com/${REPO}/releases`,
        assetUrl: asset?.browser_download_url ?? null,
        assetName: asset?.name ?? null,
        size: asset?.size ?? 0,
        publishedAt: data.published_at ?? ''
      }
    } catch {
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
        publishedAt: ''
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
    const response = await fetch(parsed, { headers: { 'User-Agent': `ELYTRA/${info.current}` } })
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
