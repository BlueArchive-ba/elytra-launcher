import { Notification, app } from 'electron'
import { spawn, execFile } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { Account } from 'eml-lib'
import EMLLib from 'eml-lib'
import type {
  InstanceRecord,
  LastLaunchSummary,
  LaunchEvent,
  LaunchPhase,
  LaunchStartResult,
  LaunchState,
  Settings
} from '../shared/types'
import { mergeSettings, resolveLaunchMode, splitArgs } from '../shared/utils'
import { ensureInstanceDirectory, EML_ROOT, gameDataDirFor } from './paths'
import { GameSettingsService } from './game-settings'
import { planLocalLaunch } from './local-launch'
import { configureDownload, setDownloadLogger } from './download-optimizer'
import type { ConfigStore } from './store'
import type { AuthService } from './auth'
import type { ModpackService } from './modpack'
import type { VersionService } from './versions'
import type { SkinService } from './skin'

const PHASE_LABEL: Record<LaunchPhase, string> = {
  idle: '待命',
  preparing: '准备启动',
  compute: '计算依赖',
  download: '下载游戏资源',
  loader: '安装加载器',
  extract: '解压本地库',
  assets: '复制资源索引',
  patch: '写入加载器补丁',
  java: '检查 Java 运行时',
  clean: '整理实例目录',
  starting: '唤起 Minecraft',
  running: '游戏运行中',
  success: '启动完成',
  crashed: '进程崩溃',
  error: '启动失败'
}

const PHASE_PROGRESS: Record<LaunchPhase, number> = {
  idle: 0,
  preparing: 2,
  compute: 5,
  download: 10,
  loader: 72,
  extract: 79,
  assets: 83,
  patch: 87,
  java: 91,
  clean: 94,
  starting: 97,
  running: 100,
  success: 100,
  crashed: 100,
  error: 100
}

const RUNNING_PATTERN =
  /Sound engine started|OpenAL initialized|Backend library: LWJGL|Setting user:|Reloading ResourceManager|Created:.*minecraft|Forge mod loading complete|ModLauncher running|Bootstrap.*took/i

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function stripAnsi(input: string): string {
  return input.replace(/\u001b\[[0-9;]*m/g, '')
}

function friendlyError(error: unknown): string {
  const err = error as { code?: string; message?: string }
  const code = err?.code ?? ''
  const raw = err?.message ?? String(error)
  const mapping: Record<string, string> = {
    FETCH_ERROR: '网络请求失败：无法获取游戏清单，请检查网络、代理或 DNS',
    DOWNLOAD_ERROR: '文件下载失败：资源服务器拒绝或网络中断',
    EXEC_ERROR: '无法启动 Java 进程：请检查 Java 路径与杀毒软件拦截',
    JAVA_ERROR: 'Java 运行时检查失败：版本或路径不正确',
    CONFIG_ERROR: '启动配置无效：请检查版本、加载器与内存设置',
    PATCHER_ERROR: '加载器补丁失败：安装文件可能损坏，请重试',
    MINECRAFT_ERROR: 'Minecraft 版本不可用：请重新选择版本',
    AUTH_ERROR: '账户认证失败：请重新登录',
    HASH_ERROR: '文件校验失败：磁盘或网络可能存在问题',
    FILE_ERROR: '实例文件操作失败：请检查目录权限',
    UNKNOWN_OS: '当前操作系统不受 EML 支持'
  }
  return mapping[code] ?? raw.split('\n')[0]
}

export class LaunchService {
  private state: LaunchState = {
    instanceId: null,
    status: 'idle',
    phase: 'idle',
    progress: 0,
    message: '等待启动',
    logs: []
  }
  private current: {
    instance: InstanceRecord
    account: Account
    mode: 'ember' | 'local'
    launcher?: InstanceType<typeof EMLLib.Launcher>
    child?: ChildProcess
    startedAt: number
    spawnedAt?: number
    logFile?: string
    logStream?: fs.WriteStream
    timer?: NodeJS.Timeout
  } | null = null
  private lastProgressAt = 0
  private lastLogs: Record<string, LastLaunchSummary> = {}
  private cancelRequested = false
  private stopping = false

  constructor(
    private store: ConfigStore,
    private auth: AuthService,
    private modpack: ModpackService,
    private versions: VersionService,
    private broadcast: (event: LaunchEvent) => void,
    private afterSpawn: (settings: Settings) => void,
    private demo = false,
    private skin?: SkinService
  ) {
    this.lastLogs = store.get().lastLaunches ?? {}
  }

  getState(): LaunchState {
    return { ...this.state, logs: [...this.state.logs] }
  }

  async stopGame(): Promise<{ stopped: boolean }> {
    if (!this.current || this.state.status !== 'running') return { stopped: false }
    this.stopping = true
    this.log('用户请求停止游戏')
    const child = this.current.child
    if (child && !child.killed) {
      try {
        child.kill()
        return { stopped: true }
      } catch {
        /* fall through to process lookup */
      }
    }
    const gameDir = gameDataDirFor(this.current.instance)
    if (process.platform === 'win32') {
      const escaped = gameDir.replace(/'/g, "''")
      const script = [
        `$targets = Get-CimInstance Win32_Process -Filter "Name = 'java.exe' OR Name = 'javaw.exe'" | Where-Object { $_.CommandLine -like '*${escaped}*' }`,
        'if ($targets) { $targets | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; exit 0 }',
        'exit 1'
      ].join('; ')
      return await new Promise((resolve) => {
        execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true }, (error) => {
          resolve({ stopped: !error })
        })
      })
    }
    return await new Promise((resolve) => {
      execFile('pkill', ['-f', gameDir], (error) => resolve({ stopped: !error }))
    })
  }

  cancel(): LaunchState {
    if (!this.current) return this.getState()
    this.cancelRequested = true
    this.log('用户取消启动')
    const child = this.current.child
    if (child && !child.killed) {
      try {
        child.kill()
      } catch {
      }
    }
    this.state.status = 'error'
    this.state.phase = 'error'
    this.state.progress = 100
    this.state.message = '启动已取消'
    this.state.finishedAt = Date.now()
    this.emit('error', { withLogs: true })
    this.cleanup()
    return this.getState()
  }

  getLast(instanceId: string): LastLaunchSummary | undefined {
    return this.lastLogs[instanceId]
  }

  private snapshot(withLogs = false): LaunchState {
    return {
      ...this.state,
      logs: withLogs ? [...this.state.logs] : []
    }
  }

  private emit(type: LaunchEvent['type'], opts: { withLogs?: boolean; line?: string } = {}): void {
    this.broadcast({
      type,
      state: this.snapshot(!!opts.withLogs),
      line: opts.line
    })
  }

  private log(line: string, type: LaunchEvent['type'] = 'log'): void {
    const clean = stripAnsi(line).replace(/\r$/, '')
    if (!clean.trim()) return
    const stamped = `[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] ${clean}`
    this.state.logs.push(stamped)
    if (this.state.logs.length > 300) this.state.logs.splice(0, this.state.logs.length - 300)
    try {
      this.current?.logStream?.write(`${stamped}\n`)
    } catch {
    }
    this.emit(type, { line: clean })
  }

  private setPhase(phase: LaunchPhase, message: string, options: { progress?: number; detail?: string } = {}): void {
    this.state.phase = phase
    this.state.progress = Math.max(this.state.progress, options.progress ?? PHASE_PROGRESS[phase])
    this.state.message = message
    this.state.detail = options.detail
    this.emit('phase', { withLogs: true })
    this.log(`── ${message}${options.detail ? ` · ${options.detail}` : ''} ──`)
  }

  private setStatus(status: LaunchState['status'], message?: string): void {
    this.state.status = status
    if (message) this.state.message = message
  }

  private sendProgress(progress: number, message: string, detail?: string, force = false): void {
    const now = Date.now()
    if (!force && now - this.lastProgressAt < 90) return
    this.lastProgressAt = now
    this.state.progress = Math.max(this.state.progress, Math.min(100, progress))
    if (message) this.state.message = message
    this.state.detail = detail
    this.emit('progress')
  }

  async start(instance: InstanceRecord): Promise<LaunchStartResult> {
    this.cancelRequested = false
    this.stopping = false
    if (this.current) {
      return {
        started: false,
        error: '已有启动任务正在进行，请等待当前进程退出',
        state: this.getState()
      }
    }
    if (this.demo) {
      void this.runDemo(instance)
      return { started: true, state: this.getState() }
    }

    const settings = mergeSettings(this.store.get().global, instance.overrides)
    const mode = resolveLaunchMode(instance)
    this.state = {
      instanceId: instance.id,
      instanceName: instance.name,
      launchMode: mode,
      status: 'preparing',
      phase: 'preparing',
      progress: 1,
      message: '准备启动',
      logs: [],
      startedAt: Date.now()
    }
    this.lastProgressAt = 0
    this.emit('state', { withLogs: true })

    try {
      if (mode === 'ember') await ensureInstanceDirectory(instance)
      const optionsApplied = await new GameSettingsService(this.store).applyIfMissing(instance).catch((err) => {
        this.log(`应用统一游戏设置失败：${err instanceof Error ? err.message : String(err)}`)
        return false
      })
      if (optionsApplied) this.log('已应用统一游戏设置到新版本')
      this.log(mode === 'local' ? '启动方式：本地已有游戏（直接启动，不下载）' : '启动方式：ELYTRA 安装与管理')
      this.log(`游戏目录：${gameDataDirFor(instance)}`)
      this.log(`版本：Minecraft ${instance.mcVersion} · ${instance.loader.type} ${instance.loader.version}`)
      this.log(`内存：${settings.memoryMin}–${settings.memoryMax} MB · Java：${settings.javaMode === 'auto' ? '自动' : settings.javaPath || '未设置'}`)

      const account = await this.auth.ensureFresh()
      this.log(`账户：${account.name} (${account.meta.type})`)

      const logFile = path.join(app.getPath('userData'), 'launch-logs', `${instance.id}-${Date.now()}.log`)
      fs.mkdirSync(path.dirname(logFile), { recursive: true })
      const logStream = fs.createWriteStream(logFile, { flags: 'a' })
      logStream.write(`ELYTRA LAUNCH SESSION ${new Date().toISOString()}\n`)
      logStream.write(`mode=${mode} instance=${instance.name} (${instance.id}) mc=${instance.mcVersion} loader=${instance.loader.type}:${instance.loader.version}\n\n`)
      this.current = {
        instance,
        account,
        mode,
        startedAt: Date.now(),
        logFile,
        logStream
      }
      this.state.logFile = logFile
      this.setStatus('launching', mode === 'local' ? '准备本地启动' : '开始启动流程')
      this.emit('state', { withLogs: true })
      configureDownload({ threads: settings.downloadThreads, smartMirror: settings.smartDownload, maxSpeed: settings.downloadLimit * 1024 * 1024 })
      setDownloadLogger((line) => this.log(line))

      if (mode === 'local') {
        await this.startLocal(settings)
        return { started: true, state: this.getState() }
      }

      let modpackUrl: string | undefined
      if (instance.modpack) {
        this.log(`整合包：${instance.modpack.name ?? instance.modpack.kind}`)
        await this.modpack.prepare(instance)
        modpackUrl = await this.modpack.manifestUrl(instance.modpack, gameDataDirFor(instance))
        if (!modpackUrl) throw new Error('无法为本地整合包清单建立访问地址')
      }

      if (settings.javaMode === 'manual') {
        if (!settings.javaPath.trim()) throw new Error('Java 模式为“手动”，但还没有选择 Java 可执行文件')
        if (!fs.existsSync(settings.javaPath)) throw new Error(`Java 路径不存在：${settings.javaPath}`)
      }

      const jvmArgs = splitArgs(settings.jvmArgs)
      const gameArgs = splitArgs(settings.gameArgs)

      const launcher = new EMLLib.Launcher({
        root: EML_ROOT,
        storage: 'isolated',
        account,
        cleaning: { enabled: false },
        profile: {
          slug: instance.slug,
          minecraft: {
            version: instance.mcVersion,
            loader: {
              loader: instance.loader.type,
              version: instance.loader.version
            },
            modpackUrl,
            args: gameArgs
          }
        },
        java:
          settings.javaMode === 'manual'
            ? { install: 'manual', absolutePath: settings.javaPath, args: jvmArgs }
            : { install: 'auto', args: jvmArgs },
        memory: { min: settings.memoryMin, max: settings.memoryMax },
        window: {
          width: settings.windowWidth,
          height: settings.windowHeight,
          fullscreen: settings.fullscreen
        }
      })

      if (this.current) this.current.launcher = launcher
      this.attach(launcher)

      void launcher.launch().catch((err) => this.onLaunchFailure(err))
      return { started: true, state: this.getState() }
    } catch (err) {
      this.onLaunchFailure(err)
      return { started: false, error: friendlyError(err), state: this.getState() }
    }
  }

  private async startLocal(settings: Settings): Promise<void> {
    const session = this.current
    if (!session) throw new Error('本地启动会话不存在')
    this.setPhase('preparing', '准备本地版本', { progress: 8 })
    this.log('本地启动不会下载、覆盖或重新安装任何文件')
    const plan = await planLocalLaunch(session.instance, settings, session.account, this.versions)
    this.log(`本地版本：${plan.versionId}`)
    this.log(`版本目录：${plan.versionDir}`)
    this.log(`游戏目录：${plan.gameDir}`)
    this.log(`Java：${plan.javaInfo.version} (${plan.javaInfo.arch}) · ${plan.javaPath}`)
    this.log(`运行库：${plan.classpathCount} 个 · natives：${plan.extractedNatives ? '已解压' : '使用现有目录'}`)
    this.setPhase('java', `使用 Java ${plan.javaInfo.major}`, { progress: 42 })
    this.setPhase('starting', '唤起 Minecraft', { progress: 94, detail: plan.versionId })

    let child: ChildProcess
    try {
      child = spawn(plan.javaPath, plan.args, {
        cwd: plan.cwd,
        env: process.env,
        windowsHide: false,
        stdio: ['ignore', 'pipe', 'pipe']
      })
    } catch (err) {
      throw new Error(`无法启动 Java：${err instanceof Error ? err.message : String(err)}`)
    }
    session.child = child
    session.spawnedAt = Date.now()
    this.attachLocal(child)
  }

  private attachLocal(child: ChildProcess): void {
    let buffer = ''
    const push = (chunk: Buffer | string) => {
      buffer += chunk.toString()
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.trim()) continue
        this.log(line)
        if (this.state.phase === 'starting' && RUNNING_PATTERN.test(line)) {
          this.setPhase('running', '游戏正在运行', { progress: 100 })
        }
      }
    }
    child.stdout?.on('data', push)
    child.stderr?.on('data', push)

    child.once('spawn', () => {
      if (!this.current) return
      this.setPhase('starting', 'Minecraft 进程已唤起', { progress: 97, detail: this.current.instance.name })
      this.setStatus('running')
      try {
        this.afterSpawn(mergeSettings(this.store.get().global, this.current.instance.overrides))
      } catch (err) {
        console.warn('[launch] afterSpawn handler failed:', err)
      }
      this.current.timer && clearTimeout(this.current.timer)
      this.current.timer = setTimeout(() => {
        if (this.state.status === 'running' && this.state.phase === 'starting') {
          this.setPhase('running', '游戏正在运行', { progress: 100 })
        }
      }, 7000)
      this.emit('state', { withLogs: true })
    })

    child.once('error', (err) => {
      this.log(`Java 进程启动失败：${err.message}`)
      this.onLaunchFailure(new Error(`无法启动 Java：${err.message}`))
    })

    child.once('exit', (code, signal) => {
      if (!this.current) return
      if (this.state.status === 'success' || this.state.status === 'crashed') return
      const exitCode = typeof code === 'number' ? code : -1
      if (signal && !code) {
        this.log(`Java 进程被信号 ${signal} 终止`)
      }
      this.finish(exitCode === 0 ? 'success' : 'crashed', exitCode)
    })
  }

  private attach(launcher: InstanceType<typeof EMLLib.Launcher>): void {
    const on = (event: string, cb: (...args: any[]) => void) => {
      // EML's EventEmitter is untyped at runtime; the public event names are stable.
      ;(launcher as unknown as { on: (name: string, fn: (...args: any[]) => void) => void }).on(event, cb)
    }

    on('launch_compute_download', () => {
      this.setPhase('compute', '计算缺失的依赖与资源')
    })

    on('launch_download', (data: { total?: { amount?: number; size?: number } }) => {
      const amount = data?.total?.amount ?? 0
      this.setPhase('download', '下载游戏资源', {
        progress: 12,
        detail: amount ? `${amount} 个文件 · 约 ${Math.round((data.total?.size ?? 0) / 1024 / 1024)} MB` : undefined
      })
    })

    on('download_progress', (data: { total?: { amount?: number }; downloaded?: { amount?: number; size?: number }; speed?: number }) => {
      const total = data?.total?.amount || 0
      const done = data?.downloaded?.amount || 0
      const ratio = total ? done / total : 0
      const speed = data?.speed ? `${(data.speed / 1024 / 1024).toFixed(1)} MB/s` : ''
      this.sendProgress(12 + ratio * 58, '下载游戏资源', `${done}/${total} 文件${speed ? ` · ${speed}` : ''}`)
    })

    on('download_error', (data: { filename?: string; message?: string }) => {
      this.log(`下载失败：${data?.filename ?? '未知文件'} · ${data?.message ?? ''}`)
    })

    on('launch_install_loader', (data: { loader?: { loader?: string; version?: string } }) => {
      this.setPhase('loader', '安装加载器', {
        detail: `${data?.loader?.loader ?? ''} ${data?.loader?.version ?? ''}`.trim()
      })
    })

    on('launch_extract_natives', () => this.setPhase('extract', '解压 native 本地库'))
    on('launch_copy_assets', () => this.setPhase('assets', '复制游戏资源'))
    on('launch_patch_loader', () => this.setPhase('patch', '写入加载器补丁'))
    on('launch_check_java', () => this.setPhase('java', '检查 Java 运行时'))

    on('launch_clean', () => this.setPhase('clean', '整理实例目录'))

    on('java_info', (data: { version?: string; arch?: string }) => {
      this.log(`Java ${data?.version ?? '?'} (${data?.arch ?? '?'})`)
      this.emit('java', { withLogs: true })
    })

    on('launch_launch', (data: { java?: { version?: string } }) => {
      this.setPhase('starting', 'Minecraft 进程已唤起', { progress: 97, detail: data?.java?.version ? `Java ${data.java.version}` : undefined })
      this.setStatus('running')
      if (this.current) this.current.spawnedAt = Date.now()
      try {
        this.afterSpawn(mergeSettings(this.store.get().global, this.current?.instance.overrides))
      } catch (err) {
        console.warn('[launch] afterSpawn handler failed:', err)
      }
      this.current?.timer && clearTimeout(this.current.timer)
      if (this.current) {
        this.current.timer = setTimeout(() => {
          if (this.state.status === 'running' && this.state.phase === 'starting') {
            this.setPhase('running', '游戏正在运行', { progress: 100 })
          }
        }, 7000)
      }
      this.emit('state', { withLogs: true })
    })

    on('launch_data', (line: string) => {
      this.log(String(line))
      if (this.state.phase === 'starting' && RUNNING_PATTERN.test(String(line))) {
        this.setPhase('running', '游戏正在运行', { progress: 100 })
      }
    })

    on('launch_debug', (line: string) => {
      this.log(String(line), 'debug')
    })

    on('launch_crash', (data: { code?: number; javaPath?: string; logsPath?: string }) => {
      this.log(`检测到崩溃事件，退出码 ${data?.code ?? '?'}`, 'crash')
      this.state.exitCode = data?.code
      if (this.state.status !== 'crashed') {
        this.finish('crashed', data?.code ?? -1)
      }
    })

    on('launch_close', (code: number | null) => {
      const exitCode = code ?? -1
      if (this.state.status === 'crashed' || this.state.status === 'success') return
      this.finish(exitCode === 0 ? 'success' : 'crashed', exitCode)
    })

    on('clean_error', (data: { filename?: string; message?: string }) => {
      this.log(`清理警告：${data?.filename} · ${data?.message}`)
    })
    on('patch_error', (data: { filename?: string; message?: string }) => {
      this.log(`补丁警告：${data?.filename} · ${data?.message}`)
    })
    on('download_end', () => {
      this.sendProgress(70, '资源下载完成', undefined, true)
    })
  }

  private onLaunchFailure(err: unknown): void {
    const message = friendlyError(err)
    this.log(`启动失败：${message}`)
    const raw = (err as { stack?: string })?.stack
    if (raw) this.log(raw)
    this.state.status = 'error'
    this.state.phase = 'error'
    this.state.progress = 100
    this.state.message = message
    this.state.detail = (err as { code?: string })?.code
    this.state.finishedAt = Date.now()
    this.emit('error', { withLogs: true })
    this.persistLast('error')
    this.cleanup()
  }

  private finish(status: 'success' | 'crashed', exitCode: number): void {
    const session = this.current
    if (!session) return
    const stopped = this.stopping
    this.stopping = false
    const finalStatus = stopped ? 'success' : status
    this.state.status = finalStatus
    this.state.phase = finalStatus === 'success' ? 'success' : 'crashed'
    this.state.progress = 100
    this.state.exitCode = exitCode
    this.state.finishedAt = Date.now()
    this.state.message = stopped
      ? '游戏已停止'
      : finalStatus === 'success'
        ? '游戏已正常退出'
        : `游戏崩溃退出（代码 ${exitCode}）`
    this.log(this.state.message, finalStatus === 'success' ? 'complete' : 'crash')
    if (session.spawnedAt) {
      const played = Math.max(0, Date.now() - session.spawnedAt)
      this.store.markPlayed(session.instance.id, played)
    }
    this.persistLast(finalStatus, exitCode)
    this.emit('complete', { withLogs: true })
    if (finalStatus === 'crashed' && Notification.isSupported()) {
      try {
        new Notification({
          title: 'Minecraft 崩溃了',
          body: `${session.instance.name} 异常退出。EMBER 已保存本次日志，可在崩溃分析中查看。`
        }).show()
      } catch {
      }
    }
    this.cleanup()
  }

  private persistLast(status: 'success' | 'crashed' | 'error', exitCode?: number): void {
    const session = this.current
    if (!session) return
    const summary: LastLaunchSummary = {
      at: Date.now(),
      status,
      exitCode,
      logFile: session.logFile
    }
    this.lastLogs[session.instance.id] = summary
    this.store.update((cfg) => {
      cfg.lastLaunches = { ...(cfg.lastLaunches ?? {}), [session.instance.id]: summary }
    })
  }

  private cleanup(): void {
    if (this.current?.timer) clearTimeout(this.current.timer)
    try {
      this.current?.logStream?.end()
    } catch {
    }
    setDownloadLogger(null)
    this.current = null
  }

  private async runDemo(instance: InstanceRecord): Promise<void> {
    if (this.current) return
    const settings = mergeSettings(this.store.get().global, instance.overrides)
    this.state = {
      instanceId: instance.id,
      instanceName: instance.name,
      launchMode: 'ember',
      status: 'launching',
      phase: 'preparing',
      progress: 2,
      message: '准备启动',
      logs: [],
      startedAt: Date.now()
    }
    this.current = { instance, account: { name: 'Ember' } as Account, mode: 'ember', startedAt: Date.now() }
    this.emit('state', { withLogs: true })
    const steps: [LaunchPhase, string, number, string][] = [
      ['preparing', '核查实例目录与账户', 4, '~/.ember/crimson-depths'],
      ['compute', '计算缺失的依赖与资源', 8, '读取版本清单'],
      ['download', '下载游戏资源', 24, 'assets · libraries'],
      ['download', '下载游戏资源', 55, '192 / 423 文件 · 8.4 MB/s'],
      ['loader', '安装加载器', 74, 'neoforge 21.1.209'],
      ['patch', '写入加载器补丁', 86, 'injecting launcher'],
      ['java', '检查 Java 运行时', 93, 'Java 21 · 64-bit'],
      ['starting', '唤起 Minecraft', 98, 'org.lwjgl'],
      ['running', '游戏正在运行', 100, '']
    ]
    for (const [phase, message, progress, detail] of steps) {
      await sleep(520)
      this.setPhase(phase, message, { progress, detail })
      this.log(`[demo] ${message}${detail ? ` · ${detail}` : ''}`)
      if (phase === 'running') {
        this.state.status = 'running'
        this.state.progress = 100
        this.emit('state', { withLogs: true })
      }
    }
    this.current = null
  }
}
