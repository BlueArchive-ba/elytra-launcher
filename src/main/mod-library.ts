import { app, dialog, shell } from 'electron'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import type { InstanceRecord, ModLibraryEntry } from '../shared/types'
import { gameDataDirFor } from './paths'

interface LibraryRecord {
  id: string
  fileName: string
  name: string
  version: string
  size: number
  sha1: string
  source: 'local' | 'url'
  addedAt: number
}

/**
 * A launcher-owned mod shelf. Jars live outside any instance; enabling one
 * copies it into the selected instance's mods directory, disabling removes the
 * copy only. The original is never moved or deleted by instance operations.
 */
export class ModLibraryService {
  private filePath: string
  private root: string
  private records: LibraryRecord[] | null = null

  constructor(private demo = false) {
    this.root = path.join(app.getPath('userData'), 'mod-library')
    this.filePath = path.join(this.root, 'library.json')
  }

  private load(): LibraryRecord[] {
    if (this.records) return this.records
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as LibraryRecord[]
      this.records = Array.isArray(parsed) ? parsed.filter((item) => item && typeof item.fileName === 'string') : []
    } catch {
      this.records = []
    }
    return this.records
  }

  private save(): void {
    fs.mkdirSync(this.root, { recursive: true })
    fs.writeFileSync(this.filePath, JSON.stringify(this.load(), null, 2), 'utf8')
  }

  private hashFile(file: string): string {
    return crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex')
  }

  private async copyIntoLibrary(source: string, sourceKind: 'local' | 'url', preferredName?: string): Promise<LibraryRecord> {
    const fileName = path.basename(preferredName || source)
    if (!/\.jar$/i.test(fileName)) throw new Error('只支持 .jar 模组文件')
    await fsp.mkdir(this.root, { recursive: true })
    const sha1 = this.hashFile(source)
    const existing = this.load().find((item) => item.sha1 === sha1)
    if (existing) return existing
    let target = path.join(this.root, fileName)
    let n = 2
    while (fs.existsSync(target)) {
      const stem = path.basename(fileName, '.jar')
      target = path.join(this.root, `${stem}-${n++}.jar`)
    }
    await fsp.copyFile(source, target)
    const stat = await fsp.stat(target)
    const record: LibraryRecord = {
      id: `lib_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      fileName: path.basename(target),
      name: path.basename(target, '.jar').replace(/[-_]+/g, ' ').trim(),
      version: '',
      size: stat.size,
      sha1,
      source: sourceKind,
      addedAt: Date.now()
    }
    this.load().unshift(record)
    this.save()
    return record
  }

  async list(instance?: InstanceRecord): Promise<ModLibraryEntry[]> {
    const root = instance ? gameDataDirFor(instance) : ''
    const modsDir = root ? path.join(root, 'mods') : ''
    const disabledDir = root ? path.join(root, 'mods-disabled') : ''
    return this.load().map((item) => {
      const copied = !!(modsDir && fs.existsSync(path.join(modsDir, item.fileName)))
      return {
        ...item,
        copied,
        copiedIn: copied ? 'mods' : disabledDir && fs.existsSync(path.join(disabledDir, item.fileName)) ? 'mods-disabled' : null,
        source: item.source
      }
    })
  }

  async importLocal(): Promise<ModLibraryEntry[]> {
    if (this.demo) return []
    const result = await dialog.showOpenDialog({
      title: '导入本地模组到模组库',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Minecraft 模组', extensions: ['jar'] }]
    })
    if (result.canceled) return []
    for (const file of result.filePaths) await this.copyIntoLibrary(file, 'local')
    return this.list()
  }

  async importUrl(url: string): Promise<ModLibraryEntry[]> {
    if (this.demo) return []
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      throw new Error('无效的下载地址')
    }
    if (!/^https?:$/.test(parsed.protocol)) throw new Error('只支持 HTTP(S) 地址')
    const res = await fetch(parsed, {
      headers: {
        Accept: 'application/java-archive,application/octet-stream,*/*',
        'User-Agent': 'Mozilla/5.0 ELYTRA/1.1'
      }
    })
    if (!res.ok || !res.body) throw new Error(`下载失败：HTTP ${res.status}`)
    const disposition = res.headers.get('content-disposition') ?? ''
    const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1]
    const plain = disposition.match(/filename="?([^";]+)"?/i)?.[1]
    const fallback = decodeURIComponent(path.basename(parsed.pathname)) || 'download.jar'
    const fileName = path.basename(decodeURIComponent(encoded ?? plain ?? fallback))
    if (!/\.jar$/i.test(fileName)) throw new Error('链接不是 .jar 文件')
    const temp = path.join(this.root, `.download-${Date.now()}.jar`)
    await fsp.mkdir(this.root, { recursive: true })
    const buffer = Buffer.from(await res.arrayBuffer())
    if (buffer.length > 200 * 1024 * 1024) throw new Error('文件超过 200 MB，未导入')
    await fsp.writeFile(temp, buffer)
    try {
      return [await this.copyIntoLibrary(temp, 'url', fileName)].map((item) => ({ ...item, copied: false, copiedIn: null }))
    } finally {
      await fsp.rm(temp, { force: true })
    }
  }

  async toggle(instance: InstanceRecord, id: string, enabled: boolean): Promise<ModLibraryEntry[]> {
    const record = this.load().find((item) => item.id === id)
    if (!record) throw new Error('模组库中找不到该项目')
    const root = gameDataDirFor(instance)
    const modsDir = path.join(root, 'mods')
    await fsp.mkdir(modsDir, { recursive: true })
    const target = path.join(modsDir, record.fileName)
    if (enabled) {
      await fsp.rm(path.join(root, 'mods-disabled', record.fileName), { force: true })
      if (!fs.existsSync(target)) await fsp.copyFile(path.join(this.root, record.fileName), target)
    } else {
      await fsp.rm(target, { force: true })
      await fsp.rm(path.join(root, 'mods-disabled', record.fileName), { force: true })
    }
    return this.list(instance)
  }

  async remove(id: string): Promise<void> {
    const record = this.load().find((item) => item.id === id)
    if (!record) return
    await fsp.rm(path.join(this.root, record.fileName), { force: true })
    this.records = this.load().filter((item) => item.id !== id)
    this.save()
  }

  async open(): Promise<void> {
    await fsp.mkdir(this.root, { recursive: true })
    await shell.openPath(this.root)
  }
}
