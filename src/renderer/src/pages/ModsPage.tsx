import React, { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertTriangle,
  BookOpen,
  Check,
  CircleSlash,
  ClipboardCopy,
  Download,
  FolderOpen,
  Globe2,
  GripVertical,
  Package,
  Power,
  RefreshCw,
  Search,
  ShieldAlert,
  Trash2,
  Upload,
  X
} from 'lucide-react'
import type { ModInfo, ModLibraryEntry, ModScanResult } from '@shared/types'
import { formatBytes, relativeTime } from '@shared/utils'
import { errorMessage, useApp } from '../store'
import { Button, classNames, EmptyState, Modal, ModalHeader, Pill, SectionHeading, Spinner } from '../components/ui'
import AnimatedNumber from '../components/AnimatedNumber'
import SelectMenu from '../components/SelectMenu'
import Background from '../components/Background'

type Filter = 'all' | 'enabled' | 'disabled' | 'updates' | 'duplicates' | 'invalid'

export default function ModsPage(): React.JSX.Element {
  const {
    activeInstance,
    instances,
    selectInstance,
    navigate,
    pushToast,
    modUpdates,
    updatingMods,
    modProgress,
    updateAllMods,
    updateMod
  } = useApp()
  const [result, setResult] = useState<ModScanResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [sort, setSort] = useState<'priority' | 'name' | 'size'>('priority')
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)
  const [removeTarget, setRemoveTarget] = useState<ModInfo | null>(null)
  const [busyFile, setBusyFile] = useState<string | null>(null)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [library, setLibrary] = useState<ModLibraryEntry[]>([])
  const [libBusy, setLibBusy] = useState<string | null>(null)
  const [libUrl, setLibUrl] = useState('')

  const scan = async (id = activeInstance?.id) => {
    if (!id) return
    setLoading(true)
    try {
      const data = await window.ember.mods.scan(id)
      setResult(data)
    } catch (err) {
      pushToast({ tone: 'error', title: '扫描 Mod 失败', message: errorMessage(err) })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setResult(null)
    setQuery('')
    setFilter('all')
    if (activeInstance) void scan(activeInstance.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeInstance?.id])

  const loadLibrary = async () => {
    if (!activeInstance) return
    try {
      setLibrary(await window.ember.modLibrary.list(activeInstance.id))
    } catch (err) {
      pushToast({ tone: 'error', title: '读取模组库失败', message: errorMessage(err) })
    }
  }

  const openLibrary = () => {
    setLibraryOpen(true)
    void loadLibrary()
  }

  const importLibrary = async (kind: 'local' | 'url') => {
    setLibBusy(kind)
    try {
      const next = kind === 'local' ? await window.ember.modLibrary.importLocal() : await window.ember.modLibrary.importUrl(libUrl.trim())
      if (next.length || kind === 'url') {
        setLibUrl('')
        pushToast({ tone: 'success', title: kind === 'local' ? '已导入本地模组' : '已从链接导入模组' })
        await loadLibrary()
      }
    } catch (err) {
      pushToast({ tone: 'error', title: '导入失败', message: errorMessage(err) })
    } finally {
      setLibBusy(null)
    }
  }

  const toggleLibrary = async (entry: ModLibraryEntry) => {
    if (!activeInstance) return
    setLibBusy(entry.id)
    try {
      setLibrary(await window.ember.modLibrary.toggle(activeInstance.id, entry.id, !entry.copied))
      await scan(activeInstance.id)
      pushToast({ tone: 'success', title: entry.copied ? '已从实例移除副本' : '已复制到当前实例 mods' })
    } catch (err) {
      pushToast({ tone: 'error', title: '操作失败', message: errorMessage(err) })
    } finally {
      setLibBusy(null)
    }
  }

  const removeLibrary = async (entry: ModLibraryEntry) => {
    setLibBusy(entry.id)
    try {
      await window.ember.modLibrary.remove(entry.id)
      await loadLibrary()
      pushToast({ tone: 'info', title: '已从模组库删除', message: '已复制到实例的文件不会被删除。' })
    } catch (err) {
      pushToast({ tone: 'error', title: '删除失败', message: errorMessage(err) })
    } finally {
      setLibBusy(null)
    }
  }

  const mods = useMemo(() => {
    if (!result) return []
    let list = result.mods
    const q = query.trim().toLowerCase()
    if (q) list = list.filter((m) => `${m.name} ${m.id} ${m.fileName} ${m.version}`.toLowerCase().includes(q))
    if (filter === 'enabled') list = list.filter((m) => m.enabled && !m.invalid)
    else if (filter === 'disabled') list = list.filter((m) => !m.enabled)
    else if (filter === 'updates') list = list.filter((m) => modUpdates.some((update) => update.fileName === m.fileName))
    else if (filter === 'duplicates') list = list.filter((m) => m.duplicate)
    else if (filter === 'invalid') list = list.filter((m) => m.invalid)
    if (sort === 'name') list = [...list].sort((a, b) => a.name.localeCompare(b.name))
    else if (sort === 'size') list = [...list].sort((a, b) => b.size - a.size)
    return list
  }, [filter, modUpdates, query, result, sort])

  const toggle = async (mod: ModInfo) => {
    if (!activeInstance) return
    setBusyFile(mod.fileName)
    try {
      const data = await window.ember.mods.toggle(activeInstance.id, mod.fileName, !mod.enabled)
      setResult(data)
      pushToast({
        tone: 'success',
        title: mod.enabled ? '模组已禁用' : '模组已启用',
        message: `${mod.name} · 文件已移动到 ${mod.enabled ? 'mods-disabled' : 'mods'}/`
      })
    } catch (err) {
      pushToast({ tone: 'error', title: '操作失败', message: errorMessage(err) })
    } finally {
      setBusyFile(null)
    }
  }

  const drop = async (targetIndex: number) => {
    if (!activeInstance || dragIndex === null || !result) return
    if (dragIndex === targetIndex || filter !== 'all' || query.trim()) {
      setDragIndex(null)
      setOverIndex(null)
      return
    }
    const all = [...result.mods]
    const [moved] = all.splice(dragIndex, 1)
    all.splice(targetIndex, 0, moved)
    setResult({ ...result, mods: all.map((m, index) => ({ ...m, priority: index + 1 })) })
    setDragIndex(null)
    setOverIndex(null)
    try {
      const data = await window.ember.mods.reorder(activeInstance.id, all.map((m) => m.fileName))
      setResult(data)
    } catch (err) {
      pushToast({ tone: 'error', title: '保存排序失败', message: errorMessage(err) })
      await scan()
    }
  }

  const remove = async () => {
    if (!activeInstance || !removeTarget) return
    try {
      const data = await window.ember.mods.remove(activeInstance.id, removeTarget.fileName)
      setResult(data)
      setRemoveTarget(null)
      pushToast({ tone: 'info', title: '模组已移到回收站', message: removeTarget.name })
    } catch (err) {
      pushToast({ tone: 'error', title: '移除失败', message: errorMessage(err) })
    }
  }

  if (!activeInstance) {
    return (
      <div className="page">
        <Background variant="mods" />
        <EmptyState icon={Package} title="还没有选中的实例" description="先在主页选择一个实例，再管理它的 Mod。" action={<Button variant="primary" onClick={() => navigate('/')}>返回主页</Button>} />
      </div>
    )
  }

  const totalSize = result?.mods.reduce((sum, m) => sum + m.size, 0) ?? 0
  const canDrag = filter === 'all' && !query.trim() && sort === 'priority'

  return (
    <div className="page mods-page">
      <Background variant="mods" />
      <div className="page-head">
        <div>
          <h1>模组</h1>
          <p>管理当前实例的本地模组。启用和禁用只会移动文件。</p>
        </div>
        <div className="page-head-actions">
          <SelectMenu
            value={activeInstance.id}
            options={instances.map((instance) => ({ value: instance.id, label: `${instance.name} · ${instance.mcVersion}` }))}
            onChange={(id) => void selectInstance(id)}
            placeholder="选择实例"
            className="mod-instance-select"
          />
          <Button variant="secondary" icon={FolderOpen} onClick={() => void window.ember.instances.revealMods(activeInstance.id)}>
            打开文件夹
          </Button>
          {modUpdates.length ? (
            <Button
              variant="primary"
              icon={Download}
              loading={updatingMods.length > 0}
              onClick={() => void updateAllMods().then(() => scan())}
            >
              一键更新 ({modUpdates.length})
            </Button>
          ) : null}
          <Button variant="secondary" icon={BookOpen} onClick={openLibrary}>
            模组库
          </Button>
          <Button variant="ghost" icon={RefreshCw} loading={loading} onClick={() => void scan()}>
            扫描
          </Button>
        </div>
      </div>

      <div className="mod-summary">
        <span><AnimatedNumber value={result?.enabledCount ?? 0} /> 已启用</span>
        <span><AnimatedNumber value={result?.disabledCount ?? 0} /> 已禁用</span>
        <span><AnimatedNumber value={totalSize} format={formatBytes} /> 占用</span>
        <span className={classNames((result?.duplicateIds.length ?? 0) > 0 && 'is-danger')}><AnimatedNumber value={result?.duplicateIds.length ?? 0} /> 重复</span>
        <span className={classNames((result?.invalidCount ?? 0) > 0 && 'is-danger')}><AnimatedNumber value={result?.invalidCount ?? 0} /> 损坏</span>
      </div>

      {updatingMods.length ? (
        <div className="mod-download-panel">
          <div className="mod-download-head">
            <strong>{modProgress ? `正在下载 ${modProgress.fileName}` : '正在准备更新…'}</strong>
            <span>
              {modProgress
                ? `${modProgress.percent}% · ${formatBytes(modProgress.received)} / ${formatBytes(modProgress.total)} · ${(modProgress.speed / 1024 / 1024).toFixed(1)} MB/s · ${modProgress.threads} 线程`
                : '连接 Modrinth CDN'}
            </span>
          </div>
          <div className="mod-download-bar">
            <span style={{ width: `${modProgress?.percent ?? 3}%` }} />
          </div>
        </div>
      ) : null}

      {(result?.duplicateIds.length ?? 0) > 0 ? (
        <div className="mod-alert">
          <ShieldAlert size={18} />
          <div>
            <strong>检测到重复模组</strong>
            <p>{result?.duplicateIds.join(' · ')} — 同时启用可能导致游戏无法启动。</p>
          </div>
          <button type="button" onClick={() => setFilter('duplicates')}>只看重复项</button>
        </div>
      ) : null}

      <div className="mod-toolbar">
        <div className="mod-search">
          <Search size={15} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索名称、modId、文件名…" spellCheck={false} />
          {query ? <button type="button" onClick={() => setQuery('')} aria-label="清空"><X size={14} /></button> : null}
        </div>
        <div className="mod-filters">
          {(
            [
              ['all', '全部'],
              ['enabled', '启用'],
              ['disabled', '禁用'],
              ['updates', `可更新${modUpdates.length ? ` ${modUpdates.length}` : ''}`],
              ['duplicates', '重复'],
              ['invalid', '损坏']
            ] as const
          ).map(([key, label]) => (
            <button key={key} type="button" className={filter === key ? 'is-active' : ''} onClick={() => setFilter(key)}>
              {label}
            </button>
          ))}
        </div>
        <div className="mod-sort">
          <span>排序</span>
          <SelectMenu
            value={sort}
            options={[
              { value: 'priority', label: '手动优先级' },
              { value: 'name', label: '名称' },
              { value: 'size', label: '文件大小' }
            ]}
            onChange={(next) => setSort(next as typeof sort)}
            placeholder="排序"
            className="mod-sort-select"
          />
        </div>
      </div>

      {!canDrag && result?.mods.length ? (
        <p className="drag-hint">拖动排序在「全部 + 无搜索 + 手动优先级」时可用。</p>
      ) : null}

      <div className="mod-list">
        <div className="mod-list-head">
          <span />
          <span>模组</span>
          <span>版本</span>
          <span>加载器</span>
          <span>大小</span>
          <span>顺序</span>
          <span>状态</span>
          <span />
        </div>
        {loading && !result ? (
          <div className="mod-loading">
            <Spinner size={22} />
            <span>正在读取 mods/ 与 mods-disabled/…</span>
          </div>
        ) : mods.length ? (
          <AnimatePresence initial={false}>
            {mods.map((mod, index) => {
              const globalIndex = result?.mods.findIndex((m) => m.fileName === mod.fileName) ?? index
              const update = modUpdates.find((item) => item.fileName === mod.fileName)
              return (
                <motion.div
                  key={mod.fileName}
                  layout
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: -12 }}
                  className={classNames('mod-row', !mod.enabled && 'is-disabled', mod.duplicate && 'is-duplicate', mod.invalid && 'is-invalid', dragIndex === globalIndex && 'is-dragging', overIndex === globalIndex && 'is-drop-target')}
                  draggable={canDrag}
                  onDragStart={() => setDragIndex(globalIndex)}
                  onDragOver={(event) => {
                    if (!canDrag) return
                    event.preventDefault()
                    setOverIndex(globalIndex)
                  }}
                  onDragEnd={() => {
                    setDragIndex(null)
                    setOverIndex(null)
                  }}
                  onDrop={(event) => {
                    event.preventDefault()
                    void drop(globalIndex)
                  }}
                >
                  <span className="mod-drag">
                    <GripVertical size={15} />
                  </span>
                  <div className="mod-identity">
                    <span className="mod-icon" style={{ '--mod-h': (mod.name.charCodeAt(0) * 7) % 360 } as React.CSSProperties}>
                      {mod.icon ? <img src={mod.icon} alt="" /> : mod.name.slice(0, 1).toUpperCase()}
                    </span>
                    <div>
                      <div className="mod-name-line">
                        <strong>{mod.name}</strong>
                        {mod.duplicate ? <Pill tone="danger">重复</Pill> : null}
                        {mod.invalid ? <Pill tone="warning">损坏</Pill> : null}
                        {update ? <Pill tone="warning">可更新</Pill> : null}
                      </div>
                      <p className="mod-desc">{mod.invalid ? mod.error : mod.description || `${mod.id} · ${mod.fileName}`}</p>
                    </div>
                  </div>
                  <span className="mod-version mono">{mod.version || '—'}</span>
                  <span className="mod-loader"><i />{mod.loader}</span>
                  <span className="mod-size">{formatBytes(mod.size)}</span>
                  <span className="mod-priority">#{String(mod.priority).padStart(2, '0')}</span>
                  <div className="mod-state">
                    <button type="button" className={classNames('mod-toggle', mod.enabled && 'is-on')} onClick={() => void toggle(mod)} disabled={busyFile === mod.fileName} aria-label={mod.enabled ? '禁用' : '启用'}>
                      {busyFile === mod.fileName ? <Spinner size={12} /> : <Power size={13} />}
                    </button>
                    <em>{mod.enabled ? '启用' : '禁用'}</em>
                  </div>
                  <div className="mod-actions">
                    {update ? (
                      <button
                        type="button"
                        className="mod-update-button"
                        onClick={() => void updateMod(update).then(() => scan()).catch(() => undefined)}
                        disabled={updatingMods.includes(update.projectId)}
                        aria-label="更新模组"
                        title={`更新到 ${update.latestVersionNumber}`}
                      >
                        {updatingMods.includes(update.projectId) ? <Spinner size={12} /> : <Download size={14} />}
                      </button>
                    ) : null}
                    <button type="button" onClick={() => setRemoveTarget(mod)} aria-label="移除 Mod">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </motion.div>
              )
            })}
          </AnimatePresence>
        ) : (
          <EmptyState
            icon={Package}
            title={result?.mods.length ? '没有符合筛选条件的 Mod' : 'mods/ 还是空的'}
            description={result?.mods.length ? '换一个关键词或筛选条件。' : '从「资源」页下载，或把本地 .jar 放进 mods/ 后点击扫描。'}
            action={
              <Button variant="secondary" icon={FolderOpen} onClick={() => void window.ember.instances.revealMods(activeInstance.id)}>
                打开 mods 文件夹
              </Button>
            }
          />
        )}
      </div>

      <div className="mod-footer">
        <span>
          <Check size={13} /> 启用或禁用只会移动文件
        </span>
        <span>重复模组会导致游戏无法启动</span>
      </div>

      <Modal open={libraryOpen} onClose={() => setLibraryOpen(false)} size="lg">
        <ModalHeader
          eyebrow="MOD LIBRARY"
          title="模组库"
          description="模组原件集中保存在启动器模组库。复制到当前实例后才会被游戏加载；禁用只会删除实例中的副本。"
          onClose={() => setLibraryOpen(false)}
        />
        <div className="mod-library-toolbar">
          <Button variant="secondary" icon={Upload} loading={libBusy === 'local'} onClick={() => void importLibrary('local')}>
            导入本地 JAR
          </Button>
          <Button variant="ghost" icon={FolderOpen} onClick={() => void window.ember.modLibrary.open()}>
            打开模组库
          </Button>
          <div className="mod-library-url">
            <input
              className="text-input"
              value={libUrl}
              onChange={(event) => setLibUrl(event.target.value)}
              placeholder="粘贴 .jar 直链，从网络导入"
            />
            <Button
              variant="primary"
              icon={Globe2}
              loading={libBusy === 'url'}
              disabled={!libUrl.trim()}
              onClick={() => void importLibrary('url')}
            >
              从链接导入
            </Button>
          </div>
        </div>
        <div className="mod-library-list">
          {library.length ? library.map((entry) => (
            <div className="mod-library-row" key={entry.id}>
              <span className="mod-library-icon">{entry.name.slice(0, 1).toUpperCase()}</span>
              <span className="mod-library-copy">
                <strong>{entry.name}</strong>
                <em>{entry.fileName} · {formatBytes(entry.size)} · {entry.source === 'local' ? '本地' : '网络'}</em>
              </span>
              <Pill tone={entry.copied ? 'success' : 'default'}>{entry.copied ? '已复制到实例' : entry.copiedIn === 'mods-disabled' ? '实例已禁用' : '仅库中'}</Pill>
              <Button
                variant={entry.copied ? 'ghost' : 'secondary'}
                icon={entry.copied ? CircleSlash : ClipboardCopy}
                loading={libBusy === entry.id}
                onClick={() => void toggleLibrary(entry)}
              >
                {entry.copied ? '删除副本' : '复制到实例'}
              </Button>
              <button type="button" className="icon-btn" aria-label="从模组库删除" onClick={() => void removeLibrary(entry)}>
                <Trash2 size={14} />
              </button>
            </div>
          )) : (
            <EmptyState
              icon={BookOpen}
              title="模组库还是空的"
              description="导入本地 JAR，或粘贴一个 .jar 下载直链；之后可以随时一键复制到任意实例。"
            />
          )}
        </div>
      </Modal>

      <Modal open={!!removeTarget} onClose={() => setRemoveTarget(null)} size="sm">
        <ModalHeader
          eyebrow="REMOVE MOD"
          title="把模组移到回收站？"
          description={removeTarget ? `${removeTarget.name} · ${removeTarget.fileName}。文件会进入系统回收站，可从那里恢复。` : ''}
          onClose={() => setRemoveTarget(null)}
        />
        <div className="modal-actions">
          <Button variant="ghost" onClick={() => setRemoveTarget(null)}>取消</Button>
          <Button variant="danger" icon={Trash2} onClick={() => void remove()}>移到回收站</Button>
        </div>
      </Modal>
    </div>
  )
}

