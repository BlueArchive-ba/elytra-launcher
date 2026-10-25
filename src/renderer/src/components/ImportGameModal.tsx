import React, { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { FolderOpen, Loader2, RefreshCw, Search } from 'lucide-react'
import type { LibraryScan, LocalVersion } from '@shared/types'
import { LOADER_META, relativeTime } from '@shared/utils'
import { errorMessage, useApp } from '../store'
import { Button, classNames, EmptyState, Modal, ModalHeader, Pill, Spinner } from './ui'

function loaderName(type: keyof typeof LOADER_META): string {
  return type === 'vanilla' ? '原版' : LOADER_META[type].label
}

export default function ImportGameModal(): React.JSX.Element {
  const { importOpen, setImportOpen, reload, selectInstance, startLaunch, navigate, pushToast } = useApp()
  const [scan, setScan] = useState<LibraryScan | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [rootFilter, setRootFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<LocalVersion | null>(null)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)

  const load = async (root?: string) => {
    setLoading(true)
    setError(null)
    try {
      const data = await window.ember.library.scan(root)
      setScan(data)
      setRootFilter('all')
      setSelected(null)
      if (!data.versions.length) {
        setError('没有在常见目录找到已安装版本。可以选择包含 versions 文件夹的游戏目录。')
      }
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!importOpen) return
    setQuery('')
    setScan(null)
    setSelected(null)
    setName('')
    setError(null)
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [importOpen])

  const versions = useMemo(() => {
    if (!scan) return []
    const q = query.trim().toLowerCase()
    return scan.versions.filter((version) => {
      if (rootFilter !== 'all' && version.rootPath !== rootFilter) return false
      if (!q) return true
      return `${version.id} ${version.mcVersion} ${version.loader.type}`.toLowerCase().includes(q)
    })
  }, [query, rootFilter, scan])

  const chooseFolder = async () => {
    const folder = await window.ember.library.browse()
    if (folder) await load(folder)
  }

  const pick = (version: LocalVersion) => {
    setSelected(version)
    setName(version.id)
    setError(null)
  }

  const doImport = async (launchAfter: boolean) => {
    if (!selected) return
    setBusy(true)
    setError(null)
    try {
      const created = await window.ember.library.import({
        rootPath: selected.rootPath,
        versionId: selected.id,
        name: name.trim() || selected.id
      })
      await reload(true)
      await selectInstance(created.id)
      setImportOpen(false)
      navigate('/')
      pushToast({ tone: 'success', title: '已加载游戏', message: `${created.name} · ${created.mcVersion}` })
      if (launchAfter) window.setTimeout(() => void startLaunch(created.id), 300)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={importOpen} onClose={() => !busy && setImportOpen(false)} size="lg" className="import-modal" labelledBy="import-title">
      <ModalHeader
        eyebrow="加载已有游戏"
        title="选择已安装的版本"
        description="PCL 版本会直接启动，不下载；模组、配置和存档从原版本目录读取。"
        onClose={() => !busy && setImportOpen(false)}
        id="import-title"
      />

      <div className="import-toolbar">
        <div className="import-search">
          <Search size={15} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索版本号或加载器" />
        </div>
        <Button variant="ghost" icon={FolderOpen} onClick={() => void chooseFolder()} disabled={loading || busy}>
          其他目录
        </Button>
        <Button variant="ghost" icon={RefreshCw} onClick={() => void load()} disabled={loading || busy}>
          重新扫描
        </Button>
      </div>

      <div className="import-roots">
        <button type="button" className={rootFilter === 'all' ? 'is-active' : ''} onClick={() => setRootFilter('all')}>
          全部 <span>{scan?.versions.length ?? 0}</span>
        </button>
        {scan?.roots.map((root) => (
          <button key={root.path} type="button" className={rootFilter === root.path ? 'is-active' : ''} onClick={() => setRootFilter(root.path)} title={root.path}>
            {root.name} <span>{root.count}</span>
          </button>
        ))}
      </div>

      <div className="import-body">
        <div className="import-list">
          {loading ? (
            <div className="import-state">
              <Spinner size={20} />
              正在扫描已安装版本…
            </div>
          ) : versions.length ? (
            versions.map((version) => (
              <motion.button
                key={`${version.rootPath}:${version.id}`}
                type="button"
                className={classNames('import-version', selected?.rootPath === version.rootPath && selected.id === version.id && 'is-active')}
                onClick={() => !version.loaderUncertain && version.hasJar && pick(version)}
                disabled={version.loaderUncertain || !version.hasJar}
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
              >
                <span className="import-version-mark">{version.loader.type === 'vanilla' ? 'V' : LOADER_META[version.loader.type].short}</span>
                <span className="import-version-copy">
                  <strong>{version.id}</strong>
                  <em>
                    Minecraft {version.mcVersion} · {loaderName(version.loader.type)}
                    {version.loader.type !== 'vanilla' ? ` ${version.loader.version}` : ''}
                    {version.launcher === 'pcl' ? ` · PCL ${version.isolated ? '版本隔离' : '共享目录'}` : ''}
                  </em>
                  <small>{version.gameDir}</small>
                </span>
                <span className="import-version-side">
                  {version.loaderUncertain ? (
                    <Pill tone="warning">加载器未知</Pill>
                  ) : !version.hasJar ? (
                    <Pill tone="danger">缺少 JAR</Pill>
                  ) : (
                    <Pill tone={version.launcher === 'pcl' ? 'success' : 'default'}>{version.launcher === 'pcl' ? 'PCL · 直接启动' : '可启动'}</Pill>
                  )}
                  <em>{relativeTime(version.modifiedAt)}</em>
                </span>
              </motion.button>
            ))
          ) : (
            <EmptyState
              icon={FolderOpen}
              title="没有找到版本"
              description="常见目录没有已安装版本，请选择包含 versions 文件夹的 .minecraft 目录。"
              action={<Button variant="secondary" icon={FolderOpen} onClick={() => void chooseFolder()}>选择目录</Button>}
              compact
            />
          )}
        </div>

        <aside className="import-side">
          {selected ? (
            <>
              <div className="import-selected">
                <span>已选择</span>
                <strong>{selected.id}</strong>
                <em>{selected.gameDir}</em>
              </div>
              <label className="field-label" htmlFor="import-name">实例名称</label>
              <input id="import-name" className="text-input" value={name} onChange={(event) => setName(event.target.value)} maxLength={48} />
              <div className="import-warning">
                {selected.launcher === 'pcl'
                  ? `${selected.isolated ? 'PCL 版本隔离' : 'PCL 共享目录'}：模组从 ${selected.isolated ? 'versions 下的版本目录' : '游戏根目录'}读取，启动时不会下载或重新安装。`
                  : '这个版本会直接启动，使用原游戏目录中的文件。'}
                它与原启动器共享目录，删除 EMBER 实例不会删除游戏文件。加载时会自动合并「游戏设置」模板到 options.txt。
              </div>
              <Button variant="primary" icon={FolderOpen} loading={busy} onClick={() => void doImport(false)}>
                加载这个版本
              </Button>
              <Button variant="secondary" icon={Loader2} loading={busy} onClick={() => void doImport(true)}>
                加载并启动
              </Button>
            </>
          ) : (
            <div className="import-side-empty">
              <span>说明</span>
              <p>PCL 下载的版本会优先直接启动，不再重复下载。模组按 PCL 的版本隔离目录读取。</p>
              <p>缺少客户端 JAR 的版本不能直接启动，需要先在原启动器中补全文件。</p>
            </div>
          )}
          {error ? <div className="import-error">{error}</div> : null}
        </aside>
      </div>
    </Modal>
  )
}
