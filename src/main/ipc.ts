import {
  BrowserWindow,
  Notification,
  app,
  dialog,
  ipcMain,
  shell
} from 'electron'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'
import type {
  AppConfig,
  CreateInstanceInput,
  InstanceView,
  ModpackImportInput,
  PublicConfig,
  SettingsOverride,
  SystemInfo,
  ThemeMode,
  UpdateInstancePatch
} from '../shared/types'
import type { ConfigStore } from './store'
import { publicAccount } from './store'
import type { AuthService } from './auth'
import type { InstanceService } from './instances'
import type { LaunchService } from './launch'
import type { ModService } from './mods'
import type { ModLibraryService } from './mod-library'
import type { CrashService } from './crash'
import type { ModpackService } from './modpack'
import type { SkinService } from './skin'
import type { VersionService } from './versions'
import type { LibraryService } from './library'
import type { GameSettingsService } from './game-settings'
import type { ModrinthService } from './modrinth'
import type { MaintenanceService } from './maintenance'
import type { GameUpdateService } from './game-updates'
import type { UpdateService } from './update-service'
import { configureDownload } from './download-optimizer'
import { defaultGameDir, gameDataDirFor } from './paths'

interface IpcContext {
  store: ConfigStore
  auth: AuthService
  instances: InstanceService
  launch: LaunchService
  mods: ModService
  modLibrary: ModLibraryService
  maintenance: MaintenanceService
  gameUpdates: GameUpdateService
  updates: UpdateService
  crash: CrashService
  modpack: ModpackService
  skin: SkinService
  versions: VersionService
  library: LibraryService
  gameSettings: GameSettingsService
  modrinth: ModrinthService
  getWindow: () => BrowserWindow | null
  demo: boolean
}

export function publicConfig(store: ConfigStore): PublicConfig {
  const cfg = store.get()
  const { accounts, ...rest } = cfg
  return { ...rest, accounts: accounts.map(publicAccount) }
}

export function systemInfo(): SystemInfo {
  const cpus = os.cpus()
  return {
    platform: process.platform,
    arch: process.arch,
    release: os.release(),
    cpu: cpus[0]?.model?.trim() || 'Unknown CPU',
    cores: cpus.length,
    totalMemMb: Math.round(os.totalmem() / 1024 / 1024),
    freeMemMb: Math.round(os.freemem() / 1024 / 1024),
    appVersion: app.getVersion(),
    electron: process.versions.electron ?? '',
    node: process.versions.node,
    locale: app.getLocale(),
    dataDir: process.env.ELYTRA_DISPLAY_DATA_DIR || app.getPath('userData'),
    defaultGameRoot: path.dirname(defaultGameDir('placeholder'))
  }
}

export function registerIpc(ctx: IpcContext): void {
  const { store, auth, instances, launch, mods, modLibrary, maintenance, gameUpdates, updates, crash, modpack, skin, versions, library, gameSettings, modrinth } = ctx

  ipcMain.handle('bootstrap', async () => {
    const views = await instances.all()
    return {
      config: publicConfig(store),
      instances: views,
      system: systemInfo(),
      activeInstanceId: store.get().activeInstanceId,
      activeAccount: auth.activeAccountForRenderer(),
      launch: launch.getState(),
      version: app.getVersion(),
      demo: ctx.demo
    }
  })

  ipcMain.handle('app:minimize', () => ctx.getWindow()?.minimize())
  ipcMain.handle('app:toggle-maximize', () => {
    const win = ctx.getWindow()
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
  ipcMain.handle('app:close', () => ctx.getWindow()?.close())
  ipcMain.handle('app:is-maximized', () => ctx.getWindow()?.isMaximized() ?? false)
  ipcMain.handle('app:set-theme', (_event, theme: ThemeMode) => {
    if (!['dark', 'light', 'system'].includes(theme)) throw new Error('Invalid theme')
    store.setTheme(theme)
  })
  ipcMain.handle('app:set-theme-schedule', (_event, schedule: any) => store.updateThemeSchedule(schedule))
  ipcMain.handle('app:complete-onboarding', () => store.completeOnboarding())
  ipcMain.handle('app:open-path', async (_event, target: string) => {
    if (typeof target !== 'string' || !target) return '无效路径'
    return await shell.openPath(target)
  })
  ipcMain.handle('app:show-item', (_event, target: string) => {
    if (typeof target === 'string' && fs.existsSync(target)) shell.showItemInFolder(target)
  })
  ipcMain.handle('app:pick-file', async (_event, options?: { title?: string; filters?: { name: string; extensions: string[] }[] }) => {
    const result = await dialog.showOpenDialog({
      title: options?.title ?? '选择文件',
      filters: options?.filters,
      properties: ['openFile']
    })
    return result.canceled ? null : result.filePaths[0] ?? null
  })
  ipcMain.handle('app:pick-directory', async (_event, title?: string) => {
    const result = await dialog.showOpenDialog({
      title: title ?? '选择目录',
      defaultPath: store.get().lastFolderDir,
      properties: ['openDirectory', 'createDirectory']
    })
    const target = result.canceled ? null : result.filePaths[0] ?? null
    if (target) store.update((cfg) => { cfg.lastFolderDir = target })
    return target
  })
  ipcMain.handle('app:save-text', async (_event, defaultName: string, content: string) => {
    const result = await dialog.showSaveDialog({ defaultPath: defaultName })
    if (result.canceled || !result.filePath) return null
    await fsp.writeFile(result.filePath, content, 'utf8')
    return result.filePath
  })
  ipcMain.handle('app:open-external', async (_event, url: string) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) throw new Error('只允许打开 http(s) 链接')
    await shell.openExternal(url)
  })
  ipcMain.handle('app:system', () => systemInfo())
  ipcMain.handle('app:notify', (_event, title: string, body: string) => {
    if (Notification.isSupported()) new Notification({ title, body }).show()
  })

  ipcMain.handle('instances:create', async (_event, input: CreateInstanceInput) => instances.create(input))
  ipcMain.handle('instances:update', async (_event, id: string, patch: UpdateInstancePatch) => instances.update(id, patch))
  ipcMain.handle('instances:remove', async (_event, id: string) => {
    const state = launch.getState()
    if (state.instanceId === id && ['launching', 'running'].includes(state.status)) {
      throw new Error('实例正在运行，退出游戏后再移除')
    }
    await instances.remove(id)
  })
  ipcMain.handle('instances:set-active', (_event, id: string) => store.setActiveInstance(id))
  ipcMain.handle('instances:create-shortcut', async (_event, id: string) => {
    const instance = instances.find(id)
    const desktop = app.getPath('desktop')
    const safeName = instance.name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 48) || 'Minecraft'
    const target = path.join(desktop, `${safeName}.lnk`)
    const args = app.isPackaged ? `--instance ${instance.id} --launch` : `"${app.getAppPath()}" --instance ${instance.id} --launch`
    const ok = shell.writeShortcutLink(target, 'create', {
      target: process.execPath,
      args,
      cwd: path.dirname(process.execPath),
      description: `通过 ELYTRA 启动 ${instance.name}`,
      icon: process.execPath,
      iconIndex: 0
    })
    if (!ok) throw new Error('创建快捷方式失败')
    return target
  })
  ipcMain.handle('instances:open-dir', (_event, id: string) => instances.openDir(id))
  ipcMain.handle('instances:size', (_event, id: string) => instances.size(id))
  ipcMain.handle('instances:reveal-mods', (_event, id: string) => instances.revealMods(id))
  ipcMain.handle('instances:select-dir', (_event, id: string) => instances.chooseDirectory(id))
  ipcMain.handle('instances:export-saves', (_event, id: string, selected?: string[]) => instances.exportSaves(id, selected))
  ipcMain.handle('instances:list-saves', (_event, id: string) => instances.listSaves(id))
  ipcMain.handle('instances:export-info', (_event, id: string) => instances.exportInfo(id))
  ipcMain.handle('instances:export-modrinth', (_event, id: string) => instances.exportModrinthList(id))
  ipcMain.handle('instances:export-modpack-manifest', (_event, id: string) => instances.exportModpackManifest(id))
  ipcMain.handle('instances:export-modpack-zip', (_event, id: string) => instances.exportModpackZip(id))

  ipcMain.handle('settings:update-global', (_event, patch: SettingsOverride) => {
    store.updateGlobal(patch)
    const global = store.get().global
    configureDownload({
      threads: global.downloadThreads,
      smartMirror: global.smartDownload,
      maxSpeed: global.downloadLimit * 1024 * 1024
    })
    return publicConfig(store)
  })
  ipcMain.handle('settings:reset-instance', async (_event, id: string) => {
    const instance = instances.find(id)
    store.updateInstance(id, { overrides: {} })
    return await instances.view({ ...instance, overrides: {} })
  })

  ipcMain.handle('launch:start', async (_event, id: string) => {
    const instance = instances.find(id)
    return await launch.start(instance)
  })
  ipcMain.handle('launch:cancel', () => launch.cancel())
  ipcMain.handle('launch:stop', () => launch.stopGame())
  ipcMain.handle('launch:state', () => launch.getState())

  ipcMain.handle('versions:minecraft', (_event, force?: boolean) => versions.minecraft(!!force))
  ipcMain.handle('versions:loaders', (_event, mcVersion: string, type: any, force?: boolean) => {
    if (typeof mcVersion !== 'string' || !mcVersion) throw new Error('缺少 Minecraft 版本')
    return versions.loaders(mcVersion, type, !!force)
  })
  ipcMain.handle('versions:java', () => versions.detectJava())
  ipcMain.handle('versions:validate-java', (_event, javaPath: string) => versions.validateJava(javaPath))

  ipcMain.handle('auth:accounts', () => store.get().accounts.map(publicAccount))
  ipcMain.handle('auth:active', () => auth.activeAccountForRenderer())
  ipcMain.handle('auth:login-offline', (_event, username: string) => auth.loginOffline(username))
  ipcMain.handle('auth:login-microsoft', () => auth.loginMicrosoft())
  ipcMain.handle('auth:login-yggdrasil', (_event, input: { url: string; username: string; password: string; profileId?: string; profileName?: string }) =>
    auth.loginYggdrasil(input)
  )
  ipcMain.handle('auth:set-active', (_event, id: string) => auth.setActive(id))
  ipcMain.handle('auth:logout', (_event, id: string) => auth.logout(id))

  ipcMain.handle('skin:get', (_event, reload?: boolean) => skin.get(!!reload))
  ipcMain.handle('skin:upload', (_event, filePath?: string, variant?: 'classic' | 'slim') => skin.upload(filePath, variant))
  ipcMain.handle('skin:switch-cape', (_event, capeId: string) => skin.switchCape(capeId))
  ipcMain.handle('skin:hide-cape', () => skin.hideCape())
  ipcMain.handle('skin:delete-cape', () => skin.deleteCape())
  ipcMain.handle('skin:import-local', (_event, kind: 'skin' | 'cape') => skin.importLocal(kind))
  ipcMain.handle('skin:apply-local', (_event, kind: 'skin' | 'cape', fileId: string) => skin.applyLocal(kind, fileId))
  ipcMain.handle('skin:install-support', () => skin.installSupport())
  ipcMain.handle('skin:open-local', (_event, kind?: 'skin' | 'cape') => skin.openLocal(kind))
  ipcMain.handle('skin:save-schedule', (_event, schedule: any) => skin.saveSchedule(schedule))
  ipcMain.handle('skin:apply-schedule', () => skin.applySchedule())

  ipcMain.handle('mods:scan', async (_event, id: string) => mods.scan(instances.find(id)))
  ipcMain.handle('mods:toggle', async (_event, id: string, fileName: string, enable: boolean) => {
    return await mods.toggle(instances.find(id), fileName, !!enable)
  })
  ipcMain.handle('mods:reorder', async (_event, id: string, order: string[]) => {
    if (!Array.isArray(order) || order.some((x) => typeof x !== 'string')) throw new Error('无效排序')
    const instance = instances.find(id)
    store.updateInstance(id, { modOrder: order })
    return await mods.scan({ ...instance, modOrder: order })
  })
  ipcMain.handle('mods:remove', async (_event, id: string, fileName: string) => {
    return await mods.remove(instances.find(id), fileName)
  })
  ipcMain.handle('modLibrary:list', async (_event, id?: string) => modLibrary.list(id ? instances.find(id) : undefined))
  ipcMain.handle('modLibrary:import-local', () => modLibrary.importLocal())
  ipcMain.handle('modLibrary:import-url', (_event, url: string) => modLibrary.importUrl(url))
  ipcMain.handle('modLibrary:toggle', (_event, id: string, entryId: string, enabled: boolean) =>
    modLibrary.toggle(instances.find(id), entryId, !!enabled)
  )
  ipcMain.handle('modLibrary:remove', (_event, entryId: string) => modLibrary.remove(entryId))
  ipcMain.handle('modLibrary:open', () => modLibrary.open())
  ipcMain.handle('gameUpdates:check', () => gameUpdates.check())
  ipcMain.handle('updates:check', () => updates.check())
  ipcMain.handle('updates:download', (_event, info: any) => updates.download(info))
  ipcMain.handle('updates:install', (_event, file: string) => updates.install(file))
  ipcMain.handle('personalization:update', (_event, input: any) => {
    store.updatePersonalization(input ?? {})
    return publicConfig(store)
  })
  ipcMain.handle('maintenance:scan', () => maintenance.scan())
  ipcMain.handle('maintenance:clean', (_event, ids: string[]) =>
    maintenance.clean(Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : [])
  )
  ipcMain.handle('maintenance:purge', (_event, includeInstances: boolean) => maintenance.purge(!!includeInstances))
  ipcMain.handle('maintenance:uninstall', () => {
    if (!app.isPackaged) throw new Error('卸载按钮仅在安装版中生效')
    const dir = path.dirname(process.execPath)
    const uninstaller = ['Uninstall ELYTRA.exe', 'uninstall.exe']
      .map((name) => path.join(dir, name))
      .find((file) => fs.existsSync(file))
    if (!uninstaller) throw new Error('没有找到卸载程序，请从 Windows 应用列表卸载')
    spawn(uninstaller, [], { detached: true, stdio: 'ignore', windowsHide: false }).unref()
    setTimeout(() => app.quit(), 350)
  })

  ipcMain.handle('crash:sources', async (_event, id: string) => crash.sources(instances.find(id)))
  ipcMain.handle('crash:analyze', async (_event, id: string, sourcePath?: string) => {
    const instance = instances.find(id)
    const state = launch.getState()
    const analysis = await crash.analyze(instance, sourcePath, state.instanceId === id ? state.exitCode : undefined)
    store.addCrashHistory(analysis)
    return analysis
  })
  ipcMain.handle('crash:history', (_event, id: string) => store.crashHistory(id))
  ipcMain.handle('crash:reveal', (_event, sourcePath: string) => {
    if (typeof sourcePath === 'string' && fs.existsSync(sourcePath)) shell.showItemInFolder(sourcePath)
  })

  ipcMain.handle('modpack:inspect', (_event, ref: any) => modpack.inspect(ref))
  ipcMain.handle('modpack:pick', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择整合包清单（CurseForge manifest.json / EML）',
      filters: [{ name: '整合包清单', extensions: ['json'] }],
      properties: ['openFile']
    })
    if (result.canceled || !result.filePaths[0]) return null
    const file = result.filePaths[0]
    return { path: file, name: path.basename(file).replace(/\.json$/i, '') }
  })
  ipcMain.handle('modpack:import', async (_event, input: ModpackImportInput) => {
    if (!input || !input.ref) throw new Error('整合包信息不完整')
    const info = await modpack.inspect(input.ref)
    if (!info.valid) throw new Error(info.warnings[0] ?? '整合包清单无效')
    const isElytra = info.format === 'elytra'
    const created = await instances.create({
      name: input.name || info.name,
      description: isElytra
        ? `由 ELYTRA 模组清单导入 · ${info.fileCount} 个模组待恢复`
        : `由${info.format === 'curseforge' ? ' CurseForge ' : ' EML '}整合包清单导入 · ${info.fileCount} 个文件`,
      emblem: (input.name || info.name).slice(0, 2).toUpperCase(),
      accent: 'gold',
      mcVersion: input.mcVersion,
      loader: input.loader,
      memoryMax: info.recommendedRam,
      modpack: isElytra ? undefined : { ...input.ref, name: info.name, installed: false }
    })
    if (isElytra) {
      const targetDir = gameDataDirFor(instances.find(created.id))
      const modsDir = path.join(targetDir, 'mods')
      await fsp.mkdir(modsDir, { recursive: true })
      if (input.ref.kind === 'local' && input.ref.localPath) {
        const parent = path.dirname(input.ref.localPath)
        for (const file of info.pendingFiles ?? []) {
          const safeName = path.basename(file.fileName)
          const candidates = [
            path.join(parent, 'mods', safeName),
            path.join(parent, 'overrides', 'mods', safeName),
            path.join(parent, safeName)
          ]
          const source = candidates.find((candidate) => fs.existsSync(candidate))
          if (source) await fsp.copyFile(source, path.join(modsDir, safeName)).catch(() => undefined)
        }
      }
      await fsp.writeFile(
        path.join(targetDir, '.elytra-restore.json'),
        JSON.stringify({ importedAt: Date.now(), files: info.pendingFiles ?? [] }, null, 2),
        'utf8'
      )
    }
    return created
  })

  ipcMain.handle('library:scan', (_event, root?: string) => library.scan(typeof root === 'string' ? root : undefined))
  ipcMain.handle('library:browse', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择包含 versions 文件夹的游戏目录',
      defaultPath: store.get().lastFolderDir,
      properties: ['openDirectory']
    })
    const target = result.canceled ? null : result.filePaths[0] ?? null
    if (target) store.update((cfg) => { cfg.lastFolderDir = target })
    return target
  })
  ipcMain.handle('library:import', (_event, input: { rootPath: string; versionId: string; name: string }) => {
    if (!input?.rootPath || !input?.versionId) throw new Error('请选择要加载的版本')
    return library.import(input)
  })

  ipcMain.handle('gameSettings:update', (_event, values: Record<string, string>) => {
    store.updateGameOptions(values && typeof values === 'object' ? values : {})
    return publicConfig(store)
  })
  ipcMain.handle('gameSettings:read', (_event, instanceId: string) => gameSettings.read(instanceId))
  ipcMain.handle('gameSettings:apply', (_event, instanceIds: string[]) =>
    gameSettings.applyExisting(Array.isArray(instanceIds) ? instanceIds.filter((id) => typeof id === 'string') : [])
  )

  ipcMain.handle('modrinth:tags', () => modrinth.tags())
  ipcMain.handle('modrinth:search', (_event, filters: any) => modrinth.search(filters))
  ipcMain.handle('modrinth:versions', (_event, projectId: string, filters: any) => modrinth.versions(projectId, filters))
  ipcMain.handle(
    'modrinth:download',
    (event, instanceId: string, projectId: string, title: string, kind: any, versionId?: string, releaseType?: any) =>
      modrinth.download(instanceId, projectId, title, kind, versionId, releaseType, (progress) => {
        if (!event.sender.isDestroyed()) event.sender.send('modrinth:progress', progress)
      })
  )
  ipcMain.handle('modrinth:updates', (_event, instanceId: string) => modrinth.updates(instanceId))
  ipcMain.handle('modrinth:download-update', (event, instanceId: string, update: any) =>
    modrinth.downloadUpdate(instanceId, update, (progress) => {
      if (!event.sender.isDestroyed()) event.sender.send('modrinth:progress', progress)
    })
  )
  ipcMain.handle('modrinth:open-folder', (_event, instanceId: string, kind: any) => modrinth.openFolder(instanceId, kind))
  ipcMain.handle('modrinth:simulate-update', (_event, instanceId: string) => modrinth.simulateUpdate(instanceId))
}

export function configForRenderer(config: AppConfig): PublicConfig {
  const { accounts, ...rest } = config
  return { ...rest, accounts: accounts.map(publicAccount) }
}
