import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type {
  AccountPublic,
  AppConfig,
  BootstrapData,
  CreateInstanceInput,
  InstanceView,
  LaunchState,
  ModrinthDownloadProgress,
  ModrinthUpdate,
  Personalization,
  PublicConfig,
  Settings,
  SettingsOverride,
  SystemInfo,
  ThemeMode,
  ThemeSchedule,
  UpdateInstancePatch
} from '@shared/types'

export type Page = 'home' | 'instance-settings' | 'skin' | 'mods' | 'crash' | 'modpack' | 'discover' | 'game' | 'settings'

export interface Route {
  page: Page
  instanceId?: string
}

export interface Toast {
  id: string
  tone: 'success' | 'error' | 'info' | 'warning'
  title: string
  message?: string
}

interface AppContextValue {
  loading: boolean
  error: string | null
  boot: BootstrapData | null
  config: PublicConfig | null
  instances: InstanceView[]
  activeInstance: InstanceView | null
  activeAccount: AccountPublic | null
  system: SystemInfo | null
  themeMode: ThemeMode
  themeSchedule: ThemeSchedule
  resolvedTheme: 'dark' | 'light'
  route: Route
  launch: LaunchState
  launchOpen: boolean
  accountOpen: boolean
  createOpen: boolean
  importOpen: boolean
  commandOpen: boolean
  toasts: Toast[]
  modUpdates: ModrinthUpdate[]
  updatesChecking: boolean
  updatingMods: string[]
  modProgress: ModrinthDownloadProgress | null
  personalization: Personalization
  updatePersonalization: (input: Partial<Personalization>) => Promise<void>
  refreshModUpdates: (silent?: boolean) => Promise<ModrinthUpdate[]>
  updateMod: (update: ModrinthUpdate) => Promise<void>
  updateAllMods: () => Promise<void>
  reload: (silent?: boolean) => Promise<BootstrapData | null>
  setTheme: (mode: ThemeMode) => void
  setThemeSchedule: (schedule: ThemeSchedule) => Promise<void>
  navigate: (to: string | Route) => void
  selectInstance: (id: string) => Promise<void>
  createInstance: (input: CreateInstanceInput) => Promise<InstanceView>
  saveInstance: (id: string, patch: UpdateInstancePatch) => Promise<InstanceView>
  deleteInstance: (id: string) => Promise<void>
  refreshInstances: () => Promise<void>
  setActiveAccount: (id: string) => Promise<void>
  loginOffline: (name: string) => Promise<AccountPublic>
  loginMicrosoft: () => Promise<AccountPublic>
  loginYggdrasil: (input: { url: string; username: string; password: string; profileId?: string; profileName?: string }) => Promise<AccountPublic | { needsProfile: true; profiles: { id: string; name: string }[] }>
  logout: (id: string) => Promise<void>
  startLaunch: (id?: string) => Promise<void>
  cancelLaunch: () => Promise<void>
  stopLaunch: () => Promise<void>
  dismissLaunch: () => void
  openLaunch: () => void
  setAccountOpen: (open: boolean) => void
  setCreateOpen: (open: boolean) => void
  setImportOpen: (open: boolean) => void
  setCommandOpen: (open: boolean) => void
  pushToast: (toast: Omit<Toast, 'id'>) => void
  dismissToast: (id: string) => void
  updateGlobal: (patch: Partial<Settings>) => Promise<void>
}

const AppContext = createContext<AppContextValue | null>(null)

export function errorMessage(error: unknown): string {
  if (!error) return '未知错误'
  let message = error instanceof Error ? error.message : String(error)
  message = message
    .replace(/^Error invoking remote method '[^']+':\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .trim()
  return message || '操作失败'
}

export function parseRoute(path: string): Route {
  if (path.startsWith('/instance/')) {
    const id = path.split('/')[2]
    return { page: 'instance-settings', instanceId: id }
  }
  const map: Record<string, Page> = {
    '/': 'home',
    '/skin': 'skin',
    '/mods': 'mods',
    '/crash': 'crash',
    '/modpack': 'modpack',
    '/discover': 'discover',
    '/game': 'game',
    '/settings': 'settings'
  }
  return { page: map[path] ?? 'home' }
}

function routeKey(route: Route): string {
  return `${route.page}:${route.instanceId ?? ''}`
}

function mergeLaunchEvent(prev: LaunchState, event: { type: string; state: LaunchState; line?: string }): LaunchState {
  if (event.type === 'log' && event.line) {
    const stamp = new Date().toLocaleTimeString('zh-CN', { hour12: false })
    return {
      ...event.state,
      logs: [...prev.logs, `[${stamp}] ${event.line}`].slice(-300)
    }
  }
  return {
    ...event.state,
    logs: event.state.logs?.length ? event.state.logs : prev.logs
  }
}

export function AppProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [boot, setBoot] = useState<BootstrapData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [themeMode, setThemeModeState] = useState<ThemeMode>(() => {
    const stored = localStorage.getItem('ember-theme') as ThemeMode | null
    return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'dark'
  })
  const [resolvedTheme, setResolvedTheme] = useState<'dark' | 'light'>('dark')
  const themeSchedule = boot?.config.themeSchedule ?? { enabled: false, lightStart: '07:00', darkStart: '19:00' }
  const [route, setRoute] = useState<Route>({ page: 'home' })
  const [launch, setLaunch] = useState<LaunchState>({
    instanceId: null,
    status: 'idle',
    phase: 'idle',
    progress: 0,
    message: '等待启动',
    logs: []
  })
  const [launchOpen, setLaunchOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [commandOpen, setCommandOpen] = useState(false)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [modUpdates, setModUpdates] = useState<ModrinthUpdate[]>([])
  const [updatesChecking, setUpdatesChecking] = useState(false)
  const [updatingMods, setUpdatingMods] = useState<string[]>([])
  const [modProgress, setModProgress] = useState<ModrinthDownloadProgress | null>(null)
  const progressTimer = useRef<number | null>(null)
  const notifiedRef = useRef<string>('')
  const updatesNotifiedRef = useRef<string>('')
  const toastTimers = useRef(new Map<string, number>())

  const config = boot?.config ?? null
  const personalization = config?.personalization ?? { accent: 'ember', ambient: 'normal', motion: true }
  const instances = boot?.instances ?? []
  const system = boot?.system ?? null
  const activeAccount = boot?.activeAccount ?? null
  const activeInstance = useMemo(
    () => instances.find((i) => i.id === activeId) ?? instances[0] ?? null,
    [instances, activeId]
  )

  const pushToast = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    setToasts((prev) => [...prev.slice(-3), { ...toast, id }])
    const timer = window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
      toastTimers.current.delete(id)
    }, toast.tone === 'error' ? 6500 : 4200)
    toastTimers.current.set(id, timer)
  }, [])

  const dismissToast = useCallback((id: string) => {
    const timer = toastTimers.current.get(id)
    if (timer) window.clearTimeout(timer)
    toastTimers.current.delete(id)
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const applyTheme = useCallback((mode: ThemeMode) => {
    setThemeModeState(mode)
    localStorage.setItem('ember-theme', mode)
  }, [])

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: light)')
    const update = () => {
      let resolved: 'dark' | 'light' = themeMode === 'system' ? (media.matches ? 'light' : 'dark') : themeMode
      if (themeSchedule.enabled) {
        const now = new Date()
        const minutes = now.getHours() * 60 + now.getMinutes()
        const parse = (value: string) => {
          const [hour, minute] = value.split(':').map(Number)
          return hour * 60 + minute
        }
        const lightStart = parse(themeSchedule.lightStart)
        const darkStart = parse(themeSchedule.darkStart)
        const isLight = lightStart < darkStart
          ? minutes >= lightStart && minutes < darkStart
          : minutes >= lightStart || minutes < darkStart
        resolved = isLight ? 'light' : 'dark'
      }
      setResolvedTheme(resolved)
      document.documentElement.dataset.theme = resolved
      document.documentElement.dataset.themeMode = themeSchedule.enabled ? 'time' : themeMode
    }
    update()
    media.addEventListener('change', update)
    const timer = themeSchedule.enabled ? window.setInterval(update, 30_000) : null
    return () => {
      media.removeEventListener('change', update)
      if (timer) window.clearInterval(timer)
    }
  }, [themeMode, themeSchedule.enabled, themeSchedule.lightStart, themeSchedule.darkStart])

  const setTheme = useCallback(
    (mode: ThemeMode) => {
      applyTheme(mode)
      setBoot((prev) => (prev ? { ...prev, config: { ...prev.config, theme: mode } } : prev))
      try {
        document.documentElement.animate(
          [
            { filter: 'brightness(1.18) saturate(1.08)' },
            { filter: 'brightness(1) saturate(1)' }
          ],
          { duration: 420, easing: 'cubic-bezier(.22,.8,.2,1)' }
        )
      } catch {
      }
      void window.ember.app.setTheme(mode).catch(() => undefined)
    },
    [applyTheme]
  )

  const setThemeSchedule = useCallback(async (schedule: ThemeSchedule) => {
    const next = await window.ember.app.setThemeSchedule(schedule)
    setBoot((prev) => (prev ? { ...prev, config: next } : prev))
  }, [])

  const reload = useCallback(async (silent = false): Promise<BootstrapData | null> => {
    if (!silent) setLoading(true)
    try {
      const data = await window.ember.bootstrap()
      setBoot(data)
      setActiveId(data.activeInstanceId)
      setLaunch((prev) => {
        const next = data.launch
        if (!next.logs?.length) return { ...next, logs: prev.logs }
        return next
      })
      setError(null)
      applyTheme(data.config.theme)
      return data
    } catch (err) {
      setError(errorMessage(err))
      return null
    } finally {
      setLoading(false)
    }
  }, [applyTheme])

  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const unsubscribe = window.ember.launch.onEvent((event) => {
      setLaunch((prev) => mergeLaunchEvent(prev, event))
      const id = event.state.startedAt ? `${event.state.startedAt}:${event.type}:${event.state.status}` : ''
      if (event.type === 'complete') {
        if (event.state.status === 'crashed' && notifiedRef.current !== id) {
          notifiedRef.current = id
          pushToast({
            tone: 'error',
            title: '游戏崩溃了',
            message: '日志已保存。打开崩溃分析查看快速判定与堆栈嫌疑犯。'
          })
        } else if (event.state.status === 'success' && notifiedRef.current !== id) {
          notifiedRef.current = id
          pushToast({ tone: 'success', title: '游戏正常退出', message: '游玩时长已记录。' })
        }
        window.setTimeout(() => void reload(true), 500)
      }
      if (event.type === 'error') {
        pushToast({
          tone: 'error',
          title: '启动失败',
          message: event.state.message
        })
      }
    })
    return unsubscribe
  }, [pushToast, reload])

  const navigate = useCallback((to: string | Route) => {
    const next = typeof to === 'string' ? parseRoute(to) : to
    setRoute(next)
    setCommandOpen(false)
    window.setTimeout(() => {
      document.querySelector('.content-scroll')?.scrollTo({ top: 0, behavior: 'smooth' })
    }, 20)
    if (typeof to === 'string') {
      window.history.replaceState(null, '', `#${to}`)
    }
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setCommandOpen((v) => !v)
      }
      if (event.key === 'Escape') {
        setCommandOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const selectInstance = useCallback(async (id: string) => {
    setActiveId(id)
    await window.ember.instances.setActive(id)
    setBoot((prev) =>
      prev ? { ...prev, activeInstanceId: id, config: { ...prev.config, activeInstanceId: id } } : prev
    )
  }, [])

  const createInstance = useCallback(
    async (input: CreateInstanceInput) => {
      const created = await window.ember.instances.create(input)
      await selectInstance(created.id)
      await reload(true)
      setCreateOpen(false)
      navigate('/')
      pushToast({
        tone: 'success',
        title: '实例已创建',
        message: `${created.name} · Minecraft ${created.mcVersion}，首次启动会自动下载并安装加载器。`
      })
      return created
    },
    [navigate, pushToast, reload, selectInstance]
  )

  const saveInstance = useCallback(
    async (id: string, patch: UpdateInstancePatch) => {
      const updated = await window.ember.instances.update(id, patch)
      setBoot((prev) =>
        prev
          ? {
              ...prev,
              instances: prev.instances.map((i) => (i.id === id ? updated : i))
            }
          : prev
      )
      return updated
    },
    []
  )

  const deleteInstance = useCallback(
    async (id: string) => {
      await window.ember.instances.remove(id)
      const data = await reload(true)
      if (route.page === 'instance-settings' && route.instanceId === id) navigate('/')
      pushToast({
        tone: 'info',
        title: '实例已从启动器移除',
        message: data ? '游戏文件仍保留在实例目录中。' : undefined
      })
    },
    [navigate, pushToast, reload, route]
  )

  const refreshInstances = useCallback(async () => {
    await reload(true)
  }, [reload])

  const refreshModUpdates = useCallback(async (silent = false): Promise<ModrinthUpdate[]> => {
    if (!activeInstance) {
      setModUpdates([])
      return []
    }
    setUpdatesChecking(true)
    try {
      const list = await window.ember.modrinth.updates(activeInstance.id)
      setModUpdates(list)
      const key = `${activeInstance.id}:${list.map((item) => item.latestVersionId).sort().join(',')}`
      if (list.length && updatesNotifiedRef.current !== key) {
        updatesNotifiedRef.current = key
        pushToast({
          tone: 'info',
          title: `发现 ${list.length} 个模组更新`,
          message: '右下角可以查看，或在模组页一键更新。'
        })
      }
      return list
    } catch (err) {
      if (!silent) pushToast({ tone: 'error', title: '检查模组更新失败', message: errorMessage(err) })
      return []
    } finally {
      setUpdatesChecking(false)
    }
  }, [activeInstance, pushToast])

  const updateMod = useCallback(async (update: ModrinthUpdate) => {
    if (!activeInstance) return
    setUpdatingMods((prev) => (prev.includes(update.projectId) ? prev : [...prev, update.projectId]))
    setModProgress(null)
    try {
      const info = await window.ember.modrinth.downloadUpdate(activeInstance.id, update)
      await refreshInstances()
      await refreshModUpdates(true)
      pushToast({ tone: 'success', title: '模组已更新', message: `${update.title} → ${info.version.version_number}` })
    } catch (err) {
      pushToast({ tone: 'error', title: '更新失败', message: errorMessage(err) })
      throw err
    } finally {
      setUpdatingMods((prev) => prev.filter((id) => id !== update.projectId))
    }
  }, [activeInstance, pushToast, refreshInstances, refreshModUpdates])

  const updateAllMods = useCallback(async () => {
    if (!activeInstance) return
    const list = modUpdates.slice()
    for (const update of list) {
      try {
        await updateMod(update)
      } catch {
        /* continue remaining mods */
      }
    }
  }, [activeInstance, modUpdates, updateMod])

  useEffect(() => {
    const off = window.ember.modrinth.onProgress((progress) => {
      setModProgress(progress)
      if (progressTimer.current) window.clearTimeout(progressTimer.current)
      progressTimer.current = window.setTimeout(() => setModProgress(null), 4500)
    })
    return () => {
      off()
      if (progressTimer.current) window.clearTimeout(progressTimer.current)
    }
  }, [])

  useEffect(() => {
    if (!activeInstance) {
      setModUpdates([])
      return
    }
    setModUpdates([])
    const timer = window.setTimeout(() => void refreshModUpdates(true), 1800)
    const interval = window.setInterval(() => void refreshModUpdates(true), 10 * 60_000)
    return () => {
      window.clearTimeout(timer)
      window.clearInterval(interval)
    }
  }, [activeInstance?.id, refreshModUpdates])

  const setActiveAccount = useCallback(
    async (id: string) => {
      const account = await window.ember.auth.setActive(id)
      setBoot((prev) => (prev ? { ...prev, activeAccount: account } : prev))
      await reload(true)
    },
    [reload]
  )

  const loginOffline = useCallback(
    async (name: string) => {
      const account = await window.ember.auth.loginOffline(name)
      await reload(true)
      setAccountOpen(false)
      pushToast({ tone: 'success', title: `欢迎，${account.name}`, message: '已创建离线账户，可立即启动游戏。' })
      return account
    },
    [pushToast, reload]
  )

  const loginMicrosoft = useCallback(async () => {
    const account = await window.ember.auth.loginMicrosoft()
    await reload(true)
    setAccountOpen(false)
    pushToast({ tone: 'success', title: `已登录 ${account.name}`, message: '可用于在线游戏、皮肤与披风管理。' })
    return account
  }, [pushToast, reload])

  const loginYggdrasil = useCallback(
    async (input: { url: string; username: string; password: string; profileId?: string; profileName?: string }) => {
      const result = await window.ember.auth.loginYggdrasil(input)
      if ('needsProfile' in result) return result
      await reload(true)
      setAccountOpen(false)
      pushToast({ tone: 'success', title: `已登录 ${result.name}`, message: '第三方认证会话已保存。' })
      return result
    },
    [pushToast, reload]
  )

  const logout = useCallback(
    async (id: string) => {
      await window.ember.auth.logout(id)
      await reload(true)
      pushToast({ tone: 'info', title: '账户已移除' })
    },
    [pushToast, reload]
  )

  const startLaunch = useCallback(
    async (id?: string) => {
      const target = id ?? activeInstance?.id
      if (!target) {
        pushToast({ tone: 'warning', title: '还没有实例', message: '先创建一个 Minecraft 实例。' })
        return
      }
      setLaunchOpen(true)
      try {
        const result = await window.ember.launch.start(target)
        setLaunch((prev) => ({ ...result.state, logs: result.state.logs?.length ? result.state.logs : prev.logs }))
        if (!result.started && result.error) {
          pushToast({ tone: 'error', title: '无法启动', message: result.error })
        }
      } catch (err) {
        pushToast({ tone: 'error', title: '无法启动', message: errorMessage(err) })
      }
    },
    [activeInstance, pushToast]
  )

  useEffect(() => {
    return window.ember.app.onAutoLaunch((id) => {
      void startLaunch(id)
    })
  }, [startLaunch])

  const stopLaunch = useCallback(async () => {
    try {
      const result = await window.ember.launch.stop()
      if (result.stopped) pushToast({ tone: 'info', title: '正在停止游戏', message: '等待 Java 进程退出。' })
      else pushToast({ tone: 'warning', title: '没有找到运行中的游戏进程' })
    } catch (err) {
      pushToast({ tone: 'error', title: '停止失败', message: errorMessage(err) })
    }
  }, [pushToast])

  const updatePersonalization = useCallback(async (input: Partial<Personalization>) => {
    const next = await window.ember.personalization.update(input)
    setBoot((prev) => (prev ? { ...prev, config: next } : prev))
  }, [])

  const cancelLaunch = useCallback(async () => {
    try {
      const next = await window.ember.launch.cancel()
      setLaunch((prev) => ({ ...next, logs: next.logs?.length ? next.logs : prev.logs }))
      setLaunchOpen(false)
      pushToast({ tone: 'info', title: '已取消启动' })
    } catch (err) {
      pushToast({ tone: 'error', title: '取消失败', message: errorMessage(err) })
    }
  }, [pushToast])

  const updateGlobal = useCallback(
    async (patch: Partial<Settings>) => {
      const next = await window.ember.settings.updateGlobal(patch)
      setBoot((prev) => (prev ? { ...prev, config: next } : prev))
      await reload(true)
    },
    [reload]
  )

  useEffect(() => {
    window.__emberSmoke = {
      navigate: (path: string) => {
        navigate(path)
        window.setTimeout(() => document.querySelector('.content-scroll')?.scrollTo({ top: 0, behavior: 'auto' }), 80)
      },
      setTheme: (mode) => setTheme(mode),
      openCreate: () => setCreateOpen(true),
      openImport: () => setImportOpen(true),
      openAccount: () => setAccountOpen(true),
      closeAll: () => {
        setCreateOpen(false)
        setImportOpen(false)
        setAccountOpen(false)
        setCommandOpen(false)
      },
      launchDemo: () => {
        void startLaunch()
      }
    }
  }, [navigate, setTheme, startLaunch])

  useEffect(() => {
    return () => {
      for (const timer of toastTimers.current.values()) window.clearTimeout(timer)
    }
  }, [])

  const value: AppContextValue = {
    loading,
    error,
    boot,
    config,
    instances,
    activeInstance,
    activeAccount,
    system,
    themeMode,
    themeSchedule,
    resolvedTheme,
    route,
    launch,
    launchOpen,
    accountOpen,
    createOpen,
    importOpen,
    commandOpen,
    toasts,
    modUpdates,
    updatesChecking,
    updatingMods,
    modProgress,
    personalization,
    updatePersonalization,
    refreshModUpdates,
    updateMod,
    updateAllMods,
    reload,
    setTheme,
    setThemeSchedule,
    navigate,
    selectInstance,
    createInstance,
    saveInstance,
    deleteInstance,
    refreshInstances,
    setActiveAccount,
    loginOffline,
    loginMicrosoft,
    loginYggdrasil,
    logout,
    startLaunch,
    cancelLaunch,
    stopLaunch,
    dismissLaunch: () => setLaunchOpen(false),
    openLaunch: () => setLaunchOpen(true),
    setAccountOpen,
    setCreateOpen,
    setImportOpen,
    setCommandOpen,
    pushToast,
    dismissToast,
    updateGlobal
  }

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used inside AppProvider')
  return ctx
}

export function useActiveInstanceOrThrow(): InstanceView {
  const { activeInstance } = useApp()
  if (!activeInstance) throw new Error('No active instance')
  return activeInstance
}

export type { AppConfig }
