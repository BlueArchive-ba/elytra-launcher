/** Shared contracts between the Electron main process, preload bridge and renderer. */

export type ThemeMode = 'dark' | 'light' | 'system'
export type LoaderType = 'vanilla' | 'forge' | 'neoforge' | 'fabric' | 'quilt'
export type AfterLaunch = 'keep' | 'minimize' | 'tray'
export type AccentKey = 'ember' | 'frost' | 'void' | 'moss' | 'gold' | 'orchid'
export type LaunchMode = 'auto' | 'ember' | 'local'
export type ResolvedLaunchMode = 'ember' | 'local'
export type AppearanceKind = 'skin' | 'cape'

export interface AppearanceFile {
  id: string
  name: string
  path: string
  image: string
  size: number
  modifiedAt: number
  source: 'local' | 'library'
}

export interface AppearanceScheduleSlot {
  id: string
  start: string
  end: string
  skinId?: string
  capeId?: string
}

export interface AppearanceSchedule {
  enabled: boolean
  slots: AppearanceScheduleSlot[]
}

export interface ThemeSchedule {
  enabled: boolean
  lightStart: string
  darkStart: string
}

export interface LocalAppearance {
  detected: boolean
  modFile?: string
  gameDir?: string
  skinDir?: string
  capeDir?: string
  activeSkinId?: string
  activeCapeId?: string
  skins: AppearanceFile[]
  capes: AppearanceFile[]
  librarySkins: AppearanceFile[]
  libraryCapes: AppearanceFile[]
  schedule: AppearanceSchedule
}

export interface LoaderSpec {
  type: LoaderType
  version: string
}

export interface Settings {
  memoryMin: number
  memoryMax: number
  javaMode: 'auto' | 'manual'
  javaPath: string
  jvmArgs: string
  gameArgs: string
  windowWidth: number
  windowHeight: number
  fullscreen: boolean
  afterLaunch: AfterLaunch
  cleaning: boolean
  downloadThreads: number
  downloadLimit: number
  smartDownload: boolean
}

export type SettingsOverride = Partial<Settings>

export interface ModpackRef {
  kind: 'url' | 'local'
  url?: string
  localPath?: string
  name?: string
  installed?: boolean
}

export interface InstanceRecord {
  id: string
  name: string
  slug: string
  description: string
  emblem: string
  accent: AccentKey
  mcVersion: string
  loader: LoaderSpec
  modpack?: ModpackRef
  overrides: SettingsOverride
  modOrder: string[]
  customDir?: string
  importedFrom?: string
  /** auto = local for imported PCL versions, EMBER otherwise. */
  launchMode?: LaunchMode
  /** Exact version folder used by the original launcher. */
  localVersionId?: string
  localVersionDir?: string
  localGameRoot?: string
  localIsolated?: boolean
  sourceLauncher?: 'pcl' | 'official' | 'ember' | 'custom'
  pinned?: boolean
  createdAt: number
  lastPlayedAt?: number
  playtimeMs: number
}

export interface AccountPublic {
  id: string
  name: string
  uuid: string
  type: 'msa' | 'yggdrasil' | 'azuriom' | 'crack'
  online: boolean
  addedAt: number
}

export interface AccountSecret {
  accessToken: string
  clientToken: string
  refreshToken?: string
  userProperties?: unknown
  meta: { online: boolean; type: 'msa' | 'yggdrasil' | 'azuriom' | 'crack'; url?: string }
  xbox?: { xuid: string; gamertag: string; ageGroup: string }
}

export interface StoredAccount extends AccountPublic {
  /** safeStorage-encrypted base64 JSON of AccountSecret */
  secret: string
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
}

export interface AppConfig {
  schema: 1
  theme: ThemeMode
  activeInstanceId: string | null
  activeAccountId: string | null
  global: Settings
  instances: InstanceRecord[]
  accounts: StoredAccount[]
  /** Unified options.txt template. Applied to new instances/imports only. */
  gameOptions: Record<string, string>
  appearanceSchedule?: AppearanceSchedule
  themeSchedule?: ThemeSchedule
  crashHistory?: CrashHistoryEntry[]
  lastExportDir?: string
  lastFolderDir?: string
  lastLaunches?: Record<string, LastLaunchSummary>
  onboarded: boolean
  createdAt: number
  updatedAt: number
}

export type PublicConfig = Omit<AppConfig, 'accounts'> & { accounts: AccountPublic[] }

export interface InstanceView extends InstanceRecord {
  gameDir: string
  installDir: string
  resolvedLaunchMode: ResolvedLaunchMode
  effective: Settings
  isCustomDir: boolean
  modCount: number
  disabledModCount: number
  lastLaunch?: LastLaunchSummary
}

export interface LastLaunchSummary {
  at: number
  status: 'success' | 'crashed' | 'error'
  exitCode?: number
  logFile?: string
}

export interface BootstrapData {
  config: PublicConfig
  instances: InstanceView[]
  system: SystemInfo
  activeInstanceId: string | null
  activeAccount: AccountPublic | null
  launch: LaunchState
  version: string
  demo?: boolean
}

export interface SystemInfo {
  platform: string
  arch: string
  release: string
  cpu: string
  cores: number
  totalMemMb: number
  freeMemMb: number
  appVersion: string
  electron: string
  node: string
  locale: string
  dataDir: string
  defaultGameRoot: string
}

export interface MinecraftVersion {
  id: string
  type: 'release' | 'snapshot' | 'old_beta' | 'old_alpha'
  releaseTime: string
}

export interface LoaderVersion {
  version: string
  stable?: boolean
  label?: string
}

export interface JavaInfo {
  path: string
  version: string
  major: number
  arch: string
  vendor?: string
}

export type LaunchPhase =
  | 'idle'
  | 'preparing'
  | 'compute'
  | 'download'
  | 'loader'
  | 'extract'
  | 'assets'
  | 'patch'
  | 'java'
  | 'clean'
  | 'starting'
  | 'running'
  | 'success'
  | 'crashed'
  | 'error'

export interface LaunchState {
  instanceId: string | null
  instanceName?: string
  launchMode?: ResolvedLaunchMode
  status: 'idle' | 'preparing' | 'launching' | 'running' | 'success' | 'crashed' | 'error'
  phase: LaunchPhase
  progress: number
  message: string
  detail?: string
  logs: string[]
  startedAt?: number
  finishedAt?: number
  exitCode?: number
  logFile?: string
}

export interface LaunchEvent {
  type:
    | 'phase'
    | 'progress'
    | 'log'
    | 'state'
    | 'crash'
    | 'complete'
    | 'debug'
    | 'java'
    | 'loader'
    | 'error'
  state: LaunchState
  line?: string
}

export interface CreateInstanceInput {
  name: string
  description?: string
  emblem?: string
  accent?: AccentKey
  mcVersion: string
  loader: LoaderSpec
  memoryMax?: number
  modpack?: ModpackRef
  customDir?: string
  importedFrom?: string
  launchMode?: LaunchMode
  localVersionId?: string
  localVersionDir?: string
  localGameRoot?: string
  localIsolated?: boolean
  sourceLauncher?: 'pcl' | 'official' | 'ember' | 'custom'
}

export interface UpdateInstancePatch {
  name?: string
  description?: string
  emblem?: string
  accent?: AccentKey
  mcVersion?: string
  loader?: LoaderSpec
  overrides?: SettingsOverride
  modOrder?: string[]
  customDir?: string | null
  launchMode?: LaunchMode
  pinned?: boolean
}

export interface ModInfo {
  fileName: string
  enabled: boolean
  size: number
  modifiedAt: number
  id: string
  name: string
  version: string
  description: string
  authors: string[]
  loader: string
  icon?: string
  duplicate: boolean
  invalid: boolean
  error?: string
  priority: number
}

export interface ModLibraryEntry {
  id: string
  fileName: string
  name: string
  version: string
  size: number
  sha1: string
  source: 'local' | 'url'
  addedAt: number
  copied: boolean
  copiedIn: 'mods' | 'mods-disabled' | null
}

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

export interface SaveEntry {
  name: string
  size: number
  modifiedAt: number
}

export interface CleanupGroup {
  id: string
  label: string
  detail: string
  count: number
  size: number
}

export interface CleanupResult {
  removed: number
  freed: number
}

export interface ModScanResult {
  mods: ModInfo[]
  modsDir: string
  enabledCount: number
  disabledCount: number
  duplicateIds: string[]
  invalidCount: number
}

export type CrashSeverity = 'critical' | 'warning' | 'info' | 'good'

export interface CrashFinding {
  id: string
  title: string
  severity: CrashSeverity
  summary: string
  evidence: string[]
  advice: string[]
  confidence: number
}

export interface StackSuspect {
  frame: string
  className: string
  method: string
  source: string
  mod?: string
  reason: string
  score: number
}

export interface IntegrityCheck {
  id: string
  label: string
  status: 'pass' | 'warn' | 'fail' | 'skip'
  detail: string
}

export interface CrashAnalysis {
  id: string
  instanceId: string
  instanceName: string
  createdAt: number
  sourceFile: string
  sourceLabel: string
  sourceKind: 'crash-report' | 'latest-log' | 'debug-log' | 'launch-log' | 'hs-err' | 'log-archive'
  exitCode?: number
  headline: string
  severity: CrashSeverity
  confidence: number
  findings: CrashFinding[]
  suspects: StackSuspect[]
  checks: IntegrityCheck[]
  exceptions: string[]
  logTail: string[]
  byteSize: number
}

export interface CrashSource {
  path: string
  label: string
  kind: CrashAnalysis['sourceKind']
  modifiedAt: number
  size: number
  primary: boolean
}

export interface CrashHistoryEntry {
  id: string
  instanceId: string
  at: number
  analysis: CrashAnalysis
}

export interface SkinBundle {
  supported: boolean
  reason?: string
  mode?: 'account' | 'customskinloader' | 'none'
  skins: { id: string; url: string; state: 'active' | 'inactive'; variant: 'classic' | 'slim'; image: string }[]
  capes: { id: string; url: string; state: 'active' | 'inactive'; alias: string; image: string }[]
  activeCapeId: string | null
  accountType?: string
  local?: LocalAppearance
}

export interface ModpackInfo {
  source: ModpackRef
  name: string
  format?: 'eml' | 'curseforge' | 'elytra'
  fileCount: number
  totalSize: number
  hosts: string[]
  warnings: string[]
  valid: boolean
  suggestedMcVersion?: string
  suggestedLoader?: LoaderSpec
  recommendedRam?: number
  pendingFiles?: { fileName: string; name?: string; version?: string; size?: number; sha1?: string }[]
}

export interface ModpackImportInput {
  ref: ModpackRef
  name: string
  mcVersion: string
  loader: LoaderSpec
}

export interface LocalVersion {
  rootPath: string
  rootName: string
  source: 'official' | 'ember' | 'custom'
  launcher: 'pcl' | 'official' | 'ember' | 'custom'
  versionDir: string
  gameDir: string
  isolated: boolean
  id: string
  mcVersion: string
  loader: LoaderSpec
  loaderUncertain: boolean
  hasJar: boolean
  inheritsFrom?: string
  modifiedAt: number
}

export interface LocalVersionRoot {
  path: string
  name: string
  source: 'official' | 'ember' | 'custom'
  count: number
}

export interface LibraryScan {
  roots: LocalVersionRoot[]
  versions: LocalVersion[]
  scannedAt: number
}

export interface ImportGameInput {
  rootPath: string
  versionId: string
  name: string
}

export interface GameOptionsFile {
  instanceId: string
  path: string
  exists: boolean
  values: Record<string, string>
}

export interface ApplyGameOptionsResult {
  applied: number
  failed: { instanceId: string; name: string; error: string }[]
}

export type ModrinthContentType = 'mod' | 'shader' | 'resourcepack'
export type ModrinthReleaseType = 'release' | 'beta' | 'alpha'

export interface ModrinthLoaderTag {
  name: string
  supported_project_types: string[]
}

export interface ModrinthGameVersionTag {
  version: string
  version_type: 'release' | 'snapshot' | 'alpha' | 'beta'
  date: string
  major: boolean
}

export interface ModrinthTags {
  loaders: ModrinthLoaderTag[]
  gameVersions: ModrinthGameVersionTag[]
}

export interface ModrinthSearchFilters {
  query: string
  type: ModrinthContentType
  loader?: string
  gameVersion?: string
  releaseType?: ModrinthReleaseType
  offset?: number
  limit?: number
}

export interface ModrinthSearchHit {
  project_id: string
  slug: string
  title: string
  description: string
  project_type: ModrinthContentType
  icon_url?: string
  downloads: number
  follows: number
  categories: string[]
  versions: string[]
  latest_version?: string
  date_modified: string
  author?: string
  gallery?: string[]
}

export interface ModrinthSearchResult {
  hits: ModrinthSearchHit[]
  total_hits: number
  offset: number
  limit: number
}

export interface ModrinthVersionFile {
  url: string
  filename: string
  primary: boolean
  size: number
  hashes?: Record<string, string>
}

export interface ModrinthVersion {
  id: string
  project_id: string
  name: string
  version_number: string
  version_type: ModrinthReleaseType
  game_versions: string[]
  loaders: string[]
  date_published: string
  files: ModrinthVersionFile[]
  changelog?: string
}

export interface ModrinthDownloadProgress {
  fileName: string
  received: number
  total: number
  percent: number
  speed: number
  threads: number
}

export interface ModrinthDownloadResult {
  fileName: string
  path: string
  version: ModrinthVersion
  projectId: string
  projectTitle: string
  kind: ModrinthContentType
}

export interface ModrinthUpdate {
  projectId: string
  slug: string
  title: string
  kind: ModrinthContentType
  currentVersionId: string
  currentVersionNumber: string
  currentVersionType: ModrinthReleaseType
  latestVersionId: string
  latestVersionNumber: string
  latestVersionType: ModrinthReleaseType
  gameVersions: string[]
  loaders: string[]
  fileName: string
  downloadUrl: string
  gameVersionType?: string
}

export interface LaunchStartResult {
  started: boolean
  error?: string
  state: LaunchState
}

/** Minimal typed bridge exposed as window.ember. */
export interface EmberAPI {
  bootstrap(): Promise<BootstrapData>
  app: {
    minimize(): void
    toggleMaximize(): void
    close(): void
    isMaximized(): Promise<boolean>
    onMaximizeChange(cb: (maximized: boolean) => void): () => void
    onAutoLaunch(cb: (instanceId: string) => void): () => void
    setTheme(theme: ThemeMode): Promise<void>
    setThemeSchedule(schedule: ThemeSchedule): Promise<AppConfig>
    completeOnboarding(): Promise<void>
    openPath(target: string): Promise<string>
    showItem(target: string): Promise<void>
    pickFile(options: { title?: string; filters?: { name: string; extensions: string[] }[] }): Promise<string | null>
    pickDirectory(title?: string): Promise<string | null>
    saveText(defaultName: string, content: string): Promise<string | null>
    openExternal(url: string): Promise<void>
    system(): Promise<SystemInfo>
    showNotification(title: string, body: string): Promise<void>
  }
  instances: {
    create(input: CreateInstanceInput): Promise<InstanceView>
    update(id: string, patch: UpdateInstancePatch): Promise<InstanceView>
    remove(id: string): Promise<void>
    setActive(id: string): Promise<void>
    openDir(id: string): Promise<void>
    size(id: string): Promise<number>
    revealMods(id: string): Promise<void>
    selectCustomDir(id: string): Promise<InstanceView | null>
    exportSaves(id: string, selected?: string[]): Promise<string | null>
    listSaves(id: string): Promise<SaveEntry[]>
    exportInfo(id: string): Promise<string | null>
    exportModrinthList(id: string): Promise<string | null>
    exportModpackManifest(id: string): Promise<string | null>
    exportModpackZip(id: string): Promise<string | null>
    createShortcut(id: string): Promise<string>
  }
  settings: {
    updateGlobal(patch: SettingsOverride): Promise<AppConfig>
    resetInstance(id: string): Promise<InstanceView>
  }
  launch: {
    start(id: string): Promise<LaunchStartResult>
    cancel(): Promise<LaunchState>
    stop(): Promise<{ stopped: boolean }>
    state(): Promise<LaunchState>
    onEvent(cb: (event: LaunchEvent) => void): () => void
  }
  versions: {
    minecraft(force?: boolean): Promise<MinecraftVersion[]>
    loaders(mcVersion: string, type: LoaderType, force?: boolean): Promise<LoaderVersion[]>
    java(): Promise<JavaInfo[]>
    validateJava(path: string): Promise<JavaInfo | null>
  }
  auth: {
    accounts(): Promise<AccountPublic[]>
    active(): Promise<AccountPublic | null>
    loginOffline(username: string): Promise<AccountPublic>
    loginMicrosoft(): Promise<AccountPublic>
    loginYggdrasil(input: { url: string; username: string; password: string; profileId?: string; profileName?: string }): Promise<AccountPublic | { needsProfile: true; profiles: { id: string; name: string }[] }>
    setActive(id: string): Promise<AccountPublic | null>
    logout(id: string): Promise<void>
  }
  skin: {
    get(reload?: boolean): Promise<SkinBundle>
    upload(filePath?: string, variant?: 'classic' | 'slim'): Promise<void>
    switchCape(capeId: string): Promise<void>
    hideCape(): Promise<void>
    deleteCape(): Promise<void>
    importLocal(kind: AppearanceKind): Promise<SkinBundle>
    applyLocal(kind: AppearanceKind, fileId: string): Promise<SkinBundle>
    installSupport(): Promise<SkinBundle>
    openLocal(kind?: AppearanceKind): Promise<void>
    saveSchedule(schedule: AppearanceSchedule): Promise<SkinBundle>
    applySchedule(): Promise<SkinBundle>
  }
  mods: {
    scan(instanceId: string): Promise<ModScanResult>
    toggle(instanceId: string, fileName: string, enable: boolean): Promise<ModScanResult>
    reorder(instanceId: string, order: string[]): Promise<ModScanResult>
    remove(instanceId: string, fileName: string): Promise<ModScanResult>
  }
  modLibrary: {
    list(instanceId?: string): Promise<ModLibraryEntry[]>
    importLocal(): Promise<ModLibraryEntry[]>
    importUrl(url: string): Promise<ModLibraryEntry[]>
    toggle(instanceId: string, id: string, enabled: boolean): Promise<ModLibraryEntry[]>
    remove(id: string): Promise<void>
    open(): Promise<void>
  }
  gameUpdates: {
    check(): Promise<GameUpdateInfo>
  }
  updates: {
    check(): Promise<LauncherUpdateInfo>
    download(info: LauncherUpdateInfo): Promise<string>
    install(file: string): Promise<void>
  }
  maintenance: {
    scan(): Promise<CleanupGroup[]>
    clean(ids: string[]): Promise<CleanupResult>
    purge(includeInstances: boolean): Promise<{ removed: string[]; failed: string[] }>
    uninstall(): Promise<void>
  }
  crash: {
    sources(instanceId: string): Promise<CrashSource[]>
    analyze(instanceId: string, sourcePath?: string): Promise<CrashAnalysis>
    history(instanceId: string): Promise<CrashHistoryEntry[]>
    reveal(sourcePath: string): Promise<void>
  }
  modpack: {
    inspect(ref: ModpackRef): Promise<ModpackInfo>
    pick(): Promise<{ path: string; name: string } | null>
    import(input: ModpackImportInput): Promise<InstanceView>
  }
  library: {
    scan(root?: string): Promise<LibraryScan>
    browse(): Promise<string | null>
    import(input: ImportGameInput): Promise<InstanceView>
  }
  gameSettings: {
    update(values: Record<string, string>): Promise<AppConfig>
    read(instanceId: string): Promise<GameOptionsFile>
    apply(instanceIds: string[]): Promise<ApplyGameOptionsResult>
  }
  modrinth: {
    tags(): Promise<ModrinthTags>
    search(filters: ModrinthSearchFilters): Promise<ModrinthSearchResult>
    versions(projectId: string, filters: { loader?: string; gameVersion?: string; releaseType?: ModrinthReleaseType }): Promise<ModrinthVersion[]>
    download(instanceId: string, projectId: string, projectTitle: string, kind: ModrinthContentType, versionId?: string, versionType?: ModrinthReleaseType): Promise<ModrinthDownloadResult>
    updates(instanceId: string): Promise<ModrinthUpdate[]>
    downloadUpdate(instanceId: string, update: ModrinthUpdate): Promise<ModrinthDownloadResult>
    openFolder(instanceId: string, kind: ModrinthContentType): Promise<void>
    simulateUpdate(instanceId: string): Promise<ModrinthUpdate[]>
    onProgress(callback: (progress: ModrinthDownloadProgress) => void): () => void
  }
  demo: {
    enabled: boolean
    launch(): void
  }
}
