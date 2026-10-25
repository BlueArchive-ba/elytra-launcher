import { app, dialog } from 'electron'
import AdmZip from 'adm-zip'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import type { CreateInstanceInput, InstanceRecord, InstanceView, UpdateInstancePatch } from '../shared/types'
import { mergeSettings, resolveLaunchMode } from '../shared/utils'
import type { ConfigStore } from './store'
import type { LaunchService } from './launch'
import type { ModService } from './mods'
import type { GameSettingsService } from './game-settings'
import {
  defaultGameDir,
  ensureGameDataDir,
  ensureInstanceDirectory,
  gameDataDirFor,
  gameDirFor,
  instanceLinkPath,
  isSubPath,
  moveDirectoryContents,
  pathExists
} from './paths'

export class InstanceService {
  constructor(
    private store: ConfigStore,
    private launch: LaunchService,
    private mods: ModService,
    private gameSettings: GameSettingsService,
    private demo = false
  ) {}

  find(id: string): InstanceRecord {
    const instance = this.store.get().instances.find((i) => i.id === id)
    if (!instance) throw new Error('实例不存在或已被移除')
    return instance
  }

  async view(instance: InstanceRecord): Promise<InstanceView> {
    let counts = { mods: 0, disabled: 0 }
    if (this.demo) {
      counts =
        instance.slug === 'crimson-depths'
          ? { mods: 9, disabled: 2 }
          : instance.slug === 'frostbound'
            ? { mods: 9, disabled: 2 }
            : { mods: 0, disabled: 0 }
    } else {
      counts = await this.mods.quickCounts(instance).catch(() => counts)
    }
    const cfg = this.store.get()
    const gameDir = gameDataDirFor(instance)
    return {
      ...instance,
      gameDir,
      installDir: gameDirFor(instance),
      resolvedLaunchMode: resolveLaunchMode(instance),
      effective: mergeSettings(cfg.global, instance.overrides),
      isCustomDir: !!instance.customDir,
      modCount: counts.mods,
      disabledModCount: counts.disabled,
      lastLaunch: this.launch.getLast(instance.id) ?? cfg.lastLaunches?.[instance.id]
    }
  }

  async all(): Promise<InstanceView[]> {
    const cfg = this.store.get()
    return await Promise.all(cfg.instances.map((i) => this.view(i)))
  }

  async create(input: CreateInstanceInput): Promise<InstanceView> {
    if (!input.name.trim()) throw new Error('请给实例起一个名字')
    if (!input.mcVersion) throw new Error('请选择 Minecraft 版本')
    if (input.loader.type !== 'vanilla' && !input.loader.version) throw new Error('请选择加载器版本')
    const loader = input.loader.type === 'vanilla' ? { type: 'vanilla' as const, version: input.mcVersion } : input.loader
    const created = this.store.createInstance({
      name: input.name,
      description: input.description,
      emblem: input.emblem,
      accent: input.accent,
      mcVersion: input.mcVersion,
      loader,
      modpack: input.modpack,
      customDir: input.customDir ? path.resolve(input.customDir) : undefined,
      importedFrom: input.importedFrom,
      launchMode: input.launchMode,
      localVersionId: input.localVersionId,
      localVersionDir: input.localVersionDir ? path.resolve(input.localVersionDir) : undefined,
      localGameRoot: input.localGameRoot ? path.resolve(input.localGameRoot) : undefined,
      localIsolated: input.localIsolated,
      sourceLauncher: input.sourceLauncher
    })
    if (input.memoryMax) {
      this.store.updateInstance(created.id, {
        overrides: { memoryMax: Math.max(1024, Math.min(65536, input.memoryMax)) }
      })
    }
    const instance = this.find(created.id)
    if (!this.demo) {
      await ensureInstanceDirectory(instance)
      await this.gameSettings.applyDefaults(instance).catch((err) => {
        console.warn('[instances] failed to apply unified game options:', err)
      })
    }
    return this.view(instance)
  }

  async update(id: string, patch: UpdateInstancePatch): Promise<InstanceView> {
    const instance = this.find(id)
    if (patch.customDir !== undefined) {
      const target = patch.customDir ? path.resolve(patch.customDir) : null
      if (target) {
        if (!path.isAbsolute(target)) throw new Error('实例目录必须是绝对路径')
        if (isSubPath(gameDirFor(instance), target) || isSubPath(target, gameDirFor(instance))) {
          throw new Error('新目录不能位于当前实例目录内部')
        }
      }
      await this.relocate(instance, target)
      patch = { ...patch, customDir: target ?? undefined }
      if (!target) delete patch.customDir
    }
    const updated = this.store.updateInstance(id, patch as Partial<InstanceRecord>)
    if (!updated) throw new Error('更新实例失败')
    if (!this.demo) await ensureInstanceDirectory(updated)
    return this.view(updated)
  }

  private async relocate(instance: InstanceRecord, target: string | null): Promise<void> {
    const oldReal = gameDirFor(instance)
    const newReal = target ?? defaultGameDir(instance.slug)
    if (path.resolve(oldReal) === path.resolve(newReal)) return
    await fsp.mkdir(newReal, { recursive: true })
    if (await pathExists(oldReal)) {
      await moveDirectoryContents(oldReal, newReal)
    }
    if (instance.customDir) {
      const link = instanceLinkPath(instance)
      try {
        const stat = await fsp.lstat(link)
        if (stat.isSymbolicLink()) await fsp.unlink(link)
      } catch {
      }
      if (oldReal !== instanceLinkPath(instance)) {
        await fsp.rmdir(oldReal).catch(() => undefined)
      }
    } else if (!instance.customDir && oldReal === defaultGameDir(instance.slug)) {
      await fsp.rmdir(oldReal).catch(() => undefined)
    }
    this.store.updateInstance(instance.id, { customDir: target ?? undefined })
    await ensureInstanceDirectory(this.find(instance.id))
  }

  async chooseDirectory(id: string): Promise<InstanceView | null> {
    const instance = this.find(id)
    const result = await dialog.showOpenDialog({
      title: '选择实例存储目录',
      defaultPath: this.store.get().lastFolderDir || gameDirFor(instance),
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || !result.filePaths[0]) return null
    this.store.update((cfg) => {
      cfg.lastFolderDir = result.filePaths[0]
    })
    return this.update(id, { customDir: result.filePaths[0] })
  }

  async remove(id: string): Promise<void> {
    const instance = this.find(id)
    if (instance.customDir) {
      const link = instanceLinkPath(instance)
      try {
        const stat = await fsp.lstat(link)
        if (stat.isSymbolicLink()) {
          const real = await fsp.realpath(link).catch(() => '')
          if (!real || path.resolve(real) === path.resolve(instance.customDir)) {
            await fsp.unlink(link)
          }
        }
      } catch {
        /* the link may already be gone */
      }
    }
    this.store.removeInstance(id)
  }

  async openDir(id: string): Promise<void> {
    const instance = this.find(id)
    const dir = await ensureGameDataDir(instance)
    const { shell } = await import('electron')
    await shell.openPath(dir)
  }

  async size(id: string): Promise<number> {
    const instance = this.find(id)
    const dir = gameDataDirFor(instance)
    if (!fs.existsSync(dir)) return 0
    const { directorySize } = await import('./paths')
    return await directorySize(dir)
  }

  async revealMods(id: string): Promise<void> {
    const instance = this.find(id)
    const dir = path.join(await ensureGameDataDir(instance), 'mods')
    await fsp.mkdir(dir, { recursive: true })
    const { shell } = await import('electron')
    await shell.openPath(dir)
  }

  private safeExportName(value: string): string {
    return value.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim() || 'instance'
  }

  private async sha1(file: string): Promise<string> {
    const hash = createHash('sha1')
    for await (const chunk of fs.createReadStream(file)) hash.update(chunk as Buffer)
    return hash.digest('hex')
  }

  private async exportPath(title: string, defaultName: string, filters: Electron.FileFilter[]): Promise<string | null> {
    const forced = process.env.ELYTRA_EXPORT_DIR
    if (forced) {
      await fsp.mkdir(forced, { recursive: true })
      return path.join(forced, defaultName)
    }
    const result = await dialog.showSaveDialog({
      title,
      defaultPath: path.join(this.store.get().lastExportDir || app.getPath('documents'), defaultName),
      filters
    })
    if (result.canceled || !result.filePath) return null
    const target = result.filePath
    this.store.update((cfg) => {
      cfg.lastExportDir = path.dirname(target)
    })
    return target
  }

  async listSaves(id: string): Promise<{ name: string; size: number; modifiedAt: number }[]> {
    const instance = this.find(id)
    const saves = path.join(gameDataDirFor(instance), 'saves')
    if (!fs.existsSync(saves)) return []
    const entries = await fsp.readdir(saves, { withFileTypes: true })
    const result = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const full = path.join(saves, entry.name)
      try {
        const stat = await fsp.stat(full)
        const { directorySize } = await import('./paths')
        result.push({ name: entry.name, size: await directorySize(full), modifiedAt: stat.mtimeMs })
      } catch {
        /* skip broken save */
      }
    }
    return result.sort((a, b) => b.modifiedAt - a.modifiedAt)
  }

  async exportSaves(id: string, selected?: string[]): Promise<string | null> {
    const instance = this.find(id)
    const root = gameDataDirFor(instance)
    const saves = path.join(root, 'saves')
    if (!fs.existsSync(saves)) throw new Error('当前实例没有 saves 目录')
    const all = await fsp.readdir(saves, { withFileTypes: true })
    const folders = all.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
    if (!folders.length) throw new Error('saves 目录是空的')
    const wanted = selected?.length ? folders.filter((name) => selected.includes(name)) : folders
    if (!wanted.length) throw new Error('没有选择存档')
    const stamp = new Date().toISOString().slice(0, 10)
    const target = await this.exportPath(
      '导出存档 ZIP',
      `${this.safeExportName(instance.name)}-saves-${stamp}.zip`,
      [{ name: 'ZIP 压缩包', extensions: ['zip'] }]
    )
    if (!target) return null
    const zip = new AdmZip()
    for (const folder of wanted) {
      const full = path.join(saves, folder)
      if (!isSubPath(saves, full)) continue
      zip.addLocalFolder(full, path.posix.join('saves', folder))
    }
    zip.writeZip(target)
    return target
  }

  async exportInfo(id: string): Promise<string | null> {
    const instance = this.find(id)
    const scan = await this.mods.scan(instance)
    const stamp = new Date()
    const enabled = scan.mods.filter((mod) => mod.enabled)
    const disabled = scan.mods.filter((mod) => !mod.enabled)
    const lines = [
      'ELYTRA 实例信息导出',
      '====================',
      `导出时间：${stamp.toLocaleString('zh-CN', { hour12: false })}`,
      `启动器：ELYTRA ${app.getVersion()}`,
      `实例名称：${instance.name}`,
      `实例 ID：${instance.id}`,
      `Minecraft：${instance.mcVersion}`,
      `模组加载器：${instance.loader.type} ${instance.loader.version}`,
      `启动方式：${instance.launchMode ?? 'auto'}`,
      `游戏目录：${gameDataDirFor(instance)}`,
      '',
      `已启用模组（${enabled.length}）`,
      '--------------------',
      ...(enabled.length
        ? enabled.map((mod, index) => `${index + 1}. ${mod.name} ${mod.version} [${mod.loader}] ${mod.fileName}`)
        : ['（无）']),
      '',
      `已禁用模组（${disabled.length}）`,
      '--------------------',
      ...(disabled.length ? disabled.map((mod, index) => `${index + 1}. ${mod.name} ${mod.version} ${mod.fileName}`) : ['（无）'])
    ]
    const target = await this.exportPath(
      '导出实例信息',
      `${this.safeExportName(instance.name)}-info-${stamp.toISOString().slice(0, 10)}.txt`,
      [{ name: '文本文件', extensions: ['txt'] }]
    )
    if (!target) return null
    await fsp.writeFile(target, `${lines.join('\n')}\n`, 'utf8')
    return target
  }

  async exportModpackManifest(id: string): Promise<string | null> {
    const instance = this.find(id)
    const { manifest } = await this.buildCurseForgeExport(instance)
    const target = await this.exportPath(
      '导出 CurseForge manifest.json',
      `${this.safeExportName(instance.name)}-manifest.json`,
      [{ name: 'CurseForge 整合包清单', extensions: ['json'] }]
    )
    if (!target) return null
    await fsp.writeFile(target, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
    return target
  }

  async exportModpackZip(id: string): Promise<string | null> {
    const instance = this.find(id)
    const { manifest, unknown, scan } = await this.buildCurseForgeExport(instance)
    const target = await this.exportPath(
      '导出 CurseForge 整合包 ZIP',
      `${this.safeExportName(instance.name)}-curseforge.zip`,
      [{ name: 'CurseForge 整合包', extensions: ['zip'] }]
    )
    if (!target) return null
    const zip = new AdmZip()
    zip.addFile('manifest.json', Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8'))
    zip.addFile(
      'modlist.html',
      Buffer.from(
        `<ul>\n${scan.mods
          .filter((mod) => mod.enabled)
          .map((mod) => `  <li>${mod.name} ${mod.version} (${mod.fileName})</li>`)
          .join('\n')}\n</ul>\n`,
        'utf8'
      )
    )
    for (const mod of unknown) {
      const source = path.join(scan.modsDir, mod.fileName)
      if (fs.existsSync(source)) zip.addLocalFile(source, 'overrides/mods')
    }
    zip.writeZip(target)
    return target
  }

  private async buildCurseForgeExport(instance: InstanceRecord): Promise<{
    manifest: Record<string, unknown>
    unknown: { fileName: string }[]
    scan: Awaited<ReturnType<ModService['scan']>>
  }> {
    const scan = await this.mods.scan(instance)
    const cachePath = path.join(gameDataDirFor(instance), '.elytra-modpack-manifest.json')
    const cached = await fsp.readFile(cachePath, 'utf8').catch(() => '')
    const mapped = new Map<string, { projectID: number; fileID: number }>()
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as {
          files?: { name?: string; curseforgeProjectID?: number; curseforgeFileID?: number }[]
        }
        for (const file of parsed.files ?? []) {
          if (file.name && file.curseforgeProjectID && file.curseforgeFileID) {
            mapped.set(file.name, { projectID: file.curseforgeProjectID, fileID: file.curseforgeFileID })
          }
        }
      } catch {
        /* ignore invalid cache */
      }
    }
    const enabled = scan.mods.filter((mod) => mod.enabled)
    const files: { projectID: number; fileID: number; required: boolean; isLocked: boolean }[] = []
    const unknown: { fileName: string }[] = []
    for (const mod of enabled) {
      const ids = mapped.get(mod.fileName)
      if (ids) {
        files.push({ projectID: ids.projectID, fileID: ids.fileID, required: true, isLocked: false })
      } else {
        unknown.push({ fileName: mod.fileName })
      }
    }
    const settings = mergeSettings(this.store.get().global, instance.overrides)
    const elytraFiles = enabled.map((mod) => {
      const fullPath = path.join(scan.modsDir, mod.fileName)
      let sha1 = ''
      try {
        sha1 = createHash('sha1').update(fs.readFileSync(fullPath)).digest('hex')
      } catch {
        /* missing file */
      }
      return {
        fileName: mod.fileName,
        name: mod.name,
        version: mod.version,
        size: mod.size,
        sha1
      }
    })
    const manifest = {
      minecraft: {
        version: instance.mcVersion,
        modLoaders:
          instance.loader.type === 'vanilla'
            ? []
            : [{ id: `${instance.loader.type}-${instance.loader.version}`, primary: true }],
        recommendedRam: settings.memoryMax
      },
      manifestType: 'minecraftModpack',
      manifestVersion: 1,
      name: instance.name,
      version: '1.0.0',
      author: 'ELYTRA',
      overrides: 'overrides',
      files,
      elytraFiles
    }
    return { manifest, unknown, scan }
  }

  async exportModrinthList(id: string): Promise<string | null> {
    const instance = this.find(id)
    const scan = await this.mods.scan(instance)
    let manifest: Record<string, any> = {}
    try {
      const parsed = JSON.parse(await fsp.readFile(path.join(gameDataDirFor(instance), '.ember-modrinth.json'), 'utf8'))
      manifest = parsed?.downloads ?? {}
    } catch {
      /* untracked mods are still exported */
    }
    const files: Record<string, unknown>[] = []
    for (const mod of scan.mods.filter((item) => item.enabled)) {
      const file = path.join(scan.modsDir, mod.fileName)
      if (!fs.existsSync(file)) continue
      const tracked = manifest[mod.fileName]
      files.push({
        path: `mods/${mod.fileName}`,
        hashes: { sha1: await this.sha1(file) },
        env: { client: 'required', server: 'unsupported' },
        downloads: [],
        ...(tracked ? { 'x-elytra-project': tracked.projectId, 'x-elytra-version': tracked.versionId } : {})
      })
    }
    const index = {
      formatVersion: 1,
      game: 'minecraft',
      versionId: instance.mcVersion,
      name: instance.name,
      summary: `ELYTRA enabled mod export · ${new Date().toLocaleString('zh-CN', { hour12: false })}`,
      files,
      dependencies: {
        minecraft: instance.mcVersion,
        ...(instance.loader.type !== 'vanilla' ? { [instance.loader.type]: instance.loader.version } : {})
      }
    }
    const target = await this.exportPath(
      '导出 Modrinth 模组列表',
      `${this.safeExportName(instance.name)}-modrinth.index.json`,
      [{ name: 'Modrinth 索引 JSON', extensions: ['json'] }]
    )
    if (!target) return null
    await fsp.writeFile(target, `${JSON.stringify(index, null, 2)}\n`, 'utf8')
    return target
  }
}
