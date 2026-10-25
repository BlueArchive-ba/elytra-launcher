export interface GameChannelUpdate {
  version: string
  releasedAt: string
  url: string
}

export interface GameUpdateInfo {
  release: GameChannelUpdate | null
  snapshot: GameChannelUpdate | null
  checkedAt: number
}

const MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'

/** Lightweight Mojang version-manifest check; cached for 30 minutes. */
export class GameUpdateService {
  private cache: { at: number; data: GameUpdateInfo } | null = null

  async check(): Promise<GameUpdateInfo> {
    if (this.cache && Date.now() - this.cache.at < 30 * 60_000) return this.cache.data
    try {
      const response = await fetch(MANIFEST, {
        headers: { 'User-Agent': 'ELYTRA/1.3 (game update check)' },
        signal: AbortSignal.timeout(15_000)
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = (await response.json()) as {
        latest?: { release?: string; snapshot?: string }
        versions?: { id: string; type: string; url: string; releaseTime: string }[]
      }
      const find = (id?: string) => data.versions?.find((item) => item.id === id)
      const release = find(data.latest?.release)
      const snapshot = find(data.latest?.snapshot)
      const result: GameUpdateInfo = {
        release: release ? { version: release.id, releasedAt: release.releaseTime, url: release.url } : null,
        snapshot: snapshot ? { version: snapshot.id, releasedAt: snapshot.releaseTime, url: snapshot.url } : null,
        checkedAt: Date.now()
      }
      this.cache = { at: Date.now(), data: result }
      return result
    } catch {
      return this.cache?.data ?? { release: null, snapshot: null, checkedAt: Date.now() }
    }
  }
}
