import React, { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  ArrowUpRight,
  Check,
  Coffee,
  Command,
  Cpu,
  Database,
  Download,
  FlaskConical,
  FolderOpen,
  HardDrive,
  Info,
  Keyboard,
  MemoryStick,
  Monitor,
  Moon,
  Save,
  Settings2,
  Sun,
  Terminal,
  Trash2,
  Wrench
} from 'lucide-react'
import type { CleanupGroup, Settings, ThemeMode } from '@shared/types'
import { formatBytes } from '@shared/utils'
import { ACCENTS } from '@shared/utils'
import { useApp } from '../store'
import { Button, classNames, Divider, Modal, ModalHeader, Pill, Segmented, Switch } from '../components/ui'
import Background from '../components/Background'
import logo from '../assets/logo.png'

const WINDOW_PRESETS = [
  { width: 1280, height: 720, label: '720p' },
  { width: 1600, height: 900, label: '900p' },
  { width: 1920, height: 1080, label: '1080p' },
  { width: 2560, height: 1440, label: '1440p' }
]

const THEME_OPTIONS: { value: ThemeMode; label: string; hint: string; icon: typeof Moon }[] = [
  { value: 'dark', label: '深色', hint: '红黑', icon: Moon },
  { value: 'light', label: '浅色', hint: '白蓝', icon: Sun },
  { value: 'system', label: '跟随系统', hint: '自动', icon: Monitor }
]

export default function GlobalSettingsPage(): React.JSX.Element {
  const { config, system, themeMode, themeSchedule, setTheme, setThemeSchedule, updateGlobal, pushToast, boot, activeInstance, personalization, updatePersonalization } = useApp()
  const [formState, setFormState] = useState<Settings | null>(null)
  const [busy, setBusy] = useState(false)
  const [diagBusy, setDiagBusy] = useState(false)
  const [diagnostics, setDiagnostics] = useState<string[]>([])
  const [cleanupOpen, setCleanupOpen] = useState(false)
  const [cleanupGroups, setCleanupGroups] = useState<CleanupGroup[]>([])
  const [cleanupSelected, setCleanupSelected] = useState<Set<string>>(new Set())
  const [cleanupBusy, setCleanupBusy] = useState(false)
  const [uninstallOpen, setUninstallOpen] = useState(false)
  const [purgeOnUninstall, setPurgeOnUninstall] = useState(false)
  const [purging, setPurging] = useState(false)
  const baseline = useMemo(() => (config ? JSON.stringify(config.global) : ''), [config])
  const dirty = formState ? JSON.stringify(formState) !== baseline : false

  useEffect(() => {
    if (config && !formState) setFormState(config.global)
  }, [config, formState])

  const form = formState ?? config?.global ?? null
  if (!config || !system) {
    return (
      <div className="page global-settings-page">
        <Background />
        <div className="page-head"><div><h1>设置</h1><p>正在读取启动器配置…</p></div></div>
        <div className="settings-loading"><span /><span /><span /></div>
      </div>
    )
  }
  if (!form) return <div className="page" />

  const patch = (value: Partial<Settings>) => setFormState((prev) => (prev ? { ...prev, ...value } : prev))
  const totalMem = Math.max(8192, system.totalMemMb)

  const save = async () => {
    if (!form) return
    setBusy(true)
    try {
      await updateGlobal(form)
      pushToast({ tone: 'success', title: '全局默认设置已保存', message: '没有实例覆盖的项目将使用这些值。' })
    } catch (err) {
      pushToast({ tone: 'error', title: '保存失败', message: err instanceof Error ? err.message : String(err) })
    } finally {
      setBusy(false)
    }
  }

  const runDiagnostic = async (label: string, action: () => Promise<string>) => {
    if (diagBusy) return
    setDiagBusy(true)
    try {
      const message = await action()
      setDiagnostics((prev) => [`[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] ${label}：${message}`, ...prev].slice(0, 8))
    } catch (err) {
      setDiagnostics((prev) => [`[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] ${label} 失败：${err instanceof Error ? err.message : String(err)}`, ...prev].slice(0, 8))
    } finally {
      setDiagBusy(false)
    }
  }

  const crashCleanupIds = ['crash-reports', 'hs-err', 'log-archives', 'launch-logs', 'crash-history']

  const openCleanup = async (allCrash = false) => {
    setCleanupBusy(true)
    try {
      const groups = await window.ember.maintenance.scan()
      setCleanupGroups(groups)
      setCleanupSelected(
        new Set(
          allCrash
            ? crashCleanupIds.filter((id) => (groups.find((group) => group.id === id)?.count ?? 0) > 0)
            : groups.filter((group) => group.count > 0).map((group) => group.id)
        )
      )
      setCleanupOpen(true)
    } catch (err) {
      pushToast({ tone: 'error', title: '扫描失败', message: err instanceof Error ? err.message : String(err) })
    } finally {
      setCleanupBusy(false)
    }
  }

  const runCleanup = async () => {
    if (!cleanupSelected.size) {
      pushToast({ tone: 'warning', title: '没有选择要清理的项目' })
      return
    }
    setCleanupBusy(true)
    try {
      const result = await window.ember.maintenance.clean([...cleanupSelected])
      pushToast({ tone: 'success', title: '清理完成', message: `已删除 ${result.removed} 项，释放 ${formatBytes(result.freed)}` })
      setCleanupOpen(false)
    } catch (err) {
      pushToast({ tone: 'error', title: '清理失败', message: err instanceof Error ? err.message : String(err) })
    } finally {
      setCleanupBusy(false)
    }
  }

  const uninstall = async () => {
    setUninstallOpen(false)
    if (!purgeOnUninstall) {
      try {
        await window.ember.maintenance.uninstall()
      } catch (err) {
        pushToast({ tone: 'error', title: '无法启动卸载程序', message: err instanceof Error ? err.message : String(err) })
      }
      return
    }
    setPurging(true)
    let summary = ''
    try {
      const result = await window.ember.maintenance.purge(true)
      summary = result.failed.length
        ? `已删除 ${result.removed.length} 个目录，${result.failed.length} 个被占用`
        : `已删除 ${result.removed.length} 个目录`
    } catch (err) {
      setPurging(false)
      pushToast({ tone: 'error', title: '彻底删除失败', message: err instanceof Error ? err.message : String(err) })
      return
    }
    try {
      await window.ember.maintenance.uninstall()
    } catch (err) {
      setPurging(false)
      pushToast({ tone: 'warning', title: summary, message: err instanceof Error ? err.message : String(err) })
      return
    }
    pushToast({ tone: 'success', title: '正在卸载并删除数据', message: summary })
    setPurging(false)
  }

  return (
    <div className="page global-settings-page">
      <Background variant="default" />
      <div className="page-head">
        <div>
          <h1>设置</h1>
          <p>主题、下载与默认启动参数。实例可以单独覆盖。</p>
        </div>
        <div className="page-head-actions">
          {dirty ? <Pill tone="warning" dot>未保存</Pill> : <Pill tone="success" dot>已保存</Pill>}
          <Button variant="primary" icon={Save} loading={busy} disabled={!dirty} onClick={() => void save()}>
            保存
          </Button>
        </div>
      </div>

      <div className="settings-layout global-layout">
        <main className="settings-main">
          <section className="settings-panel">
            <div className="panel-title">
              <span className="panel-title-icon"><Sun size={18} /></span>
              <div>
                <h2>主题</h2>
                <p>深色为红黑配色，浅色为高不透明度白蓝。</p>
              </div>
            </div>
            <div className="theme-choices">
              {THEME_OPTIONS.map((option) => {
                const Icon = option.icon
                return (
                  <button key={option.value} type="button" className={classNames('theme-choice', themeMode === option.value && 'is-active')} onClick={() => setTheme(option.value)}>
                    <span className="theme-choice-icon"><Icon size={18} /></span>
                    <span>
                      <strong>{option.label}</strong>
                      <em>{option.hint}</em>
                    </span>
                    {themeMode === option.value ? <Check size={15} /> : null}
                  </button>
                )
              })}
            </div>
            <div className="settings-card theme-schedule">
              <div className="setting-line">
                <div>
                  <strong>随时间切换浅色 / 深色</strong>
                  <p>按本地时间自动切换启动器外观；开启后覆盖上面的手动主题。</p>
                </div>
                <Switch
                  checked={themeSchedule.enabled}
                  onChange={(enabled) => {
                    void setThemeSchedule({ ...themeSchedule, enabled })
                    pushToast({ tone: 'info', title: enabled ? '已开启定时主题' : '已关闭定时主题' })
                  }}
                  label="定时主题"
                />
              </div>
              <div className="dual-fields">
                <label className="field">
                  <span className="field-label">浅色开始</span>
                  <input
                    type="time"
                    className="text-input"
                    value={themeSchedule.lightStart}
                    onChange={(event) => void setThemeSchedule({ ...themeSchedule, lightStart: event.target.value })}
                  />
                </label>
                <label className="field">
                  <span className="field-label">深色开始</span>
                  <input
                    type="time"
                    className="text-input"
                    value={themeSchedule.darkStart}
                    onChange={(event) => void setThemeSchedule({ ...themeSchedule, darkStart: event.target.value })}
                  />
                </label>
              </div>
              <p className="field-hint">例如 07:00 浅色、19:00 深色；支持跨午夜的自定义时间段。</p>
            </div>
          </section>

          <Divider label="启动器个性化" />

          <section className="settings-panel">
            <div className="panel-title">
              <span className="panel-title-icon"><Settings2 size={18} /></span>
              <div>
                <h2>外观与动效</h2>
                <p>强调色会应用到按钮、选中状态与高光；背景强度只影响环境层。</p>
              </div>
            </div>
            <div className="settings-card">
              <div className="personalization-label">强调色</div>
              <div className="accent-picker">
                {ACCENTS.map((accent) => (
                  <button
                    key={accent.key}
                    type="button"
                    className={classNames('accent-swatch', personalization.accent === accent.key && 'is-selected')}
                    style={{ '--swatch': accent.from, '--swatch-2': accent.to } as React.CSSProperties}
                    onClick={() => void updatePersonalization({ accent: accent.key })}
                    title={accent.label}
                  >
                    <span />
                    <em>{accent.label}</em>
                  </button>
                ))}
              </div>
              <div className="setting-line personalization-line">
                <div>
                  <strong>背景强度</strong>
                  <p>控制极光与尘埃粒子的可见程度。</p>
                </div>
                <Segmented
                  compact
                  value={personalization.ambient}
                  options={[
                    { value: 'subtle', label: '克制' },
                    { value: 'normal', label: '标准' },
                    { value: 'vivid', label: '浓郁' }
                  ]}
                  onChange={(value) => void updatePersonalization({ ambient: value as 'subtle' | 'normal' | 'vivid' })}
                />
              </div>
              <div className="setting-line personalization-line">
                <div>
                  <strong>界面动效</strong>
                  <p>关闭后页面仍可用，但入场、悬停与弹窗动画会降级。</p>
                </div>
                <Switch checked={personalization.motion} onChange={(value) => void updatePersonalization({ motion: value })} label="界面动效" />
              </div>
            </div>
          </section>

          <Divider label="默认启动设置" />

          <section className="settings-panel">
            <div className="panel-title">
              <span className="panel-title-icon"><Wrench size={18} /></span>
              <div>
                <h2>默认启动设置</h2>
                <p>实例没有覆盖时使用这些值。</p>
              </div>
            </div>

            <div className="settings-card">
              <div className="field">
                <div className="field-label-row">
                  <label className="field-label">内存上限 <em>MAX HEAP</em></label>
                  <Pill tone="accent">{form.memoryMax} MB</Pill>
                </div>
                <div className="memory-slider">
                  <span className="memory-fill" style={{ width: `${Math.min(100, (form.memoryMax / totalMem) * 100)}%` }} />
                  <input type="range" min={1024} max={Math.min(32768, Math.floor(totalMem / 1024) * 1024)} step={512} value={form.memoryMax} onChange={(e) => patch({ memoryMax: Math.max(Number(e.target.value), form.memoryMin + 256) })} />
                </div>
                <div className="slider-labels">
                  <span>1 GB</span>
                  <span>物理内存 {formatBytes(system.totalMemMb * 1024 * 1024)}</span>
                  <span>{Math.min(32, Math.round(totalMem / 1024))} GB</span>
                </div>
              </div>
              <div className="dual-fields">
                <div className="field">
                  <label className="field-label">最小内存 <em>MIN</em></label>
                  <input className="text-input mono" type="number" step={256} value={form.memoryMin} onChange={(e) => patch({ memoryMin: Math.max(256, Math.min(Number(e.target.value), form.memoryMax - 256)) })} />
                </div>
                <div className="field">
                  <label className="field-label">最大内存 <em>MAX</em></label>
                  <input className="text-input mono" type="number" step={256} value={form.memoryMax} onChange={(e) => patch({ memoryMax: Math.max(Number(e.target.value), form.memoryMin + 256) })} />
                </div>
              </div>
            </div>

            <div className="settings-card">
              <div className="window-presets">
                {WINDOW_PRESETS.map((preset) => (
                  <button key={preset.label} type="button" className={classNames(form.windowWidth === preset.width && form.windowHeight === preset.height && !form.fullscreen && 'is-active')} onClick={() => patch({ windowWidth: preset.width, windowHeight: preset.height, fullscreen: false })}>
                    <span className="window-shape" style={{ aspectRatio: `${preset.width}/${preset.height}` }} />
                    <strong>{preset.label}</strong>
                    <em>{preset.width} × {preset.height}</em>
                  </button>
                ))}
              </div>
              <div className="field-grid three">
                <div className="field">
                  <label className="field-label">窗口宽度 <em>WIDTH</em></label>
                  <input className="text-input mono" type="number" value={form.windowWidth} onChange={(e) => patch({ windowWidth: Number(e.target.value) })} />
                </div>
                <div className="field">
                  <label className="field-label">窗口高度 <em>HEIGHT</em></label>
                  <input className="text-input mono" type="number" value={form.windowHeight} onChange={(e) => patch({ windowHeight: Number(e.target.value) })} />
                </div>
                <div className="field switch-field">
                  <label className="field-label">全屏启动 <em>FULLSCREEN</em></label>
                  <Switch checked={form.fullscreen} onChange={(value) => patch({ fullscreen: value })} label="全屏启动" />
                </div>
              </div>
              <div className="setting-line">
                <div>
                  <strong>启动后行为</strong>
                  <p>游戏进程唤起后，启动器窗口的处理方式。</p>
                </div>
                <Segmented
                  value={form.afterLaunch}
                  onChange={(value) => patch({ afterLaunch: value })}
                  options={[
                    { value: 'keep', label: '保持' },
                    { value: 'minimize', label: '最小化' },
                    { value: 'tray', label: '托盘' }
                  ]}
                  className="after-launch-global"
                />
              </div>
            </div>

            <div className="settings-card">
              <div className="field-grid">
                <div className="field">
                  <label className="field-label">Java 模式 <em>RUNTIME</em></label>
                  <Segmented
                    value={form.javaMode}
                    onChange={(value) => patch({ javaMode: value })}
                    options={[
                      { value: 'auto', label: '自动管理' },
                      { value: 'manual', label: '手动指定' }
                    ]}
                    className="java-mode-global"
                  />
                </div>
                <div className="field">
                  <label className="field-label">Java 路径 <em>MANUAL PATH</em></label>
                  <input className="text-input mono" value={form.javaPath} disabled={form.javaMode === 'auto'} onChange={(e) => patch({ javaPath: e.target.value })} placeholder="留空则使用自动管理" />
                </div>
              </div>
              <div className="field-grid">
                <div className="field">
                  <label className="field-label">默认 JVM 参数 <em>JVM ARGS</em></label>
                  <textarea className="text-input mono code" rows={3} value={form.jvmArgs} onChange={(e) => patch({ jvmArgs: e.target.value })} placeholder="-XX:+UseG1GC" spellCheck={false} />
                </div>
                <div className="field">
                  <label className="field-label">默认游戏参数 <em>GAME ARGS</em></label>
                  <textarea className="text-input mono code" rows={3} value={form.gameArgs} onChange={(e) => patch({ gameArgs: e.target.value })} placeholder="--width 1920 --height 1080" spellCheck={false} />
                </div>
              </div>
            </div>
          </section>

          <Divider label="下载" />

          <section className="settings-panel">
            <div className="panel-title">
              <span className="panel-title-icon"><Download size={18} /></span>
              <div>
                <h2>下载优化</h2>
                <p>多线程同时下载；实时测速官方、BMCLAPI 与 QLU 镜像，慢时自动切换。</p>
              </div>
            </div>
            <div className="settings-card">
              <div className="setting-line">
                <div>
                  <strong>智能镜像与线程调度</strong>
                  <p>开启后按实时速度选择源，并在官方明显偏慢时优先使用镜像。</p>
                </div>
                <Switch checked={form.smartDownload} onChange={(value) => patch({ smartDownload: value })} label="智能镜像" />
              </div>
              <div className="field">
                <div className="field-label-row">
                  <label className="field-label">最大下载线程</label>
                  <div className="download-number-row">
                    <Pill tone="accent">{form.downloadThreads} 线程</Pill>
                    <input
                      className="text-input download-number"
                      type="number"
                      min={4}
                      max={128}
                      value={form.downloadThreads}
                      onChange={(event) => patch({ downloadThreads: Math.max(4, Math.min(128, Number(event.target.value) || 4)) })}
                    />
                  </div>
                </div>
                <input
                  className="download-range"
                  type="range"
                  min={4}
                  max={64}
                  step={2}
                  value={Math.min(64, form.downloadThreads)}
                  onChange={(event) => patch({ downloadThreads: Number(event.target.value) })}
                />
                <div className="slider-labels">
                  <span>4</span>
                  <span>默认 32 · 滑条 4–64，输入框最大 128</span>
                  <span>64</span>
                </div>
              </div>
              <div className="field">
                <div className="field-label-row">
                  <label className="field-label">下载限速</label>
                  <Pill tone={form.downloadLimit ? 'warning' : 'success'}>
                    {form.downloadLimit ? `${form.downloadLimit} MB/s` : '无限制'}
                  </Pill>
                </div>
                <input
                  className="download-range"
                  type="range"
                  min={0}
                  max={20}
                  step={1}
                  value={form.downloadLimit}
                  onChange={(event) => patch({ downloadLimit: Number(event.target.value) })}
                />
                <div className="slider-labels">
                  <span>不限制</span>
                  <span>限制所有下载的总速度，防止占满带宽</span>
                  <span>20 MB/s</span>
                </div>
              </div>
              <div className="inline-notice">
                <Download size={15} />
                <p>官方过慢或超时会自动尝试 BMCLAPI / QLU 镜像；单个大文件会先测速再选源。校验失败的源会被降权。</p>
              </div>
            </div>
          </section>

          <Divider label="高级设置" />

          <section className="settings-panel">
            <div className="panel-title">
              <span className="panel-title-icon"><FlaskConical size={18} /></span>
              <div>
                <h2>高级设置 · 功能自检</h2>
                <p>在启动器内验证 Modrinth、外观、统一设置与更新检测，不会启动游戏。</p>
              </div>
            </div>
            <div className="settings-card">
              <div className="diagnostic-actions">
                <Button
                  variant="secondary"
                  icon={FlaskConical}
                  loading={diagBusy}
                  onClick={() => void runDiagnostic('modrinth', async () => {
                    const data = await window.ember.modrinth.search({ query: 'sodium', type: 'mod', gameVersion: activeInstance?.mcVersion, limit: 3 })
                    return `Modrinth 搜索成功：${data.total_hits} 个结果；首个：${data.hits[0]?.title ?? '无'}`
                  })}
                >
                  测试 Modrinth 搜索
                </Button>
                <Button
                  variant="secondary"
                  icon={FlaskConical}
                  loading={diagBusy}
                  onClick={() => void runDiagnostic('tags', async () => {
                    const tags = await window.ember.modrinth.tags()
                    return `标签接口：${tags.loaders.length} 个加载器，${tags.gameVersions.length} 个游戏版本`
                  })}
                >
                  测试标签接口
                </Button>
                <Button
                  variant="secondary"
                  icon={FlaskConical}
                  loading={diagBusy}
                  onClick={() => void runDiagnostic('appearance', async () => {
                    const data = await window.ember.skin.get()
                    return `外观模式：${data.mode ?? 'none'}；万用皮肤补丁：${data.local?.detected ? '已检测' : '未检测'}${data.local?.detected ? `；皮肤 ${data.local.skinDir}；披风 ${data.local.capeDir}` : ''}`
                  })}
                >
                  检测外观模式
                </Button>
                <Button
                  variant="secondary"
                  icon={FlaskConical}
                  loading={diagBusy}
                  disabled={!activeInstance}
                  onClick={() => void runDiagnostic('update', async () => {
                    if (!activeInstance) throw new Error('没有当前实例')
                    const list = await window.ember.modrinth.simulateUpdate(activeInstance.id)
                    return `模拟模组更新：检测到 ${list.length} 个更新；首个：${list[0]?.title ?? '无'} ${list[0]?.currentVersionNumber ?? ''} → ${list[0]?.latestVersionNumber ?? ''}`
                  })}
                >
                  模拟模组更新
                </Button>
                <Button
                  variant="secondary"
                  icon={FlaskConical}
                  loading={diagBusy}
                  disabled={!activeInstance}
                  onClick={() => void runDiagnostic('options', async () => {
                    if (!activeInstance) throw new Error('没有当前实例')
                    const data = await window.ember.gameSettings.read(activeInstance.id)
                    return `统一设置读取：${data.path}（${data.exists ? '存在' : '尚未生成'}，${Object.keys(data.values).length} 个键）`
                  })}
                >
                  测试统一设置
                </Button>
              </div>
              <div className="diagnostic-log">
                {diagnostics.length ? diagnostics.map((line, index) => <code key={index}>{line}</code>) : <p>选择一项测试以查看结果。</p>}
              </div>
            </div>
          </section>

          <Divider label="清理与卸载" />

          <section className="settings-panel">
            <div className="panel-title">
              <span className="panel-title-icon"><Trash2 size={18} /></span>
              <div>
                <h2>清理不需要的文件</h2>
                <p>只清理崩溃报告、历史日志、启动日志、解析缓存和临时下载，不会删除存档或模组。</p>
              </div>
            </div>
            <div className="settings-card cleanup-actions">
              <Button variant="danger" icon={Trash2} loading={cleanupBusy} onClick={() => void openCleanup(true)}>
                清除所有崩溃记录
              </Button>
              <Button variant="secondary" icon={Trash2} loading={cleanupBusy} onClick={() => void openCleanup(false)}>
                自定义清理
              </Button>
              <Button variant="ghost" icon={Trash2} onClick={() => setUninstallOpen(true)}>
                卸载 ELYTRA
              </Button>
            </div>
            <div className="inline-notice">
              <Info size={15} />
              <p>卸载按钮只会启动 Windows 卸载程序；不会在开发环境或未安装版本中执行。</p>
            </div>
          </section>
        </main>
        <div className="settings-data-row">
          <span>启动器版本</span>
          <code>ELYTRA {system.appVersion} · Electron {system.electron}</code>
          <span />
        </div>
        <div className="settings-data-row">
          <span>数据目录</span>
          <code>{system.dataDir}</code>
          <button type="button" onClick={() => void window.ember.app.openPath(system.dataDir)}>
            <FolderOpen size={14} /> 打开
          </button>
        </div>
      </div>

      <div className={classNames('settings-savebar', dirty && 'is-dirty')}>
        <div>
          <span className={classNames('save-dot', dirty && 'is-dirty')} />
          {dirty ? '有未保存的更改' : '设置已保存'}
        </div>
        <Button variant="primary" icon={Save} loading={busy} disabled={!dirty} onClick={() => void save()}>
          保存
        </Button>
      </div>

      <Modal open={cleanupOpen} onClose={() => !cleanupBusy && setCleanupOpen(false)} size="md">
        <ModalHeader
          eyebrow="CLEANUP"
          title="选择要清理的内容"
          description="崩溃记录和日志可以删除；缓存会在需要时重新生成。存档、模组和整合包文件不会被删除。"
          onClose={() => !cleanupBusy && setCleanupOpen(false)}
        />
        <div className="cleanup-list">
          {cleanupGroups.map((group) => (
            <button
              key={group.id}
              type="button"
              className={classNames('cleanup-row', cleanupSelected.has(group.id) && 'is-selected', group.count === 0 && 'is-empty')}
              disabled={group.count === 0}
              onClick={() =>
                setCleanupSelected((prev) => {
                  const next = new Set(prev)
                  if (next.has(group.id)) next.delete(group.id)
                  else next.add(group.id)
                  return next
                })
              }
            >
              <span className="ui-check">{cleanupSelected.has(group.id) ? <Check size={12} strokeWidth={3} /> : null}</span>
              <span className="cleanup-copy">
                <strong>{group.label}</strong>
                <em>{group.detail}</em>
              </span>
              <span className="cleanup-size">{group.count} 项 · {formatBytes(group.size)}</span>
            </button>
          ))}
        </div>
        <div className="modal-actions">
          <Button variant="ghost" onClick={() => setCleanupOpen(false)} disabled={cleanupBusy}>取消</Button>
          <Button variant="danger" icon={Trash2} loading={cleanupBusy} onClick={() => void runCleanup()}>
            清理选中项目
          </Button>
        </div>
      </Modal>

      <Modal open={uninstallOpen} onClose={() => setUninstallOpen(false)} size="sm">
        <ModalHeader
          eyebrow="UNINSTALL"
          title="卸载 ELYTRA？"
          description="将打开 Windows 卸载程序移除启动器。实例与存档默认保留，也可以在下一步选择彻底删除。"
          onClose={() => setUninstallOpen(false)}
        />
        <div className="uninstall-options">
          <button
            type="button"
            className={classNames('uninstall-row', !purgeOnUninstall && 'is-selected')}
            onClick={() => setPurgeOnUninstall(false)}
          >
            <span className="ui-check" data-radio="1">{!purgeOnUninstall ? <span className="ui-check-dot" /> : null}</span>
            <span className="cleanup-copy">
              <strong>仅卸载启动器</strong>
              <em>保留 %APPDATA%\ELYTRA 与 %APPDATA%\.ember，实例、存档和模组不会丢失。</em>
            </span>
          </button>
          <button
            type="button"
            className={classNames('uninstall-row', purgeOnUninstall && 'is-selected is-danger')}
            onClick={() => setPurgeOnUninstall(true)}
          >
            <span className="ui-check" data-radio="1">{purgeOnUninstall ? <span className="ui-check-dot" /> : null}</span>
            <span className="cleanup-copy">
              <strong>彻底删除所有文件夹</strong>
              <em>卸载后删除 %APPDATA%\ELYTRA、%APPDATA%\.ember 与启动器设置，实例、存档、模组、账户全部清除，无法恢复。</em>
            </span>
          </button>
        </div>
        <div className="modal-actions">
          <Button variant="ghost" onClick={() => setUninstallOpen(false)}>取消</Button>
          <Button variant="danger" icon={Trash2} loading={purging} onClick={() => void uninstall()}>
            {purgeOnUninstall ? '卸载并彻底删除' : '启动卸载程序'}
          </Button>
        </div>
      </Modal>
    </div>
  )
}
