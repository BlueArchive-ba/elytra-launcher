import type { AccentKey, InstanceRecord, LoaderType, ResolvedLaunchMode, Settings, SettingsOverride } from './types'

export const DEFAULT_SETTINGS: Settings = {
  memoryMin: 1024,
  memoryMax: 4096,
  javaMode: 'auto',
  javaPath: '',
  jvmArgs: '',
  gameArgs: '',
  windowWidth: 1280,
  windowHeight: 720,
  fullscreen: false,
  afterLaunch: 'minimize',
  cleaning: false,
  downloadThreads: 32,
  downloadLimit: 0,
  smartDownload: true
}

export const ACCENTS: { key: AccentKey; label: string; from: string; to: string; glow: string }[] = [
  { key: 'ember', label: '余烬红', from: '#ff2d4b', to: '#ff7a45', glow: 'rgba(255,45,75,.45)' },
  { key: 'frost', label: '霜蓝', from: '#2f7bff', to: '#4fd6ff', glow: 'rgba(47,123,255,.42)' },
  { key: 'void', label: '虚空紫', from: '#8b5cf6', to: '#e879f9', glow: 'rgba(139,92,246,.4)' },
  { key: 'moss', label: '苔原绿', from: '#22c55e', to: '#a3e635', glow: 'rgba(34,197,94,.38)' },
  { key: 'gold', label: '熔金', from: '#f5a524', to: '#fde047', glow: 'rgba(245,165,36,.4)' },
  { key: 'orchid', label: '霓虹粉', from: '#fb3d8f', to: '#ff8a5c', glow: 'rgba(251,61,143,.4)' }
]

export const LOADER_META: Record<LoaderType, { label: string; short: string; color: string }> = {
  vanilla: { label: 'Vanilla', short: 'VAN', color: '#9aa4b2' },
  forge: { label: 'Forge', short: 'FOR', color: '#ff9d42' },
  neoforge: { label: 'NeoForge', short: 'NEO', color: '#ffb15c' },
  fabric: { label: 'Fabric', short: 'FAB', color: '#d8c98d' },
  quilt: { label: 'Quilt', short: 'QLT', color: '#c084fc' }
}

export function mergeSettings(global: Settings, overrides: SettingsOverride | undefined): Settings {  const merged = { ...global, ...(overrides ?? {}) } as Settings
  merged.memoryMin = clamp(Math.round(merged.memoryMin), 256, 65536)
  merged.memoryMax = clamp(Math.round(merged.memoryMax), 512, 65536)
  if (merged.memoryMax < merged.memoryMin) merged.memoryMax = merged.memoryMin
  merged.windowWidth = clamp(Math.round(merged.windowWidth), 320, 7680)
  merged.windowHeight = clamp(Math.round(merged.windowHeight), 240, 4320)
  merged.jvmArgs = typeof merged.jvmArgs === 'string' ? merged.jvmArgs : ''
  merged.gameArgs = typeof merged.gameArgs === 'string' ? merged.gameArgs : ''
  merged.javaPath = typeof merged.javaPath === 'string' ? merged.javaPath : ''
  merged.downloadThreads = clamp(Math.round(Number(merged.downloadThreads) || 32), 4, 128)
  merged.downloadLimit = clamp(Math.round(Number(merged.downloadLimit) || 0), 0, 20)
  merged.smartDownload = merged.smartDownload !== false
  return merged
}

export function resolveLaunchMode(instance: Pick<InstanceRecord, 'launchMode' | 'localVersionDir'>): ResolvedLaunchMode {
  if (instance.launchMode === 'ember') return 'ember'
  if (instance.launchMode === 'local') return instance.localVersionDir ? 'local' : 'ember'
  return instance.localVersionDir ? 'local' : 'ember'
}

export function splitArgs(raw: string): string[] {
  if (!raw.trim()) return []
  const out: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]
    if (quote) {
      if (ch === quote) quote = null
      else if (ch === '\\' && i + 1 < raw.length) current += raw[++i]
      else current += ch
    } else if (ch === '"' || ch === "'") {
      quote = ch
    } else if (/\s/.test(ch)) {
      if (current) {
        out.push(current)
        current = ''
      }
    } else {
      current += ch
    }
  }
  if (current) out.push(current)
  return out
}

export function sanitizeSlug(input: string): string {
  const slug = input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
  return slug.slice(0, 42) || 'instance'
}

export function uniqueSlug(base: string, existing: InstanceRecord[], exceptId?: string): string {
  const used = new Set(existing.filter((x) => x.id !== exceptId).map((x) => x.slug))
  const slug = sanitizeSlug(base)
  if (!used.has(slug)) return slug
  let n = 2
  while (used.has(`${slug}-${n}`)) n++
  return `${slug}-${n}`
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  return `${(bytes / 1024 ** i).toFixed(i > 1 ? 1 : 0)} ${units[i]}`
}

export function formatPlaytime(ms: number): string {
  if (!ms || ms < 60_000) return `${Math.max(0, Math.round(ms / 60_000))}m`
  const h = Math.floor(ms / 3_600_000)
  const m = Math.round((ms % 3_600_000) / 60_000)
  if (h >= 100) return `${h}h`
  return h ? `${h}h ${m}m` : `${m}m`
}

export function relativeTime(timestamp?: number): string {
  if (!timestamp) return '从未启动'
  const diff = Date.now() - timestamp
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  if (diff < 2_592_000_000) return `${Math.floor(diff / 86_400_000)} 天前`
  return new Date(timestamp).toLocaleDateString('zh-CN')
}

export function uid(prefix = 'i'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}
