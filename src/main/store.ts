import { app, safeStorage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import type {
  AccountPublic,
  AccountSecret,
  AppConfig,
  InstanceRecord,
  Settings,
  StoredAccount
} from '../shared/types'
import { ACCENTS, DEFAULT_SETTINGS, uid, uniqueSlug } from '../shared/utils'

const CONFIG_FILE = 'ember-config.json'

function roundMb(n: number): number {
  return Math.round(n / 512) * 512
}

function defaultSettings(): Settings {
  const total = os.totalmem() / 1024 / 1024
  const target = Math.max(2048, Math.min(12288, roundMb(total * 0.3)))
  return { ...DEFAULT_SETTINGS, memoryMax: target }
}

export function defaultConfig(): AppConfig {
  return {
    schema: 1,
    theme: 'dark',
    activeInstanceId: null,
    activeAccountId: null,
    global: defaultSettings(),
    instances: [],
    accounts: [],
    gameOptions: {},
    appearanceSchedule: { enabled: false, slots: [] },
    themeSchedule: { enabled: false, lightStart: '07:00', darkStart: '19:00' },
    crashHistory: [],
    personalization: { accent: 'ember', ambient: 'normal', motion: true },
    onboarded: false,
    createdAt: Date.now(),
    updatedAt: Date.now()
  }
}

function demoAccount(): StoredAccount {
  const id = 'acc_demo_ember'
  const secret: AccountSecret = {
    accessToken: 'demo',
    clientToken: 'demo',
    meta: { online: false, type: 'crack' }
  }
  return {
    id,
    name: 'Steve',
    uuid: 'demo-uuid',
    type: 'crack',
    online: false,
    addedAt: Date.now() - 86400000 * 28,
    secret: `demo:${Buffer.from(JSON.stringify(secret)).toString('base64')}`
  }
}

function demoInstance(
  partial: Partial<InstanceRecord> & Pick<InstanceRecord, 'name' | 'slug' | 'mcVersion' | 'loader' | 'emblem' | 'accent'>
): InstanceRecord {
  return {
    id: partial.slug,
    description: '',
    overrides: {},
    modOrder: [],
    playtimeMs: 0,
    createdAt: Date.now() - 86400000 * 20,
    ...partial
  }
}

function createDemoConfig(): AppConfig {
  const base = defaultConfig()
  const account = demoAccount()
  const instances: InstanceRecord[] = [
    demoInstance({
      name: 'Crimson Depths',
      slug: 'crimson-depths',
      description: 'NeoForge 生存整合包，包含光影、建筑和生活类模组。',
      emblem: 'C',
      accent: 'ember',
      mcVersion: '1.21.1',
      loader: { type: 'neoforge', version: '21.1.209' },
      overrides: { memoryMin: 2048, memoryMax: 8192, windowWidth: 1920, windowHeight: 1080 },
      playtimeMs: 1000 * 60 * 60 * 42 + 1000 * 60 * 18,
      lastPlayedAt: Date.now() - 1000 * 60 * 37,
      pinned: true
    }),
    demoInstance({
      name: 'Frostbound',
      slug: 'frostbound',
      description: '轻量 Forge 生存实例，适合周末慢节奏游玩。',
      emblem: 'F',
      accent: 'frost',
      mcVersion: '1.20.1',
      loader: { type: 'forge', version: '47.4.22' },
      overrides: { memoryMax: 6144 },
      launchMode: 'auto',
      importedFrom: 'C:\\Users\\Public\\Documents\\.minecraft',
      localVersionId: '1.20.1-Forge_47.4.22',
      localVersionDir: 'C:\\Users\\Public\\Documents\\.minecraft\\versions\\1.20.1-Forge_47.4.22',
      localGameRoot: 'C:\\Users\\Public\\Documents\\.minecraft',
      localIsolated: true,
      sourceLauncher: 'pcl',
      playtimeMs: 1000 * 60 * 60 * 12 + 1000 * 60 * 42,
      lastPlayedAt: Date.now() - 86400000 * 2
    }),
    demoInstance({
      name: 'Void Signal',
      slug: 'void-signal',
      description: '原版生存存档，没有安装模组。',
      emblem: 'V',
      accent: 'void',
      mcVersion: '1.21.1',
      loader: { type: 'fabric', version: '0.16.10' },
      overrides: { memoryMax: 4096 },
      playtimeMs: 1000 * 60 * 60 * 6,
      lastPlayedAt: Date.now() - 86400000 * 6
    })
  ]
  return {
    ...base,
    accounts: [account],
    activeAccountId: account.id,
    instances,
    activeInstanceId: instances[0].id,
    gameOptions: {
      fov: '0.5',
      renderDistance: '12',
      simulationDistance: '12',
      maxFps: '120',
      'soundCategory_master': '0.8',
      'key_key.forward': 'key.keyboard.w',
      lang: 'zh_cn'
    },
    theme: 'dark',
    onboarded: true,
    createdAt: Date.now() - 86400000 * 30
  }
}

export class ConfigStore {
  private data: AppConfig = defaultConfig()
  private loaded = false
  readonly demo: boolean
  readonly filePath: string

  constructor(demo = false) {
    this.demo = demo
    this.filePath = path.join(app.getPath('userData'), CONFIG_FILE)
  }

  load(): AppConfig {
    if (this.loaded) return this.data
    this.loaded = true
    if (this.demo) {
      this.data = createDemoConfig()
      return this.data
    }
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8')
        const parsed = JSON.parse(raw) as AppConfig
        this.data = this.migrate(parsed)
      } else {
        this.data = defaultConfig()
        this.save()
      }
    } catch (err) {
      console.error('[store] failed to read config, starting fresh:', err)
      try {
        if (fs.existsSync(this.filePath)) {
          fs.copyFileSync(this.filePath, `${this.filePath}.broken-${Date.now()}.bak`)
        }
      } catch {
      }
      this.data = defaultConfig()
      this.save()
    }
    return this.data
  }

  get(): AppConfig {
    return this.load()
  }

  update(mutator: (config: AppConfig) => void): AppConfig {
    const data = this.load()
    mutator(data)
    data.updatedAt = Date.now()
    this.save()
    return data
  }

  save(): void {
    if (this.demo) return
    const data = this.load()
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true })
      fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf8')
    } catch (err) {
      console.error('[store] failed to persist config:', err)
    }
  }

  private migrate(input: AppConfig): AppConfig {
    const base = defaultConfig()
    const merged: AppConfig = {
      ...base,
      ...input,
      schema: 1,
      global: { ...base.global, ...(input.global ?? {}) },
      instances: Array.isArray(input.instances) ? input.instances : [],
      accounts: Array.isArray(input.accounts) ? input.accounts : [],
      gameOptions:
        input.gameOptions && typeof input.gameOptions === 'object' && !Array.isArray(input.gameOptions)
          ? input.gameOptions
          : {},
      appearanceSchedule:
        input.appearanceSchedule && typeof input.appearanceSchedule === 'object'
          ? input.appearanceSchedule
          : { enabled: false, slots: [] },
      themeSchedule:
        input.themeSchedule && typeof input.themeSchedule === 'object'
          ? {
              enabled: !!input.themeSchedule.enabled,
              lightStart: /^\d{2}:\d{2}$/.test(input.themeSchedule.lightStart ?? '') ? input.themeSchedule.lightStart : '07:00',
              darkStart: /^\d{2}:\d{2}$/.test(input.themeSchedule.darkStart ?? '') ? input.themeSchedule.darkStart : '19:00'
            }
          : { enabled: false, lightStart: '07:00', darkStart: '19:00' },
      crashHistory: Array.isArray(input.crashHistory) ? input.crashHistory.slice(0, 12) : [],
      personalization: {
        accent: ['ember', 'frost', 'void', 'moss', 'gold', 'orchid'].includes(input.personalization?.accent ?? '') ? input.personalization!.accent : 'ember',
        ambient: ['subtle', 'normal', 'vivid'].includes(input.personalization?.ambient ?? '') ? input.personalization!.ambient : 'normal',
        motion: input.personalization?.motion !== false
      }
    }
    merged.instances = merged.instances
      .filter((i) => i && i.id && i.name && i.mcVersion)
      .map((i) => ({
        ...i,
        overrides: i.overrides ?? {},
        modOrder: Array.isArray(i.modOrder) ? i.modOrder : [],
        playtimeMs: Number.isFinite(i.playtimeMs) ? i.playtimeMs : 0,
        accent: ACCENTS.some((a) => a.key === i.accent) ? i.accent : 'ember',
        emblem: (i.emblem || i.name.slice(0, 1)).slice(0, 3),
        loader: i.loader ?? { type: 'vanilla', version: i.mcVersion }
      }))
    const validInstanceIds = new Set(merged.instances.map((i) => i.id))
    if (!merged.activeInstanceId || !validInstanceIds.has(merged.activeInstanceId)) {
      merged.activeInstanceId = merged.instances[0]?.id ?? null
    }
    const validAccountIds = new Set(merged.accounts.map((a) => a.id))
    if (merged.activeAccountId && !validAccountIds.has(merged.activeAccountId)) {
      merged.activeAccountId = null
    }
    return merged
  }

  // ---------- accounts ----------

  encryptSecret(secret: AccountSecret): string {
    const json = JSON.stringify(secret)
    try {
      if (safeStorage.isEncryptionAvailable()) {
        return `v1:${safeStorage.encryptString(json).toString('base64')}`
      }
    } catch {
      /* fall through */
    }
    return `b64:${Buffer.from(json, 'utf8').toString('base64')}`
  }

  decryptSecret(record: StoredAccount): AccountSecret | null {
    const value = record.secret || ''
    try {
      if (value.startsWith('v1:')) {
        const decrypted = safeStorage.decryptString(Buffer.from(value.slice(3), 'base64'))
        return JSON.parse(decrypted) as AccountSecret
      }
      if (value.startsWith('b64:') || value.startsWith('demo:')) {
        const raw = value.startsWith('demo:') ? value.slice(5) : value.slice(4)
        return JSON.parse(Buffer.from(raw, 'base64').toString('utf8')) as AccountSecret
      }
    } catch (err) {
      console.error('[store] failed to decrypt account secret:', err)
    }
    return null
  }

  addAccount(publicPart: Omit<AccountPublic, 'id' | 'addedAt'>, secret: AccountSecret): AccountPublic {
    const id = `acc_${randomUUID().slice(0, 8)}`
    const record: StoredAccount = {
      ...publicPart,
      id,
      addedAt: Date.now(),
      secret: this.encryptSecret(secret)
    }
    this.update((cfg) => {
      const existing = cfg.accounts.findIndex(
        (a) => a.type === publicPart.type && a.uuid === publicPart.uuid
      )
      if (existing >= 0) {
        record.addedAt = cfg.accounts[existing].addedAt
        cfg.accounts[existing] = record
      } else {
        cfg.accounts.push(record)
      }
      cfg.activeAccountId = record.id
    })
    return {
      id: record.id,
      name: record.name,
      uuid: record.uuid,
      type: record.type,
      online: record.online,
      addedAt: record.addedAt
    }
  }

  accountSecret(id: string): AccountSecret | null {
    const record = this.get().accounts.find((a) => a.id === id)
    return record ? this.decryptSecret(record) : null
  }

  updateAccountSecret(id: string, secret: AccountSecret): void {
    this.update((cfg) => {
      const record = cfg.accounts.find((a) => a.id === id)
      if (record) record.secret = this.encryptSecret(secret)
    })
  }

  removeAccount(id: string): void {
    this.update((cfg) => {
      cfg.accounts = cfg.accounts.filter((a) => a.id !== id)
      if (cfg.activeAccountId === id) cfg.activeAccountId = cfg.accounts[0]?.id ?? null
    })
  }

  activeAccount(): AccountPublic | null {
    const cfg = this.get()
    const a = cfg.accounts.find((x) => x.id === cfg.activeAccountId)
    if (!a) return null
    return { id: a.id, name: a.name, uuid: a.uuid, type: a.type, online: a.online, addedAt: a.addedAt }
  }

  // ---------- instances ----------

  createInstance(input: {
    name: string
    description?: string
    emblem?: string
    accent?: InstanceRecord['accent']
    mcVersion: string
    loader: InstanceRecord['loader']
    modpack?: InstanceRecord['modpack']
    customDir?: string
    importedFrom?: string
    launchMode?: InstanceRecord['launchMode']
    localVersionId?: string
    localVersionDir?: string
    localGameRoot?: string
    localIsolated?: boolean
    sourceLauncher?: InstanceRecord['sourceLauncher']
  }): InstanceRecord {
    let created: InstanceRecord | null = null
    this.update((cfg) => {
      const id = uid('inst')
      const slug = uniqueSlug(input.name, cfg.instances)
      created = {
        id,
        slug,
        name: input.name.trim() || 'Untitled Instance',
        description: input.description ?? '',
        emblem: (input.emblem || input.name.trim().slice(0, 1) || 'E').slice(0, 3).toUpperCase(),
        accent: input.accent ?? 'ember',
        mcVersion: input.mcVersion,
        loader: input.loader,
        modpack: input.modpack,
        overrides: {},
        modOrder: [],
        customDir: input.customDir,
        importedFrom: input.importedFrom,
        launchMode: input.launchMode ?? 'auto',
        localVersionId: input.localVersionId,
        localVersionDir: input.localVersionDir,
        localGameRoot: input.localGameRoot,
        localIsolated: input.localIsolated,
        sourceLauncher: input.sourceLauncher,
        playtimeMs: 0,
        createdAt: Date.now()
      }
      cfg.instances.unshift(created)
      cfg.activeInstanceId = id
    })
    if (!created) throw new Error('Could not create instance')
    return created
  }

  updateInstance(id: string, patch: Partial<InstanceRecord>): InstanceRecord | null {
    let found: InstanceRecord | null = null
    this.update((cfg) => {
      const instance = cfg.instances.find((i) => i.id === id)
      if (!instance) return
      Object.assign(instance, patch)
      if (patch.name) instance.name = patch.name.trim() || instance.name
      if (patch.overrides) instance.overrides = { ...instance.overrides, ...patch.overrides }
      if (patch.loader) instance.loader = { ...instance.loader, ...patch.loader }
      found = instance
    })
    return found
  }

  setActiveInstance(id: string): void {
    this.update((cfg) => {
      if (cfg.instances.some((i) => i.id === id)) cfg.activeInstanceId = id
    })
  }

  markPlayed(id: string, playtimeMs: number): void {
    this.update((cfg) => {
      const instance = cfg.instances.find((i) => i.id === id)
      if (!instance) return
      instance.lastPlayedAt = Date.now()
      instance.playtimeMs = (instance.playtimeMs || 0) + Math.max(0, playtimeMs)
    })
  }

  updateGlobal(patch: Partial<Settings>): void {
    this.update((cfg) => {
      cfg.global = { ...cfg.global, ...patch }
      cfg.global.memoryMin = Math.max(256, Math.round(cfg.global.memoryMin))
      cfg.global.memoryMax = Math.max(cfg.global.memoryMin, Math.round(cfg.global.memoryMax))
      cfg.global.downloadThreads = Number.isFinite(Number(cfg.global.downloadThreads))
        ? Math.max(4, Math.min(128, Math.round(Number(cfg.global.downloadThreads))))
        : 32
      cfg.global.downloadLimit = Number.isFinite(Number(cfg.global.downloadLimit))
        ? Math.max(0, Math.min(20, Math.round(Number(cfg.global.downloadLimit))))
        : 0
      cfg.global.smartDownload = cfg.global.smartDownload !== false
    })
  }

  updateGameOptions(values: Record<string, string>): void {
    this.update((cfg) => {
      const next: Record<string, string> = {}
      for (const [key, value] of Object.entries(values)) {
        if (!key.trim() || key.includes('\n') || key.includes(':') || value.includes('\n')) continue
        next[key.trim()] = value
      }
      cfg.gameOptions = next
    })
  }

  gameOptions(): Record<string, string> {
    return { ...(this.get().gameOptions ?? {}) }
  }

  appearanceSchedule(): AppConfig['appearanceSchedule'] {
    return this.get().appearanceSchedule ?? { enabled: false, slots: [] }
  }

  updateAppearanceSchedule(schedule: NonNullable<AppConfig['appearanceSchedule']>): void {
    this.update((cfg) => {
      cfg.appearanceSchedule = {
        enabled: !!schedule.enabled,
        slots: Array.isArray(schedule.slots)
          ? schedule.slots
              .filter((slot) => slot && /^\d{2}:\d{2}$/.test(slot.start) && /^\d{2}:\d{2}$/.test(slot.end))
              .map((slot) => ({
                id: slot.id || `slot_${Math.random().toString(36).slice(2, 8)}`,
                start: slot.start,
                end: slot.end,
                skinId: slot.skinId || undefined,
                capeId: slot.capeId || undefined
              }))
          : []
      }
    })
  }

  setTheme(theme: AppConfig['theme']): void {
    this.update((cfg) => {
      cfg.theme = theme
    })
  }

  updatePersonalization(input: Partial<NonNullable<AppConfig['personalization']>>): AppConfig {
    this.update((cfg) => {
      const current = cfg.personalization ?? { accent: 'ember', ambient: 'normal', motion: true }
      cfg.personalization = {
        accent: ['ember', 'frost', 'void', 'moss', 'gold', 'orchid'].includes(input.accent ?? '') ? input.accent! : current.accent,
        ambient: ['subtle', 'normal', 'vivid'].includes(input.ambient ?? '') ? input.ambient! : current.ambient,
        motion: input.motion === undefined ? current.motion : !!input.motion
      }
    })
    return this.get()
  }

  updateThemeSchedule(schedule: NonNullable<AppConfig['themeSchedule']>): AppConfig {
    this.update((cfg) => {
      cfg.themeSchedule = {
        enabled: !!schedule.enabled,
        lightStart: /^\d{2}:\d{2}$/.test(schedule.lightStart) ? schedule.lightStart : '07:00',
        darkStart: /^\d{2}:\d{2}$/.test(schedule.darkStart) ? schedule.darkStart : '19:00'
      }
    })
    return this.get()
  }

  crashHistory(instanceId?: string): NonNullable<AppConfig['crashHistory']> {
    const list = this.get().crashHistory ?? []
    return instanceId ? list.filter((entry) => entry.instanceId === instanceId) : list
  }

  addCrashHistory(analysis: import('../shared/types').CrashAnalysis): void {
    this.update((cfg) => {
      const entry = {
        id: analysis.id,
        instanceId: analysis.instanceId,
        at: analysis.createdAt,
        analysis: { ...analysis, logTail: analysis.logTail.slice(-80) }
      }
      cfg.crashHistory = [entry, ...(cfg.crashHistory ?? []).filter((item) => item.id !== analysis.id)].slice(0, 12)
    })
  }

  clearCrashHistory(): void {
    this.update((cfg) => {
      cfg.crashHistory = []
    })
  }

  completeOnboarding(): void {
    this.update((cfg) => {
      cfg.onboarded = true
    })
  }

  removeInstance(id: string): InstanceRecord | null {
    const cfg = this.get()
    const instance = cfg.instances.find((i) => i.id === id)
    if (!instance) return null
    this.update((c) => {
      c.instances = c.instances.filter((i) => i.id !== id)
      if (c.activeInstanceId === id) c.activeInstanceId = c.instances[0]?.id ?? null
    })
    return instance
  }
}

export function publicAccount(record: StoredAccount): AccountPublic {
  return {
    id: record.id,
    name: record.name,
    uuid: record.uuid,
    type: record.type,
    online: record.online,
    addedAt: record.addedAt
  }
}
