import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import type { CleanupGroup, CleanupResult } from '../shared/types'
import { gameDataDirFor } from './paths'
import type { ConfigStore } from './store'

const MAX_WALK_DEPTH = 8

interface Item {
  file: string
  size: number
}

function walk(dir: string, depth = 0): Item[] {
  if (depth > MAX_WALK_DEPTH) return []
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const out: Item[] = []
  for (const entry of entries) {
    const file = path.join(dir, entry.name)
    try {
      if (entry.isDirectory()) out.push(...walk(file, depth + 1))
      else if (entry.isFile()) out.push({ file, size: fs.statSync(file).size })
    } catch {
      /* skip disappearing files */
    }
  }
  return out
}

/** Removes disposable diagnostics/caches; user mods and saves are never touched. */
export class MaintenanceService {
  constructor(private store: ConfigStore, private demo = false) {}

  private launchLogsDir(): string {
    return path.join(app.getPath('userData'), 'launch-logs')
  }

  async scan(): Promise<CleanupGroup[]> {
    if (this.demo) return []
    const groups = new Map<string, { label: string; detail: string; items: Item[] }>()
    const add = (id: string, label: string, detail: string, items: Item[]) => {
      groups.set(id, { label, detail, items })
    }

    const crashReports: Item[] = []
    const hsErr: Item[] = []
    const archives: Item[] = []
    const cache: Item[] = []
    const temp: Item[] = []
    for (const instance of this.store.get().instances) {
      const root = gameDataDirFor(instance)
      crashReports.push(...walk(path.join(root, 'crash-reports')))
      hsErr.push(...walk(root).filter((item) => /^hs_err_pid.*\.log$/i.test(path.basename(item.file))))
      archives.push(...walk(path.join(root, 'logs')).filter((item) => item.file.toLowerCase().endsWith('.log.gz')))
      cache.push(...walk(root).filter((item) => path.basename(item.file) === '.elytra-modpack-manifest.json'))
      temp.push(...walk(root).filter((item) => /\.(part|tmp)$/i.test(item.file) || path.basename(item.file).startsWith('.download-')))
    }

    add('crash-reports', '崩溃报告', '实例 crash-reports 目录中的历史报告', crashReports)
    add('hs-err', 'JVM 致命错误日志', 'hs_err_pid*.log', hsErr)
    add('log-archives', '历史日志归档', 'logs 目录中的 .log.gz 压缩日志', archives)
    add('launch-logs', '启动器启动日志', 'ELYTRA 保存的每次启动会话日志', walk(this.launchLogsDir()))
    add('crash-history', '崩溃分析历史', '启动器配置中保存的最近分析结论', [])
    add('modpack-cache', '整合包解析缓存', '下次启动可重新生成的 CurseForge 文件索引', cache)
    add('temp-files', '临时下载文件', '.part / .tmp / 未完成的下载', temp)

    return [...groups.entries()].map(([id, group]) => ({
      id,
      label: group.label,
      detail: group.detail,
      count: id === 'crash-history' ? this.store.crashHistory().length : group.items.length,
      size: group.items.reduce((sum, item) => sum + item.size, 0)
    }))
  }

  async clean(ids: string[]): Promise<CleanupResult> {
    if (this.demo) return { removed: 0, freed: 0 }
    const selected = new Set(ids)
    let removed = 0
    let freed = 0
    const remove = (file: string) => {
      try {
        const size = fs.statSync(file).size
        fs.rmSync(file, { force: true, recursive: true })
        removed++
        freed += size
      } catch {
        /* skip locked file */
      }
    }

    for (const instance of this.store.get().instances) {
      const root = gameDataDirFor(instance)
      if (selected.has('crash-reports')) {
        for (const item of walk(path.join(root, 'crash-reports'))) remove(item.file)
      }
      if (selected.has('hs-err')) {
        for (const item of walk(root)) {
          if (/^hs_err_pid.*\.log$/i.test(path.basename(item.file))) remove(item.file)
        }
      }
      if (selected.has('log-archives')) {
        for (const item of walk(path.join(root, 'logs'))) {
          if (item.file.toLowerCase().endsWith('.log.gz')) remove(item.file)
        }
      }
      if (selected.has('modpack-cache')) {
        for (const item of walk(root)) {
          if (path.basename(item.file) === '.elytra-modpack-manifest.json') remove(item.file)
        }
      }
      if (selected.has('temp-files')) {
        for (const item of walk(root)) {
          if (/\.(part|tmp)$/i.test(item.file) || path.basename(item.file).startsWith('.download-')) remove(item.file)
        }
      }
    }

    if (selected.has('launch-logs')) {
      for (const item of walk(this.launchLogsDir())) remove(item.file)
    }
    if (selected.has('crash-history')) {
      const count = this.store.crashHistory().length
      this.store.clearCrashHistory()
      removed += count
    }
    return { removed, freed }
  }

  /**
   * Deletes every ELYTRA-owned folder. The app userData folder is always
   * removed; `.ember` (instances, mods, saves) only when explicitly requested.
   */
  async purge(includeInstances: boolean): Promise<{ removed: string[]; failed: string[] }> {
    if (this.demo) return { removed: [], failed: [] }
    const appData = app.getPath('appData')
    const userData = path.resolve(app.getPath('userData'))
    const emberRoot = path.resolve(path.join(appData, '.ember'))
    const jobs: { target: string; pruneLinks: boolean }[] = [{ target: userData, pruneLinks: false }]
    if (includeInstances) jobs.push({ target: emberRoot, pruneLinks: true })
    const removed: string[] = []
    const failed: string[] = []
    for (const job of jobs) {
      const resolved = path.resolve(job.target)
      const sameUserData = resolved.toLowerCase() === userData.toLowerCase()
      const sameEmber = resolved.toLowerCase() === emberRoot.toLowerCase()
      if (!sameUserData && !sameEmber) {
        failed.push(resolved)
        continue
      }
      if (!fs.existsSync(resolved)) {
        removed.push(resolved)
        continue
      }
      try {
        if (job.pruneLinks) await this.clearLinks(resolved)
        fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 })
        removed.push(resolved)
      } catch {
        failed.push(resolved)
      }
    }
    return { removed, failed }
  }

  private async clearLinks(root: string): Promise<void> {
    try {
      for (const entry of await fsp.readdir(root, { withFileTypes: true })) {
        if (!entry.isSymbolicLink()) continue
        await fsp.rm(path.join(root, entry.name), { force: true }).catch(() => undefined)
      }
    } catch {
      /* ignore */
    }
  }
}
