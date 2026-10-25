import { contextBridge, ipcRenderer } from 'electron'
import type {
  BootstrapData,
  CrashSource,
  EmberAPI,
  LaunchEvent,
  ModpackRef,
  SaveEntry,
  SettingsOverride,
  ThemeMode,
  UpdateInstancePatch
} from '../shared/types'

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> => ipcRenderer.invoke(channel, ...args)

const api: EmberAPI = {
  bootstrap: () => invoke<BootstrapData>('bootstrap'),
  app: {
    minimize: () => void ipcRenderer.invoke('app:minimize'),
    toggleMaximize: () => void ipcRenderer.invoke('app:toggle-maximize'),
    close: () => void ipcRenderer.invoke('app:close'),
    isMaximized: () => invoke<boolean>('app:is-maximized'),
    onMaximizeChange: (cb) => {
      const listener = (_event: unknown, maximized: boolean) => cb(maximized)
      ipcRenderer.on('window:maximized', listener)
      return () => ipcRenderer.removeListener('window:maximized', listener)
    },
    onAutoLaunch: (cb) => {
      const listener = (_event: unknown, instanceId: string) => cb(instanceId)
      ipcRenderer.on('app:auto-launch', listener)
      return () => ipcRenderer.removeListener('app:auto-launch', listener)
    },
    setTheme: (theme: ThemeMode) => invoke<void>('app:set-theme', theme),
    setThemeSchedule: (schedule) => invoke('app:set-theme-schedule', schedule),
    completeOnboarding: () => invoke<void>('app:complete-onboarding'),
    openPath: (target) => invoke<string>('app:open-path', target),
    showItem: (target) => invoke<void>('app:show-item', target),
    pickFile: (options) => invoke<string | null>('app:pick-file', options),
    pickDirectory: (title) => invoke<string | null>('app:pick-directory', title),
    saveText: (defaultName, content) => invoke<string | null>('app:save-text', defaultName, content),
    openExternal: (url) => invoke<void>('app:open-external', url),
    system: () => invoke('app:system'),
    showNotification: (title, body) => invoke<void>('app:notify', title, body)
  },
  instances: {
    create: (input) => invoke('instances:create', input),
    update: (id: string, patch: UpdateInstancePatch) => invoke('instances:update', id, patch),
    remove: (id) => invoke<void>('instances:remove', id),
    setActive: (id) => invoke<void>('instances:set-active', id),
    openDir: (id) => invoke<void>('instances:open-dir', id),
    size: (id) => invoke<number>('instances:size', id),
    revealMods: (id) => invoke<void>('instances:reveal-mods', id),
    selectCustomDir: (id) => invoke('instances:select-dir', id),
    exportSaves: (id, selected) => invoke<string | null>('instances:export-saves', id, selected),
    listSaves: (id) => invoke<SaveEntry[]>('instances:list-saves', id),
    exportInfo: (id) => invoke<string | null>('instances:export-info', id),
    exportModrinthList: (id) => invoke<string | null>('instances:export-modrinth', id),
    exportModpackManifest: (id) => invoke<string | null>('instances:export-modpack-manifest', id),
    exportModpackZip: (id) => invoke<string | null>('instances:export-modpack-zip', id),
    createShortcut: (id) => invoke<string>('instances:create-shortcut', id)
  },
  settings: {
    updateGlobal: (patch: SettingsOverride) => invoke('settings:update-global', patch),
    resetInstance: (id) => invoke('settings:reset-instance', id)
  },
  launch: {
    start: (id) => invoke('launch:start', id),
    cancel: () => invoke('launch:cancel'),
    stop: () => invoke<{ stopped: boolean }>('launch:stop'),
    state: () => invoke('launch:state'),
    onEvent: (cb) => {
      const listener = (_event: unknown, payload: LaunchEvent) => cb(payload)
      ipcRenderer.on('launch:event', listener)
      return () => ipcRenderer.removeListener('launch:event', listener)
    }
  },
  versions: {
    minecraft: (force) => invoke('versions:minecraft', force),
    loaders: (mcVersion, type, force) => invoke('versions:loaders', mcVersion, type, force),
    java: () => invoke('versions:java'),
    validateJava: (javaPath) => invoke('versions:validate-java', javaPath)
  },
  auth: {
    accounts: () => invoke('auth:accounts'),
    active: () => invoke('auth:active'),
    loginOffline: (username) => invoke('auth:login-offline', username),
    loginMicrosoft: () => invoke('auth:login-microsoft'),
    loginYggdrasil: (input) => invoke('auth:login-yggdrasil', input),
    setActive: (id) => invoke('auth:set-active', id),
    logout: (id) => invoke<void>('auth:logout', id)
  },
  skin: {
    get: (reload) => invoke('skin:get', reload),
    upload: (filePath, variant) => invoke<void>('skin:upload', filePath, variant),
    switchCape: (capeId) => invoke<void>('skin:switch-cape', capeId),
    hideCape: () => invoke<void>('skin:hide-cape'),
    deleteCape: () => invoke<void>('skin:delete-cape'),
    importLocal: (kind) => invoke('skin:import-local', kind),
    applyLocal: (kind, fileId) => invoke('skin:apply-local', kind, fileId),
    installSupport: () => invoke('skin:install-support'),
    openLocal: (kind) => invoke<void>('skin:open-local', kind),
    saveSchedule: (schedule) => invoke('skin:save-schedule', schedule),
    applySchedule: () => invoke('skin:apply-schedule')
  },
  mods: {
    scan: (instanceId) => invoke('mods:scan', instanceId),
    toggle: (instanceId, fileName, enable) => invoke('mods:toggle', instanceId, fileName, enable),
    reorder: (instanceId, order) => invoke('mods:reorder', instanceId, order),
    remove: (instanceId, fileName) => invoke('mods:remove', instanceId, fileName)
  },
  modLibrary: {
    list: (instanceId) => invoke('modLibrary:list', instanceId),
    importLocal: () => invoke('modLibrary:import-local'),
    importUrl: (url) => invoke('modLibrary:import-url', url),
    toggle: (instanceId, id, enabled) => invoke('modLibrary:toggle', instanceId, id, enabled),
    remove: (id) => invoke('modLibrary:remove', id),
    open: () => invoke('modLibrary:open')
  },
  gameUpdates: {
    check: () => invoke('gameUpdates:check')
  },
  updates: {
    check: () => invoke('updates:check'),
    download: (info) => invoke('updates:download', info),
    install: (file) => invoke('updates:install', file)
  },
  maintenance: {
    scan: () => invoke('maintenance:scan'),
    clean: (ids) => invoke('maintenance:clean', ids),
    purge: (includeInstances) => invoke('maintenance:purge', includeInstances),
    uninstall: () => invoke<void>('maintenance:uninstall')
  },
  crash: {
    sources: (instanceId) => invoke<CrashSource[]>('crash:sources', instanceId),
    analyze: (instanceId, sourcePath) => invoke('crash:analyze', instanceId, sourcePath),
    history: (instanceId) => invoke('crash:history', instanceId),
    reveal: (sourcePath) => invoke<void>('crash:reveal', sourcePath)
  },
  modpack: {
    inspect: (ref: ModpackRef) => invoke('modpack:inspect', ref),
    pick: () => invoke('modpack:pick'),
    import: (input) => invoke('modpack:import', input)
  },
  library: {
    scan: (root?: string) => invoke('library:scan', root),
    browse: () => invoke<string | null>('library:browse'),
    import: (input) => invoke('library:import', input)
  },
  gameSettings: {
    update: (values) => invoke('gameSettings:update', values),
    read: (instanceId) => invoke('gameSettings:read', instanceId),
    apply: (instanceIds) => invoke('gameSettings:apply', instanceIds)
  },
  modrinth: {
    tags: () => invoke('modrinth:tags'),
    search: (filters) => invoke('modrinth:search', filters),
    versions: (projectId, filters) => invoke('modrinth:versions', projectId, filters),
    download: (instanceId, projectId, title, kind, versionId, releaseType) =>
      invoke('modrinth:download', instanceId, projectId, title, kind, versionId, releaseType),
    updates: (instanceId) => invoke('modrinth:updates', instanceId),
    downloadUpdate: (instanceId, update) => invoke('modrinth:download-update', instanceId, update),
    openFolder: (instanceId, kind) => invoke<void>('modrinth:open-folder', instanceId, kind),
    simulateUpdate: (instanceId) => invoke('modrinth:simulate-update', instanceId),
    onProgress: (callback) => {
      const listener = (_event: unknown, progress: Parameters<typeof callback>[0]) => callback(progress)
      ipcRenderer.on('modrinth:progress', listener)
      return () => ipcRenderer.removeListener('modrinth:progress', listener)
    }
  },
  demo: {
    enabled: false,
    launch: () => void ipcRenderer.invoke('launch:start', 'crimson-depths')
  }
}

contextBridge.exposeInMainWorld('ember', api)
