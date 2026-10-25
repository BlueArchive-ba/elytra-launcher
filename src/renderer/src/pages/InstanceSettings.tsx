import React, { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronRight,
  Coffee,
  Copy,
  Cpu,
  FileArchive,
  FileJson,
  FileText,
  FolderOpen,
  Gauge,
  HardDrive,
  MemoryStick,
  Monitor,
  PackageOpen,
  RotateCcw,
  Save,
  Settings2,
  ShieldAlert,
  SlidersHorizontal,
  Terminal,
  Trash2,
  Wand2
} from 'lucide-react'
import type { InstanceView, JavaInfo, LaunchMode, LoaderSpec, Settings } from '@shared/types'
import { formatBytes, formatPlaytime, LOADER_META, mergeSettings } from '@shared/utils'
import { errorMessage, useApp } from '../store'
import { Button, classNames, Divider, Modal, ModalHeader, Pill, Segmented, Spinner, Switch } from '../components/ui'
import { VersionPicker } from '../components/VersionPicker'
import Background from '../components/Background'

type Tab = 'basic' | 'memory' | 'java' | 'advanced' | 'directory'

const TABS: { id: Tab; label: string; hint: string; icon: typeof Settings2 }[] = [
  { id: 'basic', label: '基础', hint: 'BASIC', icon: Settings2 },
  { id: 'memory', label: '内存', hint: 'MEMORY', icon: MemoryStick },
  { id: 'java', label: 'Java', hint: 'RUNTIME', icon: Coffee },
  { id: 'advanced', label: '高级参数', hint: 'ADVANCED', icon: Terminal },
  { id: 'directory', label: '实例目录', hint: 'STORAGE', icon: HardDrive }
]

const WINDOW_PRESETS = [
  { width: 1280, height: 720, label: '720p' },
  { width: 1600, height: 900, label: '900p' },
  { width: 1920, height: 1080, label: '1080p' },
  { width: 2560, height: 1440, label: '1440p' }
]

function diffSettings(global: Settings, effective: Settings): Partial<Settings> {
  const patch: Record<string, unknown> = {}
  for (const key of Object.keys(effective) as (keyof Settings)[]) {
    if (effective[key] !== global[key]) patch[key] = effective[key]
  }
  return patch as Partial<Settings>
}

export default function InstanceSettingsPage(): React.JSX.Element {
  const { route, instances, activeInstance, config, system, saveInstance, deleteInstance, reload, navigate, pushToast } = useApp()
  const instance = instances.find((i) => i.id === route.instanceId) ?? activeInstance
  const [tab, setTab] = useState<Tab>('basic')
  const [name, setName] = useState(instance?.name ?? '')
  const [description, setDescription] = useState(instance?.description ?? '')
  const [mcVersion, setMcVersion] = useState(instance?.mcVersion ?? '')
  const [loader, setLoader] = useState<LoaderSpec>(instance?.loader ?? { type: 'vanilla', version: '' })
  const [settings, setSettings] = useState<Settings>(() => (instance ? mergeSettings(config?.global ?? ({} as Settings), instance.overrides) : ({} as Settings)))
  const [launchMode, setLaunchMode] = useState<LaunchMode>(instance?.launchMode ?? 'auto')
  const [busy, setBusy] = useState(false)
  const [dirSize, setDirSize] = useState<number | null>(null)
  const [javaList, setJavaList] = useState<JavaInfo[]>([])
  const [javaChecking, setJavaChecking] = useState(false)
  const [javaValid, setJavaValid] = useState<JavaInfo | null>(null)
  const [resetOpen, setResetOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deletePhrase, setDeletePhrase] = useState('')
  const [exporting, setExporting] = useState<string | null>(null)
  const [shortcutBusy, setShortcutBusy] = useState(false)
  const [savesOpen, setSavesOpen] = useState(false)
  const [saves, setSaves] = useState<{ name: string; size: number; modifiedAt: number }[]>([])
  const [savesSelected, setSavesSelected] = useState<Set<string>>(new Set())
  const baseline = useRef('')

  const effective = instance ? mergeSettings(config?.global ?? ({} as Settings), instance.overrides) : null
  const snapshot = useMemo(
    () => JSON.stringify({ name, description, mcVersion, loader, launchMode, settings }),
    [name, description, mcVersion, loader, launchMode, settings]
  )

  useEffect(() => {
    if (!instance) return
    setName(instance.name)
    setDescription(instance.description)
    setMcVersion(instance.mcVersion)
    setLoader(instance.loader)
    setLaunchMode(instance.launchMode ?? 'auto')
    const merged = mergeSettings(config?.global ?? ({} as Settings), instance.overrides)
    setSettings(merged)
    baseline.current = JSON.stringify({
      name: instance.name,
      description: instance.description,
      mcVersion: instance.mcVersion,
      loader: instance.loader,
      launchMode: instance.launchMode ?? 'auto',
      settings: merged
    })
    setDirSize(null)
    void window.ember.instances.size(instance.id).then(setDirSize).catch(() => undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instance?.id])

  useEffect(() => {
    if (tab !== 'java') return
    let cancelled = false
    setJavaList([])
    window.ember.versions
      .java()
      .then((list) => !cancelled && setJavaList(list))
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [tab])

  useEffect(() => {
    if (tab !== 'java' || settings.javaMode !== 'manual' || !settings.javaPath.trim()) {
      setJavaValid(null)
      return
    }
    let cancelled = false
    setJavaChecking(true)
    const timer = window.setTimeout(() => {
      window.ember.versions
        .validateJava(settings.javaPath)
        .then((info) => !cancelled && setJavaValid(info))
        .catch(() => !cancelled && setJavaValid(null))
        .finally(() => !cancelled && setJavaChecking(false))
    }, 350)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [settings.javaPath, settings.javaMode, tab])

  if (!instance || !config || !effective) {
    return (
      <div className="page">
        <Background />
        <div className="center-empty">
          <h2>实例不存在</h2>
          <Button variant="primary" onClick={() => navigate('/')}>返回主页</Button>
        </div>
      </div>
    )
  }

  const dirty = snapshot !== baseline.current
  const setPatch = (patch: Partial<Settings>) => setSettings((prev) => ({ ...prev, ...patch }))
  const totalMem = Math.max(8192, system?.totalMemMb ?? 16384)
  const minPct = Math.min(100, (settings.memoryMin / totalMem) * 100)
  const maxPct = Math.min(100, (settings.memoryMax / totalMem) * 100)
  const localAvailable = !!instance.localVersionDir
  const resolvedMode: 'ember' | 'local' =
    launchMode === 'auto' ? (localAvailable ? 'local' : 'ember') : launchMode === 'local' ? (localAvailable ? 'local' : 'ember') : 'ember'
  const localMode = resolvedMode === 'local'

  const onSave = async () => {
    if (busy) return
    if (!name.trim()) {
      pushToast({ tone: 'warning', title: '实例名不能为空' })
      setTab('basic')
      return
    }
    if (loader.type !== 'vanilla' && !loader.version) {
      pushToast({ tone: 'warning', title: '请选择加载器版本' })
      setTab('basic')
      return
    }
    setBusy(true)
    try {
      await saveInstance(instance.id, {
        name: name.trim(),
        description: description.trim(),
        mcVersion,
        loader: loader.type === 'vanilla' ? { type: 'vanilla', version: mcVersion } : loader,
        launchMode,
        overrides: diffSettings(config.global, settings)
      })
      baseline.current = snapshot
      pushToast({ tone: 'success', title: '设置已保存', message: '下次启动时生效。' })
    } catch (err) {
      pushToast({ tone: 'error', title: '保存失败', message: errorMessage(err) })
    } finally {
      setBusy(false)
    }
  }

  const onResetOverrides = async () => {
    setBusy(true)
    try {
      const updated = await window.ember.settings.resetInstance(instance.id)
      const merged = mergeSettings(config.global, {})
      setSettings(merged)
      setName(updated.name)
      setDescription(updated.description)
      setMcVersion(updated.mcVersion)
      setLoader(updated.loader)
      setLaunchMode(updated.launchMode ?? 'auto')
      baseline.current = JSON.stringify({
        name: updated.name,
        description: updated.description,
        mcVersion: updated.mcVersion,
        loader: updated.loader,
        launchMode: updated.launchMode ?? 'auto',
        settings: merged
      })
      await reload(true)
      setResetOpen(false)
      pushToast({ tone: 'info', title: '实例覆盖已清除', message: '现在完全使用全局默认设置。' })
    } catch (err) {
      pushToast({ tone: 'error', title: '重置失败', message: errorMessage(err) })
    } finally {
      setBusy(false)
    }
  }

  const onChooseDir = async () => {
    try {
      const updated = await window.ember.instances.selectCustomDir(instance.id)
      if (updated) {
        await reload(true)
        setDirSize(null)
        void window.ember.instances.size(instance.id).then(setDirSize)
        pushToast({ tone: 'success', title: '实例目录已迁移', message: updated.gameDir })
      }
    } catch (err) {
      pushToast({ tone: 'error', title: '目录迁移失败', message: errorMessage(err) })
    }
  }

  const onResetDir = async () => {
    try {
      await saveInstance(instance.id, { customDir: null })
      await reload(true)
      setDirSize(null)
      void window.ember.instances.size(instance.id).then(setDirSize)
      pushToast({ tone: 'success', title: '已恢复默认目录' })
    } catch (err) {
      pushToast({ tone: 'error', title: '目录迁移失败', message: errorMessage(err) })
    }
  }

  const createShortcut = async () => {
    if (!instance) return
    setShortcutBusy(true)
    try {
      const target = await window.ember.instances.createShortcut(instance.id)
      pushToast({ tone: 'success', title: '自动启动快捷方式已创建', message: `${target} · 会先打开 ELYTRA 再自动启动` })
    } catch (err) {
      pushToast({ tone: 'error', title: '创建快捷方式失败', message: errorMessage(err) })
    } finally {
      setShortcutBusy(false)
    }
  }

  const openSaves = async () => {
    if (!instance) return
    try {
      const list = await window.ember.instances.listSaves(instance.id)
      setSaves(list)
      setSavesSelected(new Set(list.map((item) => item.name)))
      setSavesOpen(true)
    } catch (err) {
      pushToast({ tone: 'error', title: '读取存档失败', message: errorMessage(err) })
    }
  }

  const exportSelectedSaves = async () => {
    if (!instance) return
    setSavesOpen(false)
    setExporting('saves')
    try {
      const path = await window.ember.instances.exportSaves(instance.id, [...savesSelected])
      if (path) pushToast({ tone: 'success', title: '存档已导出', message: path })
    } catch (err) {
      pushToast({ tone: 'error', title: '导出失败', message: errorMessage(err) })
    } finally {
      setExporting(null)
    }
  }

  const exportInstance = async (kind: 'saves' | 'info' | 'manifest' | 'pack' | 'modrinth') => {
    if (!instance) return
    setExporting(kind)
    try {
      const path =
        kind === 'saves'
          ? await window.ember.instances.exportSaves(instance.id)
          : kind === 'info'
            ? await window.ember.instances.exportInfo(instance.id)
            : kind === 'manifest'
              ? await window.ember.instances.exportModpackManifest(instance.id)
              : kind === 'modrinth'
                ? await window.ember.instances.exportModrinthList(instance.id)
                : await window.ember.instances.exportModpackZip(instance.id)
      if (path) {
        pushToast({
          tone: 'success',
          title:
            kind === 'saves'
              ? '存档已导出'
              : kind === 'info'
                ? '实例信息已导出'
                : kind === 'manifest'
                  ? 'CurseForge manifest.json 已导出'
                  : kind === 'modrinth'
                    ? 'Modrinth 索引 JSON 已导出'
                    : '整合包 ZIP 已导出',
          message: path
        })
      }
    } catch (err) {
      pushToast({ tone: 'error', title: '导出失败', message: errorMessage(err) })
    } finally {
      setExporting(null)
    }
  }

  const loaderMeta = LOADER_META[loader.type]

  return (
    <div className="page settings-page">
      <Background variant="mods" />
      <div className="settings-top">
        <button type="button" className="back-link" onClick={() => navigate('/')}>
          <ArrowLeft size={15} /> 返回主页
        </button>
        <div className="settings-title-row">
          <div>
            <h1>{instance.name}</h1>
            <p>
              Minecraft {instance.mcVersion} · {LOADER_META[instance.loader.type].label}
              {instance.loader.type !== 'vanilla' ? ` ${instance.loader.version}` : ''}
            </p>
          </div>
          <div className="settings-title-actions">
            {dirty ? <Pill tone="warning" dot>未保存</Pill> : <Pill tone="success" dot>已保存</Pill>}
            <Button variant="ghost" icon={RotateCcw} onClick={() => setResetOpen(true)}>
              重置
            </Button>
            <Button variant="primary" icon={Save} loading={busy} onClick={() => void onSave()} disabled={!dirty && !busy}>
              保存
            </Button>
          </div>
        </div>
      </div>

      <div className="settings-layout">
        <aside className="settings-aside">
          <div className="settings-identity" style={{ '--id-a': '#ff2d4b' } as React.CSSProperties}>
            <span className="settings-emblem">{instance.emblem || instance.name.slice(0, 1)}</span>
            <div>
              <strong>{instance.name}</strong>
              <em>{instance.slug}</em>
            </div>
          </div>
          <nav className="settings-tabs">
            {TABS.map((item) => {
              const Icon = item.icon
              return (
                <button key={item.id} type="button" className={classNames(tab === item.id && 'is-active')} onClick={() => setTab(item.id)}>
                  <Icon size={16} />
                  <span>{item.label}</span>
                  <em>{item.hint}</em>
                  <ChevronRight size={13} />
                </button>
              )
            })}
          </nav>
          <div className="settings-mini">
            <div>
              <span>游玩时长</span>
              <strong>{formatPlaytime(instance.playtimeMs)}</strong>
            </div>
            <div>
              <span>实例大小</span>
              <strong>{dirSize === null ? '—' : formatBytes(dirSize)}</strong>
            </div>
            <div>
              <span>模组</span>
              <strong>{instance.modCount} / {instance.disabledModCount} 禁用</strong>
            </div>
          </div>
        </aside>

        <main className="settings-main">
          {tab === 'basic' ? (
            <motion.div key="basic" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="settings-panel">
              <PanelTitle icon={Settings2} title="基础启动项" hint="BASIC LAUNCH" description="这些设置只覆盖当前实例，不会影响其他世界。" />
              <div className="settings-card">
                <div className="launch-mode-block">
                  <div>
                    <span className="field-label">启动方式</span>
                    <p>本地模式直接使用原游戏目录启动，不下载、不校验、不重新安装。EMBER 模式会由 EML 安装并校验文件。</p>
                  </div>
                  <Segmented
                    value={launchMode}
                    onChange={setLaunchMode}
                    options={[
                      { value: 'auto', label: localAvailable ? '自动 · 本地' : '自动' },
                      ...(localAvailable ? [{ value: 'local' as LaunchMode, label: '本地直接启动' }] : []),
                      { value: 'ember', label: 'EMBER 安装' }
                    ]}
                    className="launch-mode"
                  />
                </div>
                {localMode ? (
                  <div className="inline-notice is-good">
                    <HardDrive size={15} />
                    <p>
                      直接从 <code>{instance.localIsolated === false ? instance.gameDir : instance.localVersionDir}</code> 启动。PCL 的模组、配置与存档会按原目录读取，不会触发下载。
                    </p>
                  </div>
                ) : null}
                <div className="field-grid">
                  <div className="field">
                    <label className="field-label">实例名称</label>
                    <input className="text-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
                  </div>
                  <div className="field">
                    <label className="field-label">启动后行为</label>
                    <Segmented
                      value={settings.afterLaunch}
                      onChange={(value) => setPatch({ afterLaunch: value })}
                      options={[
                        { value: 'keep', label: '保持' },
                        { value: 'minimize', label: '最小化' },
                        { value: 'tray', label: '托盘' }
                      ]}
                      className="after-launch"
                    />
                  </div>
                </div>
                <div className="field">
                  <label className="field-label">描述</label>
                  <textarea className="text-input" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={180} />
                </div>
              </div>

              <Divider label="版本与加载器" />
              <div className="settings-card">
                {localMode ? (
                  <div className="local-version-box">
                    <div>
                      <span>Minecraft</span>
                      <strong>{mcVersion}</strong>
                    </div>
                    <div>
                      <span>加载器</span>
                      <strong>{LOADER_META[loader.type].label}{loader.type !== 'vanilla' ? ` ${loader.version}` : ''}</strong>
                    </div>
                    <div>
                      <span>本地版本</span>
                      <strong>{instance.localVersionId ?? '—'}</strong>
                    </div>
                    <p>版本由原游戏目录决定。若要更换版本，请切换为「EMBER 安装」后选择。</p>
                  </div>
                ) : (
                  <>
                    <VersionPicker
                      value={{ mcVersion, loader }}
                      onChange={(next) => {
                        setMcVersion(next.mcVersion)
                        setLoader(next.loader)
                      }}
                    />
                    <div className="inline-notice">
                      <AlertTriangle size={15} />
                      <p>切换游戏版本或加载器不会删除现有存档，但模组可能需要同步更换。首次启动时，EML 会下载对应依赖。</p>
                    </div>
                  </>
                )}
              </div>

              <Divider label="窗口" />
              <div className="settings-card">
                <div className="window-presets">
                  {WINDOW_PRESETS.map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      className={classNames(settings.windowWidth === preset.width && settings.windowHeight === preset.height && !settings.fullscreen && 'is-active')}
                      onClick={() => setPatch({ windowWidth: preset.width, windowHeight: preset.height, fullscreen: false })}
                    >
                      <span className="window-shape" style={{ aspectRatio: `${preset.width}/${preset.height}` }} />
                      <strong>{preset.label}</strong>
                      <em>{preset.width} × {preset.height}</em>
                    </button>
                  ))}
                </div>
                <div className="field-grid three">
                  <div className="field">
                    <label className="field-label">窗口宽度 <em>WIDTH</em></label>
                    <input className="text-input mono" type="number" value={settings.windowWidth} onChange={(e) => setPatch({ windowWidth: Number(e.target.value) })} />
                  </div>
                  <div className="field">
                    <label className="field-label">窗口高度 <em>HEIGHT</em></label>
                    <input className="text-input mono" type="number" value={settings.windowHeight} onChange={(e) => setPatch({ windowHeight: Number(e.target.value) })} />
                  </div>
                  <div className="field switch-field">
                    <label className="field-label">全屏启动 <em>FULLSCREEN</em></label>
                    <Switch checked={settings.fullscreen} onChange={(value) => setPatch({ fullscreen: value })} label="全屏启动" />
                  </div>
                </div>
              </div>
            </motion.div>
          ) : null}

          {tab === 'memory' ? (
            <motion.div key="memory" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="settings-panel">
              <PanelTitle icon={MemoryStick} title="内存分配" hint="HEAP MEMORY" description="内存过低会导致卡顿，过高会挤压系统并触发 OOM。经验值：4–8 GB 适合大多数模组包。" />
              <div className="memory-hero">
                <div className="memory-number">
                  <span>MAX HEAP</span>
                  <strong>{settings.memoryMax}</strong>
                  <em>MB</em>
                </div>
                <div className="memory-bar-wrap">
                  <div className="memory-bar">
                    <span className="memory-min" style={{ width: `${Math.min(100, minPct)}%` }} />
                    <span className="memory-max" style={{ width: `${Math.max(0, maxPct - minPct)}%` }} />
                    <span className="memory-tick" style={{ left: `${(8192 / totalMem) * 100}%` }}><em>8G</em></span>
                    <span className="memory-tick" style={{ left: `${(16384 / totalMem) * 100}%` }}><em>16G</em></span>
                  </div>
                  <div className="memory-legend">
                    <span><i className="legend-min" /> 最小 {formatBytes(settings.memoryMin * 1024 * 1024)}</span>
                    <span><i className="legend-max" /> 最大 {formatBytes(settings.memoryMax * 1024 * 1024)}</span>
                  </div>
                </div>
              </div>

              <div className="settings-card">
                <div className="dual-fields">
                  <div className="field">
                    <label className="field-label">最小内存 <em>MINIMUM</em></label>
                    <input
                      className="text-input mono"
                      type="number"
                      min={256}
                      max={settings.memoryMax - 256}
                      step={256}
                      value={settings.memoryMin}
                      onChange={(e) => setPatch({ memoryMin: Math.min(Number(e.target.value), settings.memoryMax - 256) })}
                    />
                  </div>
                  <div className="field">
                    <label className="field-label">最大内存 <em>MAXIMUM</em></label>
                    <input
                      className="text-input mono"
                      type="number"
                      min={settings.memoryMin + 256}
                      max={65536}
                      step={256}
                      value={settings.memoryMax}
                      onChange={(e) => setPatch({ memoryMax: Math.max(Number(e.target.value), settings.memoryMin + 256) })}
                    />
                  </div>
                </div>
                <div className="memory-presets">
                  {[2048, 4096, 6144, 8192, 12288, 16384].map((value) => (
                    <button key={value} type="button" className={classNames(settings.memoryMax === value && 'is-active')} onClick={() => setPatch({ memoryMax: value })}>
                      <strong>{value / 1024}G</strong>
                      <em>{value === 8192 ? '推荐' : value === 4096 ? '轻量' : value === 16384 ? '重型' : ''}</em>
                    </button>
                  ))}
                </div>
                <div className="inline-notice">
                  <Gauge size={15} />
                  <p>系统内存会自动读取。建议最大内存 ≤ 物理内存的 60%，并给 Windows 与显卡驱动留出足够空间。</p>
                </div>
              </div>
            </motion.div>
          ) : null}

          {tab === 'java' ? (
            <motion.div key="java" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="settings-panel">
              <PanelTitle icon={Coffee} title="Java 运行时" hint="JAVA RUNTIME" description="让 EML 自动下载匹配的 JRE，或指定本机已有的 Java 可执行文件。" />
              <div className="choice-cards">
                <button type="button" className={classNames('choice-card', settings.javaMode === 'auto' && 'is-active')} onClick={() => setPatch({ javaMode: 'auto' })}>
                  <span className="choice-icon"><Wand2 size={20} /></span>
                  <div>
                    <strong>自动管理</strong>
                    <em>AUTO MANAGED</em>
                    <p>EML 根据 Minecraft 版本下载并校验对应 Java，最省心。</p>
                  </div>
                  {settings.javaMode === 'auto' ? <span className="choice-check"><Check size={13} /></span> : null}
                </button>
                <button type="button" className={classNames('choice-card', settings.javaMode === 'manual' && 'is-active')} onClick={() => setPatch({ javaMode: 'manual' })}>
                  <span className="choice-icon"><Cpu size={20} /></span>
                  <div>
                    <strong>手动指定</strong>
                    <em>MANUAL PATH</em>
                    <p>使用你已经安装好的 Java 17 / 21 运行时。</p>
                  </div>
                  {settings.javaMode === 'manual' ? <span className="choice-check"><Check size={13} /></span> : null}
                </button>
              </div>

              {settings.javaMode === 'manual' ? (
                <div className="settings-card">
                  <div className="field">
                    <label className="field-label">Java 可执行文件 <em>EXECUTABLE</em></label>
                    <div className="input-with-button">
                      <input className="text-input mono" value={settings.javaPath} onChange={(e) => setPatch({ javaPath: e.target.value })} placeholder="C:\Program Files\Eclipse Adoptium\jdk-21\bin\java.exe" spellCheck={false} />
                      <Button
                        variant="secondary"
                        icon={FolderOpen}
                        onClick={() =>
                          void window.ember.app
                            .pickFile({ title: '选择 Java 可执行文件', filters: [{ name: 'Java', extensions: system?.platform === 'win32' ? ['exe'] : ['*'] }] })
                            .then((file) => file && setPatch({ javaPath: file }))
                        }
                      >
                        浏览
                      </Button>
                    </div>
                    {javaChecking ? (
                      <p className="field-hint"><Spinner size={12} /> 正在验证 Java…</p>
                    ) : javaValid ? (
                      <p className="field-hint is-good"><Check size={12} /> {javaValid.vendor} {javaValid.major} · {javaValid.version} · {javaValid.arch}</p>
                    ) : settings.javaPath ? (
                      <p className="field-hint is-bad"><AlertTriangle size={12} /> 无法读取这个 Java，请检查路径。</p>
                    ) : null}
                  </div>
                  {javaList.length ? (
                    <div className="java-list">
                      <div className="drawer-section-label">检测到的 Java</div>
                      {javaList.map((java) => (
                        <button key={java.path} type="button" className={classNames('java-row', settings.javaPath === java.path && 'is-active')} onClick={() => setPatch({ javaPath: java.path })}>
                          <span className="java-version">J{java.major}</span>
                          <div>
                            <strong>{java.vendor} {java.version}</strong>
                            <em>{java.path}</em>
                          </div>
                          <Pill tone="default">{java.arch}</Pill>
                          {settings.javaPath === java.path ? <Check size={14} /> : null}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="field-hint">没有自动检测到本机 Java。可以手动选择路径，或切回自动管理。</p>
                  )}
                </div>
              ) : (
                <div className="auto-java-card">
                  <div className="auto-java-visual">
                    <Coffee size={28} />
                    <span className="pulse-ring" />
                  </div>
                  <div>
                    <strong>EML 自动 Java</strong>
                    <p>首次启动时下载到实例目录的 runtime/ 下，不污染系统环境。适合大多数玩家。</p>
                  </div>
                </div>
              )}
            </motion.div>
          ) : null}

          {tab === 'advanced' ? (
            <motion.div key="advanced" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="settings-panel">
              <PanelTitle icon={Terminal} title="高级启动参数" hint="LAUNCH OVERRIDES" description="参数会原样传给 JVM 与游戏。请确认你知道它们在做什么。" />
              <div className="settings-card">
                <div className="field">
                  <label className="field-label">JVM 参数 <em>JAVA ARGS</em></label>
                  <textarea
                    className="text-input mono code"
                    rows={4}
                    value={settings.jvmArgs}
                    onChange={(e) => setPatch({ jvmArgs: e.target.value })}
                    placeholder="-XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200"
                    spellCheck={false}
                  />
                  <p className="field-hint">EML 会自动追加 Log4j 安全补丁，请不要在这里重复添加。支持空格分隔与引号包裹。</p>
                </div>
                <div className="field">
                  <label className="field-label">游戏附加参数 <em>GAME ARGS</em></label>
                  <textarea
                    className="text-input mono code"
                    rows={3}
                    value={settings.gameArgs}
                    onChange={(e) => setPatch({ gameArgs: e.target.value })}
                    placeholder="--width 1920 --height 1080"
                    spellCheck={false}
                  />
                  <p className="field-hint">会作为 profile.minecraft.args 传给 EML。不要重复添加 --username / --accessToken 等认证参数。</p>
                </div>
              </div>
            </motion.div>
          ) : null}

          {tab === 'directory' ? (
            <motion.div key="directory" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="settings-panel">
              <PanelTitle icon={HardDrive} title="实例目录" description="游戏、模组、存档和截图都保存在这里。" />
              <div className="dir-card">
                <div className="dir-visual">
                  <HardDrive size={26} />
                  <span className="dir-ring" />
                </div>
                <div className="dir-main">
                  <span className="field-label">当前目录</span>
                  <code>{instance.gameDir}</code>
                  <div className="dir-meta">
                    <Pill tone={instance.importedFrom ? 'blue' : instance.isCustomDir ? 'blue' : 'default'}>
                      {instance.importedFrom
                        ? instance.resolvedLaunchMode === 'local'
                          ? instance.localIsolated === false
                            ? '原游戏目录'
                            : '原游戏版本目录'
                          : 'EMBER 独立目录'
                        : instance.isCustomDir
                          ? '自定义目录'
                          : '默认目录'}
                    </Pill>
                    <span>{dirSize === null ? '计算中…' : formatBytes(dirSize)}</span>
                    {!instance.importedFrom ? <span>隔离模式</span> : null}
                  </div>
                </div>
                <div className="dir-actions">
                  <Button variant="secondary" icon={FolderOpen} onClick={() => void window.ember.instances.openDir(instance.id)}>打开目录</Button>
                  <Button variant="ghost" icon={Settings2} onClick={() => void window.ember.instances.revealMods(instance.id)}>模组文件夹</Button>
                </div>
              </div>

              {instance.importedFrom ? (
                <div className="inline-notice">
                  <HardDrive size={15} />
                  <p>
                    {instance.resolvedLaunchMode === 'local'
                      ? '本地直接启动使用原游戏版本目录，模组、配置和存档与原启动器共享。它不会下载或覆盖文件。'
                      : 'ELYTRA 安装使用独立目录，不会再写入原游戏目录。切换为「本地直接启动」可以继续使用原版本。'}
                  </p>
                </div>
              ) : (
                <div className="settings-card">
                  <div className="setting-line">
                    <div>
                      <strong>迁移到其他目录</strong>
                      <p>文件会被移动到新位置，并通过目录联接保持 EML 的路径不变。</p>
                    </div>
                    <Button variant="secondary" icon={FolderOpen} onClick={() => void onChooseDir()}>选择目录</Button>
                  </div>
                  {instance.isCustomDir ? (
                    <div className="setting-line">
                      <div>
                        <strong>恢复默认目录</strong>
                        <p>把文件搬回 %APPDATA%\.ember/{instance.slug}。</p>
                      </div>
                      <Button variant="ghost" icon={RotateCcw} onClick={() => void onResetDir()}>恢复默认</Button>
                    </div>
                  ) : null}
                  <div className="inline-notice">
                    <Monitor size={15} />
                    <p>删除实例不会删除游戏目录，你可以随时手动备份。</p>
                  </div>
                </div>
              )}

              <div className="settings-card export-instance-card">
                <div className="export-instance-head">
                  <div>
                    <strong>导出与备份</strong>
                    <p>导出存档、实例信息，或生成主流 CurseForge 格式的整合包清单。</p>
                  </div>
                  <FileArchive size={18} />
                </div>
                <div className="export-instance-grid">
                  <Button variant="secondary" icon={FileArchive} loading={exporting === 'saves'} onClick={() => void openSaves()}>
                    导出存档 ZIP
                  </Button>
                  <Button variant="secondary" icon={FileText} loading={exporting === 'info'} onClick={() => void exportInstance('info')}>
                    导出实例信息 TXT
                  </Button>
                  <Button variant="secondary" icon={FileJson} loading={exporting === 'manifest'} onClick={() => void exportInstance('manifest')}>
                    导出 manifest.json
                  </Button>
                  <Button variant="secondary" icon={FileJson} loading={exporting === 'modrinth'} onClick={() => void exportInstance('modrinth')}>
                    导出 Modrinth 索引
                  </Button>
                  <Button variant="secondary" icon={PackageOpen} loading={exporting === 'pack'} onClick={() => void exportInstance('pack')}>
                    导出整合包 ZIP
                  </Button>
                  <Button variant="secondary" icon={Monitor} loading={shortcutBusy} onClick={() => void createShortcut()}>
                    创建自动启动快捷方式
                  </Button>
                </div>
                <p className="field-hint">
                  manifest.json 使用 CurseForge `manifestType: minecraftModpack` 格式；无法映射 CurseForge ID 的模组会放进整合包 ZIP 的 `overrides/mods/`。
                </p>
              </div>

              <div className="danger-card">
                <div>
                  <h3>从启动器移除实例</h3>
                  <p>仅移除实例配置，不会删除游戏文件。</p>
                </div>
                <Button variant="danger" icon={Trash2} onClick={() => setDeleteOpen(true)}>移除实例</Button>
              </div>
            </motion.div>
          ) : null}
        </main>
      </div>

      <div className={classNames('settings-savebar', dirty && 'is-dirty')}>
        <div>
          <span className={classNames('save-dot', dirty && 'is-dirty')} />
          {dirty ? '有尚未保存的实例覆盖设置' : '所有设置已同步'}
          <em>全局默认仍可在 设置 → 默认启动 中修改</em>
        </div>
        <div className="settings-savebar-actions">
          <Button
            variant="ghost"
            onClick={() => {
              setName(instance.name)
              setDescription(instance.description)
              setMcVersion(instance.mcVersion)
              setLoader(instance.loader)
              setSettings(effective)
            }}
            disabled={!dirty}
          >
            撤销更改
          </Button>
          <Button variant="primary" icon={Save} loading={busy} onClick={() => void onSave()} disabled={!dirty}>
            保存设置
          </Button>
        </div>
      </div>

      <Modal open={resetOpen} onClose={() => setResetOpen(false)} size="sm">
        <ModalHeader eyebrow="RESET OVERRIDES" title="清除实例覆盖？" description="实例将重新继承全局默认设置。已保存的启动参数、内存和 Java 路径覆盖都会被清除。" onClose={() => setResetOpen(false)} />
        <div className="modal-actions">
          <Button variant="ghost" onClick={() => setResetOpen(false)}>取消</Button>
          <Button variant="danger" loading={busy} onClick={() => void onResetOverrides()}>清除覆盖</Button>
        </div>
      </Modal>

      <Modal open={savesOpen} onClose={() => setSavesOpen(false)} size="md">
        <ModalHeader
          eyebrow="EXPORT SAVES"
          title="选择要导出的存档"
          description="可以只导出其中一个或几个世界；未选择的存档不会被写入 ZIP。"
          onClose={() => setSavesOpen(false)}
        />
        <div className="save-export-tools">
          <button type="button" onClick={() => setSavesSelected(new Set(saves.map((item) => item.name)))}>全选</button>
          <button type="button" onClick={() => setSavesSelected(new Set())}>清空</button>
          <span>{savesSelected.size} / {saves.length}</span>
        </div>
        <div className="save-export-list">
          {saves.length ? saves.map((save) => (
            <button
              type="button"
              key={save.name}
              className={classNames('save-export-row', savesSelected.has(save.name) && 'is-selected')}
              onClick={() => setSavesSelected((prev) => {
                const next = new Set(prev)
                if (next.has(save.name)) next.delete(save.name)
                else next.add(save.name)
                return next
              })}
            >
              <span className="ui-check">{savesSelected.has(save.name) ? <Check size={12} strokeWidth={3} /> : null}</span>
              <span>
                <strong>{save.name}</strong>
                <em>{formatBytes(save.size)} · {new Date(save.modifiedAt).toLocaleDateString('zh-CN')}</em>
              </span>
            </button>
          )) : <p className="field-hint">这个实例还没有存档。</p>}
        </div>
        <div className="modal-actions">
          <Button variant="ghost" onClick={() => setSavesOpen(false)}>取消</Button>
          <Button variant="primary" icon={FileArchive} disabled={!savesSelected.size} loading={exporting === 'saves'} onClick={() => void exportSelectedSaves()}>
            导出 {savesSelected.size} 个存档
          </Button>
        </div>
      </Modal>

      <Modal open={deleteOpen} onClose={() => setDeleteOpen(false)} size="sm">
        <ModalHeader eyebrow="REMOVE INSTANCE" title="移除这个实例？" description="游戏文件会保留在原目录。此操作只从 ELYTRA 的实例矩阵中移除配置。" onClose={() => setDeleteOpen(false)} />
        <div className="field">
          <label className="field-label">输入实例名以确认 <em>{instance.name}</em></label>
          <div className="copy-name-row">
            <input className="text-input" value={deletePhrase} onChange={(e) => setDeletePhrase(e.target.value)} placeholder={instance.name} />
            <Button
              variant="secondary"
              icon={Copy}
              onClick={() => {
                void navigator.clipboard?.writeText(instance.name).catch(() => undefined)
                setDeletePhrase(instance.name)
                pushToast({ tone: 'success', title: '名称已复制并填入', message: '现在可以直接移除实例。' })
              }}
            >
              复制名称
            </Button>
          </div>
        </div>
        <div className="modal-actions">
          <Button variant="ghost" onClick={() => setDeleteOpen(false)}>取消</Button>
          <Button
            variant="danger"
            icon={Trash2}
            disabled={deletePhrase !== instance.name}
            onClick={() => {
              setDeleteOpen(false)
              void deleteInstance(instance.id)
            }}
          >
            移除实例
          </Button>
        </div>
      </Modal>
    </div>
  )
}

function PanelTitle({
  icon: Icon,
  title,
  hint,
  description
}: {
  icon: typeof Settings2
  title: string
  hint?: string
  description: string
}): React.JSX.Element {
  return (
    <div className="panel-title">
      <span className="panel-title-icon"><Icon size={18} /></span>
      <div>
        {hint ? <span>{hint}</span> : null}
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
    </div>
  )
}
