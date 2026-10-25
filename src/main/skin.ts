import { app, dialog, nativeImage, shell } from 'electron'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import EMLLib from 'eml-lib'
import type {
  AppearanceFile,
  AppearanceKind,
  AppearanceSchedule,
  SkinBundle
} from '../shared/types'
import { gameDataDirFor } from './paths'
import type { AuthService } from './auth'
import type { ConfigStore } from './store'
import type { ModrinthService } from './modrinth'

const IMAGE_CACHE_TTL = 45 * 60_000
const imageCache = new Map<string, { data: string; at: number }>()

function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase()
  if (h === 'localhost' || h === '::1' || h.endsWith('.local')) return true
  if (/^127\./.test(h) || /^10\./.test(h) || /^169\.254\./.test(h)) return true
  if (/^192\.168\./.test(h)) return true
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true
  return false
}

async function fetchImage(url: string): Promise<string> {
  if (!url) return ''
  const cached = imageCache.get(url)
  if (cached && Date.now() - cached.at < IMAGE_CACHE_TTL) return cached.data
  try {
    const parsed = new URL(url)
    if (!/^https?:$/.test(parsed.protocol) || isPrivateHost(parsed.hostname)) return ''
    const res = await fetch(url, { signal: AbortSignal.timeout(12_000) })
    if (!res.ok) return ''
    const contentType = res.headers.get('content-type') ?? 'image/png'
    if (!/^image\/(png|jpeg|webp|gif)/i.test(contentType)) return ''
    const buffer = Buffer.from(await res.arrayBuffer())
    if (buffer.length > 3 * 1024 * 1024) return ''
    const data = `data:${contentType.split(';')[0]};base64,${buffer.toString('base64')}`
    imageCache.set(url, { data, at: Date.now() })
    return data
  } catch {
    return ''
  }
}

function defaultSchedule(): AppearanceSchedule {
  return {
    enabled: false,
    slots: [
      { id: 'dawn', start: '06:00', end: '12:00' },
      { id: 'day', start: '12:00', end: '18:00' },
      { id: 'dusk', start: '18:00', end: '22:00' },
      { id: 'night', start: '22:00', end: '06:00' }
    ]
  }
}

function minutesOf(time: string): number {
  const [hour, minute] = time.split(':').map(Number)
  return Math.max(0, Math.min(1439, hour * 60 + minute))
}

function timeInSlot(slot: { start: string; end: string }, minutes: number): boolean {
  const start = minutesOf(slot.start)
  const end = minutesOf(slot.end)
  if (start === end) return true
  if (start < end) return minutes >= start && minutes < end
  return minutes >= start || minutes < end
}

function validateImage(file: string, kind: AppearanceKind): { size: number; width: number; height: number } {
  if (path.extname(file).toLowerCase() !== '.png') throw new Error('只支持 PNG 文件')
  const image = nativeImage.createFromPath(file)
  const size = image.getSize()
  const validSkin = (size.width === 64 && size.height === 64) || (size.width === 64 && size.height === 32)
  const validCape = size.width === 64 && size.height === 32
  if (kind === 'skin' && !validSkin) throw new Error(`皮肤尺寸为 ${size.width}×${size.height}，需要 64×64 或 64×32`)
  if (kind === 'cape' && !validCape) throw new Error(`披风尺寸为 ${size.width}×${size.height}，需要 64×32`)
  return { size: fs.statSync(file).size, width: size.width, height: size.height }
}

async function fileToDataUrl(file: string): Promise<string> {
  try {
    const stat = await fsp.stat(file)
    if (stat.size > 4 * 1024 * 1024) return ''
    const buffer = await fsp.readFile(file)
    return `data:image/png;base64,${buffer.toString('base64')}`
  } catch {
    return ''
  }
}

async function scanFiles(dir: string, kind: AppearanceKind, source: 'local' | 'library'): Promise<AppearanceFile[]> {
  await fsp.mkdir(dir, { recursive: true }).catch(() => undefined)
  let entries: string[]
  try {
    entries = await fsp.readdir(dir)
  } catch {
    return []
  }
  const files: AppearanceFile[] = []
  for (const name of entries) {
    if (!name.toLowerCase().endsWith('.png')) continue
    const file = path.join(dir, name)
    try {
      const stat = await fsp.stat(file)
      if (!stat.isFile()) continue
      files.push({
        id: name,
        name: name.replace(/\.png$/i, ''),
        path: file,
        image: await fileToDataUrl(file),
        size: stat.size,
        modifiedAt: stat.mtimeMs,
        source
      })
    } catch {
      /* skip */
    }
  }
  files.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
  return files
}

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_]/g, '') || 'Player'
}

export class SkinService {
  constructor(
    private auth: AuthService,
    private store: ConfigStore,
    private modrinth?: ModrinthService
  ) {}

  private client(): { skin: InstanceType<typeof EMLLib.Skin>; type: string } | null {
    const account = this.auth.accountFor()
    if (!account) return null
    if (!['msa', 'yggdrasil', 'azuriom'].includes(account.meta.type)) return null
    return { skin: new EMLLib.Skin(account), type: account.meta.type }
  }

  private libraryDirs(): { skins: string; capes: string } {
    const base = path.join(app.getPath('userData'), 'appearance')
    return { skins: path.join(base, 'skins'), capes: path.join(base, 'capes') }
  }

  private activeInstance() {
    const cfg = this.store.get()
    return cfg.instances.find((item) => item.id === cfg.activeInstanceId) ?? null
  }

  private cslInfo() {
    const instance = this.activeInstance()
    const account = this.auth.accountFor()
    if (!instance) {
      return { detected: false, instance: null, modFile: undefined, gameDir: undefined, skinDir: undefined, capeDir: undefined, username: account?.name }
    }
    const gameDir = gameDataDirFor(instance)
    const modsDir = path.join(gameDir, 'mods')
    let modFile: string | undefined
    try {
      modFile = fs
        .readdirSync(modsDir)
        .find((file) => /customskinloader/i.test(file) && file.toLowerCase().endsWith('.jar'))
    } catch {
      /* no mods */
    }
    const root = path.join(gameDir, 'CustomSkinLoader', 'LocalSkin')
    return {
      detected: !!modFile,
      instance,
      modFile,
      gameDir,
      skinDir: path.join(root, 'skins'),
      capeDir: path.join(root, 'capes'),
      username: account?.name
    }
  }

  async localInfo(): Promise<SkinBundle['local']> {
    const info = this.cslInfo()
    const library = this.libraryDirs()
    const schedule = this.store.appearanceSchedule() ?? defaultSchedule()
    const [librarySkins, libraryCapes] = await Promise.all([
      scanFiles(library.skins, 'skin', 'library'),
      scanFiles(library.capes, 'cape', 'library')
    ])
    if (!info.detected || !info.skinDir || !info.capeDir) {
      return {
        detected: false,
        modFile: info.modFile,
        gameDir: info.gameDir,
        skinDir: info.skinDir,
        capeDir: info.capeDir,
        skins: [],
        capes: [],
        librarySkins,
        libraryCapes,
        schedule
      }
    }
    const [skins, capes] = await Promise.all([
      scanFiles(info.skinDir, 'skin', 'local'),
      scanFiles(info.capeDir, 'cape', 'local')
    ])
    const username = info.username ? `${safeName(info.username)}.png` : ''
    return {
      detected: true,
      modFile: info.modFile,
      gameDir: info.gameDir,
      skinDir: info.skinDir,
      capeDir: info.capeDir,
      activeSkinId: username && skins.some((file) => file.id === username) ? username : undefined,
      activeCapeId: username && capes.some((file) => file.id === username) ? username : undefined,
      skins,
      capes,
      librarySkins,
      libraryCapes,
      schedule
    }
  }

  async get(reload = false): Promise<SkinBundle> {
    const local = await this.localInfo()
    const account = this.auth.accountFor()
    const accountType = account?.meta.type

    if (local?.detected) {
      return {
        supported: true,
        mode: 'customskinloader',
        reason: undefined,
        skins: [],
        capes: [],
        activeCapeId: local.activeCapeId ?? null,
        accountType,
        local
      }
    }

    if (!account) {
      return {
        supported: false,
        mode: 'none',
        reason: '还没有登录账户。当前版本也未检测到万用皮肤补丁，无法应用本地外观。',
        skins: [],
        capes: [],
        activeCapeId: null,
        local
      }
    }
    if (!['msa', 'yggdrasil', 'azuriom'].includes(account.meta.type)) {
      return {
        supported: false,
        mode: 'none',
        reason: '离线账户没有在线皮肤数据。检测到万用皮肤补丁后可以使用本地皮肤库。',
        skins: [],
        capes: [],
        activeCapeId: null,
        accountType: account.meta.type,
        local
      }
    }
    const client = this.client()
    if (!client) {
      return {
        supported: false,
        mode: 'none',
        reason: '账户类型不支持皮肤服务',
        skins: [],
        capes: [],
        activeCapeId: null,
        local
      }
    }
    try {
      if (reload) await client.skin.reload()
      const [skins, capes] = await Promise.all([client.skin.getSkins(false), client.skin.getCapes(false)])
      const [skinImages, capeImages] = await Promise.all([
        Promise.all(skins.map((s) => fetchImage(s.url))),
        Promise.all(capes.map((c) => fetchImage(c.url)))
      ])
      return {
        supported: true,
        mode: 'account',
        accountType: account.meta.type,
        activeCapeId: capes.find((c) => c.state === 'active')?.id ?? null,
        skins: skins.map((s, i) => ({
          id: s.id,
          url: s.url,
          state: s.state,
          variant: s.variant,
          image: skinImages[i]
        })),
        capes: capes.map((c, i) => ({
          id: c.id,
          url: c.url,
          state: c.state,
          alias: c.alias,
          image: capeImages[i]
        })),
        local
      }
    } catch (err) {
      return {
        supported: false,
        mode: 'none',
        reason: `读取皮肤失败：${err instanceof Error ? err.message : String(err)}`,
        skins: [],
        capes: [],
        activeCapeId: null,
        accountType: account.meta.type,
        local
      }
    }
  }

  async upload(filePath?: string, variant: 'classic' | 'slim' = 'classic'): Promise<void> {
    const client = this.client()
    if (!client) throw new Error('当前账户不支持更换皮肤')
    let file = filePath
    if (!file) {
      const result = await dialog.showOpenDialog({
        title: '选择 Minecraft 皮肤',
        filters: [{ name: 'PNG 皮肤', extensions: ['png'] }],
        properties: ['openFile']
      })
      if (result.canceled || !result.filePaths[0]) return
      file = result.filePaths[0]
    }
    validateImage(file, 'skin')
    const data = await fsp.readFile(file)
    const blob = new Blob([data], { type: 'image/png' })
    await client.skin.updateSkin(blob as unknown as File, variant)
    imageCache.clear()
  }

  async switchCape(capeId: string): Promise<void> {
    const client = this.client()
    if (!client) throw new Error('当前账户不支持切换披风')
    await client.skin.switchCape(capeId)
    imageCache.clear()
  }

  async hideCape(): Promise<void> {
    const client = this.client()
    if (!client) throw new Error('当前账户不支持隐藏披风')
    if (client.type !== 'msa') throw new Error('只有 Microsoft 账户支持在启动器内隐藏披风')
    await client.skin.hideCape()
  }

  async deleteCape(): Promise<void> {
    const client = this.client()
    if (!client) throw new Error('当前账户不支持删除披风')
    await client.skin.deleteCape()
    imageCache.clear()
  }

  async installSupport(): Promise<SkinBundle> {
    const info = this.cslInfo()
    if (info.detected) return this.get()
    if (!info.instance) throw new Error('请先选择一个实例')
    if (info.instance.loader.type === 'vanilla') {
      throw new Error('当前实例是 Vanilla，无法加载万用皮肤补丁；请使用 Forge / NeoForge / Fabric / Quilt 实例')
    }
    if (!this.modrinth) throw new Error('Modrinth 服务不可用')
    const search = await this.modrinth.search({
      query: 'CustomSkinLoader',
      type: 'mod',
      loader: info.instance.loader.type,
      gameVersion: info.instance.mcVersion,
      limit: 8
    })
    const project = search.hits.find((hit) => /customskinloader/i.test(`${hit.slug} ${hit.title}`))
    if (!project) throw new Error('没有找到适配当前加载器与游戏版本的万用皮肤补丁')
    await this.modrinth.download(info.instance.id, project.project_id, project.title, 'mod', undefined, 'release')
    return this.get()
  }

  async importLocal(kind: AppearanceKind): Promise<SkinBundle> {    const library = this.libraryDirs()
    const target = kind === 'skin' ? library.skins : library.capes
    await fsp.mkdir(target, { recursive: true })
    const result = await dialog.showOpenDialog({
      title: kind === 'skin' ? '导入皮肤到外观库' : '导入披风到外观库',
      filters: [{ name: 'PNG 图片', extensions: ['png'] }],
      properties: ['openFile', 'multiSelections']
    })
    if (result.canceled) return this.get()
    for (const file of result.filePaths) {
      try {
        validateImage(file, kind)
        let name = path.basename(file)
        let dest = path.join(target, name)
        let n = 2
        while (fs.existsSync(dest)) {
          dest = path.join(target, `${path.basename(file, '.png')} (${n++}).png`)
        }
        await fsp.copyFile(file, dest)
      } catch (err) {
        console.warn('[skin] import failed:', err)
      }
    }
    imageCache.clear()
    return this.get()
  }

  async applyLocal(kind: AppearanceKind, fileId: string): Promise<SkinBundle> {
    const info = this.cslInfo()
    if (!info.detected || !info.skinDir || !info.capeDir) {
      throw new Error('当前实例没有检测到万用皮肤补丁，无法应用本地外观')
    }
    if (!info.username) throw new Error('请先登录一个账户，LocalSkin 文件名需要对应游戏内用户名')
    const library = this.libraryDirs()
    const sourceDir = kind === 'skin' ? library.skins : library.capes
    let source = path.join(sourceDir, path.basename(fileId))
    if (!fs.existsSync(source)) {
      const localDir = kind === 'skin' ? info.skinDir : info.capeDir
      source = path.join(localDir, path.basename(fileId))
    }
    if (!fs.existsSync(source)) throw new Error('外观库文件不存在')
    validateImage(source, kind)
    const targetDir = kind === 'skin' ? info.skinDir : info.capeDir
    await fsp.mkdir(targetDir, { recursive: true })
    const target = path.join(targetDir, `${safeName(info.username)}.png`)
    await fsp.copyFile(source, target)
    imageCache.clear()
    return this.get()
  }

  async openLocal(kind?: AppearanceKind): Promise<void> {
    const library = this.libraryDirs()
    const target = kind === 'skin' ? library.skins : kind === 'cape' ? library.capes : path.dirname(library.skins)
    await fsp.mkdir(target, { recursive: true })
    await shell.openPath(target)
  }

  async saveSchedule(schedule: AppearanceSchedule): Promise<SkinBundle> {
    this.store.updateAppearanceSchedule(schedule)
    return this.get()
  }

  async applySchedule(): Promise<SkinBundle> {
    const schedule = this.store.appearanceSchedule() ?? defaultSchedule()
    if (!schedule.enabled) return this.get()
    const info = this.cslInfo()
    if (!info.detected || !info.skinDir || !info.capeDir || !info.username) return this.get()
    const now = new Date()
    const minutes = now.getHours() * 60 + now.getMinutes()
    const slot = schedule.slots.find((item) => timeInSlot(item, minutes))
    if (!slot) return this.get()
    const library = this.libraryDirs()
    for (const [kind, fileId, dir] of [
      ['skin', slot.skinId, info.skinDir],
      ['cape', slot.capeId, info.capeDir]
    ] as [AppearanceKind, string | undefined, string][]) {
      if (!fileId) continue
      const sourceDir = kind === 'skin' ? library.skins : library.capes
      let source = path.join(sourceDir, path.basename(fileId))
      if (!fs.existsSync(source)) {
        source = path.join(kind === 'skin' ? info.skinDir : info.capeDir, path.basename(fileId))
      }
      if (!fs.existsSync(source)) continue
      try {
        validateImage(source, kind)
        await fsp.copyFile(source, path.join(dir, `${safeName(info.username)}.png`))
      } catch {
        /* skip invalid file */
      }
    }
    imageCache.clear()
    return this.get()
  }
}
