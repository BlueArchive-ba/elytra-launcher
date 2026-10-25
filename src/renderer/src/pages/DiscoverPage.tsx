import React, { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Compass,
  Download,
  ExternalLink,
  Filter,
  Layers,
  RefreshCw,
  Search,
  Sparkles,
  X
} from 'lucide-react'
import type {
  ModrinthContentType,
  ModrinthGameVersionTag,
  ModrinthReleaseType,
  ModrinthSearchHit,
  ModrinthSearchResult,
  ModrinthTags,
  ModrinthUpdate,
  ModrinthVersion
} from '@shared/types'
import { errorMessage, useApp } from '../store'
import { Button, classNames, EmptyState, Modal, ModalHeader, Pill, Segmented, Spinner } from '../components/ui'
import Background from '../components/Background'
import AnimatedNumber from '../components/AnimatedNumber'
import SelectMenu, { type SelectOption } from '../components/SelectMenu'

const TYPE_LABEL: Record<ModrinthContentType, string> = {
  mod: '模组',
  shader: '光影',
  resourcepack: '材质包'
}

const CHANNEL_LABEL: Record<ModrinthReleaseType, string> = {
  release: '正式',
  beta: 'Beta',
  alpha: 'Alpha'
}

const GAME_TYPE_LABEL: Record<string, string> = {
  release: '正式',
  snapshot: '快照',
  beta: 'Beta',
  alpha: 'Alpha'
}

function downloadsLabel(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`
  return String(value)
}

function dateLabel(value: string): string {
  try {
    return new Date(value).toLocaleDateString('zh-CN')
  } catch {
    return value
  }
}

export default function DiscoverPage(): React.JSX.Element {
  const { activeInstance, instances, selectInstance, refreshInstances, pushToast } = useApp()
  const [tags, setTags] = useState<ModrinthTags | null>(null)
  const [type, setType] = useState<ModrinthContentType>('mod')
  const [query, setQuery] = useState('')
  const [loader, setLoader] = useState('')
  const [gameVersion, setGameVersion] = useState('')
  const [releaseType, setReleaseType] = useState<'' | ModrinthReleaseType>('')
  const [offset, setOffset] = useState(0)
  const [result, setResult] = useState<ModrinthSearchResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [tab, setTab] = useState<'search' | 'updates'>('search')
  const [updates, setUpdates] = useState<ModrinthUpdate[] | null>(null)
  const [checking, setChecking] = useState(false)
  const [downloading, setDownloading] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ fileName: string; percent: number; speed: number; threads: number } | null>(null)
  const [versionsProject, setVersionsProject] = useState<ModrinthSearchHit | null>(null)
  const [versions, setVersions] = useState<ModrinthVersion[]>([])
  const [versionsLoading, setVersionsLoading] = useState(false)
  const [pendingUpdate, setPendingUpdate] = useState<ModrinthUpdate | null>(null)
  const [error, setError] = useState<string | null>(null)
  const limit = 20

  useEffect(() => {
    window.ember.modrinth
      .tags()
      .then((value) => {
        setTags(value)
        if (activeInstance) {
          setGameVersion(activeInstance.mcVersion)
          if (activeInstance.loader.type !== 'vanilla') setLoader(activeInstance.loader.type)
        }
      })
      .catch((err) => setError(errorMessage(err)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!activeInstance) return
    setGameVersion(activeInstance.mcVersion)
    setLoader(activeInstance.loader.type !== 'vanilla' ? activeInstance.loader.type : '')
  }, [activeInstance?.id])

  useEffect(() => {
    const dispose = window.ember.modrinth.onProgress((value) => {
      setProgress({ fileName: value.fileName, percent: value.percent, speed: value.speed, threads: value.threads })
    })
    return dispose
  }, [])

  const runSearch = async (nextOffset = 0) => {
    setLoading(true)
    setError(null)
    try {
      const data = await window.ember.modrinth.search({
        query,
        type,
        loader: type === 'mod' ? loader || undefined : undefined,
        gameVersion: gameVersion || undefined,
        releaseType: releaseType || undefined,
        offset: nextOffset,
        limit
      })
      setResult(data)
      setOffset(nextOffset)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void runSearch(0)
    }, 320)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, type, loader, gameVersion, releaseType])

  const groupedVersions = useMemo(() => {
    const list = tags?.gameVersions ?? []
    return {
      release: list.filter((item) => item.version_type === 'release'),
      snapshot: list.filter((item) => item.version_type === 'snapshot'),
      other: list.filter((item) => !['release', 'snapshot'].includes(item.version_type))
    }
  }, [tags])

  const downloadProject = async (project: ModrinthSearchHit, versionId?: string, channel?: ModrinthReleaseType) => {
    if (!activeInstance) {
      pushToast({ tone: 'warning', title: '先选择一个实例', message: '资源需要下载到当前实例的对应目录。' })
      return
    }
    setDownloading(project.project_id)
    setProgress(null)
    try {
      const info = await window.ember.modrinth.download(
        activeInstance.id,
        project.project_id,
        project.title,
        project.project_type,
        versionId,
        channel
      )
      await refreshInstances()
      setVersionsProject(null)
      pushToast({
        tone: 'success',
        title: '下载完成',
        message: `${info.fileName} → ${TYPE_LABEL[info.kind]} 目录`
      })
    } catch (err) {
      pushToast({ tone: 'error', title: '下载失败', message: errorMessage(err) })
    } finally {
      setDownloading(null)
      setProgress(null)
    }
  }

  const openVersions = async (project: ModrinthSearchHit) => {
    setVersionsProject(project)
    setVersions([])
    setVersionsLoading(true)
    try {
      const list = await window.ember.modrinth.versions(project.project_id, {
        loader: project.project_type === 'mod' ? loader || undefined : undefined,
        gameVersion: gameVersion || undefined
      })
      setVersions(list)
    } catch (err) {
      pushToast({ tone: 'error', title: '读取版本失败', message: errorMessage(err) })
    } finally {
      setVersionsLoading(false)
    }
  }

  const checkUpdates = async () => {
    if (!activeInstance) return
    setChecking(true)
    try {
      const list = await window.ember.modrinth.updates(activeInstance.id)
      setUpdates(list)
      pushToast({
        tone: list.length ? 'info' : 'success',
        title: list.length ? `检测到 ${list.length} 个更新` : '所有已跟踪资源都是最新',
        message: list.length ? '可以在列表中确认后下载新版。' : '只检查通过资源面板下载并记录的资源。'
      })
    } catch (err) {
      pushToast({ tone: 'error', title: '检查更新失败', message: errorMessage(err) })
    } finally {
      setChecking(false)
    }
  }

  const applyUpdate = async () => {
    if (!activeInstance || !pendingUpdate) return
    setDownloading(pendingUpdate.projectId)
    try {
      const info = await window.ember.modrinth.downloadUpdate(activeInstance.id, pendingUpdate)
      await refreshInstances()
      setPendingUpdate(null)
      setUpdates((prev) => prev?.filter((item) => item.projectId !== pendingUpdate.projectId) ?? null)
      pushToast({ tone: 'success', title: '已更新到新版本', message: info.fileName })
    } catch (err) {
      pushToast({ tone: 'error', title: '更新失败', message: errorMessage(err) })
    } finally {
      setDownloading(null)
    }
  }

  const gameVersionType = (version: string) => tags?.gameVersions.find((item) => item.version === version)?.version_type

  const loaderOptions: SelectOption[] = [
    { value: '', label: '全部加载器' },
    ...(tags?.loaders ?? []).map((item) => ({ value: item.name, label: item.name }))
  ]
  const versionOptions: SelectOption[] = [
    { value: '', label: '全部游戏版本' },
    ...groupedVersions.release.map((item) => ({ value: item.version, label: item.version, group: '正式版本' })),
    ...groupedVersions.snapshot.map((item) => ({ value: item.version, label: item.version, group: '快照' })),
    ...groupedVersions.other.map((item) => ({ value: item.version, label: item.version, group: '其他' }))
  ]
  const releaseOptions: SelectOption[] = [
    { value: '', label: '全部发布渠道' },
    { value: 'release', label: '正式 release' },
    { value: 'beta', label: '测试 beta' },
    { value: 'alpha', label: '早期 alpha' }
  ]

  return (
    <div className="page discover-page">
      <Background />
      <div className="page-head">
        <div>
          <h1>Modrinth 资源</h1>
          <p>搜索模组、光影和材质包，筛选版本后直接下载到当前实例。</p>
        </div>
        <div className="page-head-actions">
          <Pill tone="default" dot>{activeInstance ? `${activeInstance.name} · ${activeInstance.mcVersion}` : '未选择实例'}</Pill>
          <Button variant="ghost" icon={RefreshCw} onClick={() => void runSearch(offset)} loading={loading}>刷新</Button>
        </div>
      </div>

      <div className="discover-toolbar">
        <div className="discover-search">
          <Search size={16} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索模组、光影或材质包，例如 sodium / iris / faithful"
          />
          {query ? (
            <button type="button" onClick={() => setQuery('')} aria-label="清空搜索"><X size={13} /></button>
          ) : null}
        </div>
        <Segmented
          value={type}
          onChange={(value) => {
            setType(value)
            if (value !== 'mod') setLoader('')
            setOffset(0)
          }}
          options={[
            { value: 'mod', label: '模组' },
            { value: 'shader', label: '光影' },
            { value: 'resourcepack', label: '材质包' }
          ]}
          className="discover-type"
        />
        <div className="discover-tabs">
          <button type="button" className={tab === 'search' ? 'is-active' : ''} onClick={() => setTab('search')}>搜索</button>
          <button type="button" className={tab === 'updates' ? 'is-active' : ''} onClick={() => setTab('updates')}>
            更新检测 {updates ? <span>{updates.length}</span> : null}
          </button>
        </div>
      </div>

      {tab === 'search' ? (
        <>
          <div className="discover-filters">
            <Filter size={14} />
            {type === 'mod' ? (
              <SelectMenu
                value={loader}
                options={loaderOptions}
                onChange={setLoader}
                placeholder="全部加载器"
                className="discover-select loader-select"
              />
            ) : null}
            <SelectMenu
              value={gameVersion}
              options={versionOptions}
              onChange={setGameVersion}
              placeholder="全部游戏版本"
              className="discover-select version-select"
            />
            <SelectMenu
              value={releaseType}
              options={releaseOptions}
              onChange={(next) => setReleaseType(next as '' | ModrinthReleaseType)}
              placeholder="全部发布渠道"
              className="discover-select release-select"
            />
            <span className="discover-total">{result ? <><AnimatedNumber value={result.total_hits} /> 个项目</> : '准备搜索'}</span>
          </div>

          {error ? <div className="discover-error">{error}</div> : null}

          {loading ? (
            <div className="project-grid skeleton-grid" aria-label="正在读取 Modrinth">
              {Array.from({ length: 6 }, (_, index) => (
                <div className="project-skeleton" key={index} style={{ animationDelay: `${index * 70}ms` }}>
                  <span className="skeleton-icon" />
                  <span className="skeleton-line wide" />
                  <span className="skeleton-line" />
                  <span className="skeleton-line short" />
                  <span className="skeleton-actions" />
                </div>
              ))}
            </div>
          ) : result?.hits.length ? (
            <>
              <div className="project-grid">
                {result.hits.map((hit, index) => (
                  <motion.article
                    key={hit.project_id}
                    className="project-card"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(index * 0.025, 0.3) }}
                    onPointerMove={(event) => {
                      const rect = event.currentTarget.getBoundingClientRect()
                      event.currentTarget.style.setProperty('--spot-x', `${((event.clientX - rect.left) / rect.width) * 100}%`)
                      event.currentTarget.style.setProperty('--spot-y', `${((event.clientY - rect.top) / rect.height) * 100}%`)
                    }}
                  >
                    <div className="project-card-head">
                      <span className="project-icon" style={hit.icon_url ? { backgroundImage: `url("${hit.icon_url}")` } : undefined}>
                        {!hit.icon_url ? hit.title.slice(0, 1).toUpperCase() : null}
                      </span>
                      <div className="project-title">
                        <strong>{hit.title}</strong>
                        <em>{hit.author ?? 'Modrinth'} · {downloadsLabel(hit.downloads)} 下载</em>
                      </div>
                      <Pill tone="default">{TYPE_LABEL[hit.project_type]}</Pill>
                    </div>
                    <p className="project-desc">{hit.description}</p>
                    <div className="project-badges">
                      {hit.versions.slice(-3).map((version) => (
                        <span key={version} className={classNames('project-badge', gameVersionType(version) === 'snapshot' && 'is-snapshot')}>
                          {version}
                          <em>{GAME_TYPE_LABEL[gameVersionType(version) ?? 'release']}</em>
                        </span>
                      ))}
                      {hit.categories.slice(0, 2).map((category) => <span key={category} className="project-category">{category}</span>)}
                    </div>
                    <div className="project-actions">
                      <Button variant="ghost" onClick={() => void openVersions(hit)} disabled={!!downloading}>
                        版本 <ArrowRight size={13} />
                      </Button>
                      <Button
                        variant="primary"
                        icon={Download}
                        loading={downloading === hit.project_id}
                        disabled={!!downloading || !activeInstance}
                        onClick={() => void downloadProject(hit, undefined, releaseType || undefined)}
                      >
                        下载
                      </Button>
                    </div>
                    {downloading === hit.project_id && progress ? (
                      <div className="discover-progress">
                        <span style={{ width: `${progress.percent}%` }} />
                        <em>
                          {progress.percent}% · {(progress.speed / 1024 / 1024).toFixed(1)} MB/s · {progress.threads} 线程
                        </em>
                      </div>
                    ) : null}
                  </motion.article>
                ))}
              </div>
              <div className="discover-pager">
                <Button variant="ghost" icon={ChevronLeft} disabled={offset <= 0 || loading} onClick={() => void runSearch(Math.max(0, offset - limit))}>
                  上一页
                </Button>
                <span>{Math.floor(offset / limit) + 1} / {Math.max(1, Math.ceil((result.total_hits || 0) / limit))}</span>
                <Button variant="ghost" disabled={offset + limit >= (result.total_hits || 0) || loading} onClick={() => void runSearch(offset + limit)}>
                  下一页 <ChevronRight size={13} />
                </Button>
              </div>
            </>
          ) : (
            <EmptyState icon={Compass} title="没有匹配的资源" description="换一个关键词，或放宽加载器、游戏版本和发布渠道筛选。" />
          )}
        </>
      ) : (
        <div className="updates-panel">
          <div className="updates-head">
            <div>
              <h2>已跟踪资源的更新</h2>
              <p>只检查通过本面板下载的资源；本地手动放入的 JAR 没有项目 ID，不参与在线更新。</p>
            </div>
            <Button variant="secondary" icon={RefreshCw} loading={checking} onClick={() => void checkUpdates()} disabled={!activeInstance}>
              检查更新
            </Button>
          </div>
          {updates === null ? (
            <div className="updates-empty">
              <Clock3 size={24} />
              <span>点击「检查更新」读取 Modrinth 版本信息。</span>
            </div>
          ) : updates.length ? (
            <div className="update-list">
              {updates.map((update) => (
                <div key={update.projectId} className="update-card">
                  <div className="update-copy">
                    <strong>{update.title}</strong>
                    <span>{TYPE_LABEL[update.kind]} · {update.fileName}</span>
                    <em>
                      {update.currentVersionNumber} <ArrowRight size={11} /> {update.latestVersionNumber}
                    </em>
                  </div>
                  <div className="update-badges">
                    <Pill tone="warning">新版本</Pill>
                    <Pill tone={update.latestVersionType === 'release' ? 'success' : 'default'}>{CHANNEL_LABEL[update.latestVersionType]}</Pill>
                    {update.gameVersionType ? <Pill tone={update.gameVersionType === 'snapshot' ? 'warning' : 'default'}>{GAME_TYPE_LABEL[update.gameVersionType]}</Pill> : null}
                  </div>
                  <Button variant="primary" icon={Download} loading={downloading === update.projectId} onClick={() => setPendingUpdate(update)}>
                    下载新版
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <div className="updates-empty">
              <Check size={24} />
              <span>没有检测到可用更新。</span>
            </div>
          )}
        </div>
      )}

      <Modal open={!!versionsProject} onClose={() => !downloading && setVersionsProject(null)} size="lg" labelledBy="versions-title">
        <ModalHeader
          eyebrow="Modrinth Versions"
          title={versionsProject?.title ?? '版本'}
          description="按当前实例的加载器与游戏版本筛选。发布渠道会显示在每个版本上。"
          onClose={() => !downloading && setVersionsProject(null)}
          id="versions-title"
        />
        {versionsLoading ? (
          <div className="discover-loading"><Spinner size={20} /> 读取版本…</div>
        ) : (
          <div className="version-list">
            {versions.map((version) => {
              const file = version.files.find((item) => item.primary) ?? version.files[0]
              return (
                <div key={version.id} className="version-row">
                  <div className="version-copy">
                    <strong>{version.version_number}</strong>
                    <span>{version.name}</span>
                    <em>{dateLabel(version.date_published)} · {version.game_versions.slice(0, 4).join(', ')}</em>
                  </div>
                  <div className="version-badges">
                    <Pill tone={version.version_type === 'release' ? 'success' : version.version_type === 'beta' ? 'warning' : 'default'}>
                      {CHANNEL_LABEL[version.version_type]}
                    </Pill>
                    {version.loaders.slice(0, 2).map((item) => <span key={item}>{item}</span>)}
                  </div>
                  <Button
                    variant="secondary"
                    icon={Download}
                    loading={downloading === versionsProject?.project_id}
                    onClick={() => versionsProject && file && void downloadProject(versionsProject, version.id)}
                  >
                    {file ? `${Math.round(file.size / 1024 / 1024 * 10) / 10} MB` : '下载'}
                  </Button>
                </div>
              )
            })}
            {!versions.length ? <p className="field-hint">没有匹配当前实例的版本。</p> : null}
          </div>
        )}
      </Modal>

      <Modal open={!!pendingUpdate} onClose={() => !downloading && setPendingUpdate(null)} size="sm" labelledBy="update-title">
        <ModalHeader
          eyebrow="确认更新"
          title="下载新版本？"
          description={pendingUpdate ? `${pendingUpdate.title}：${pendingUpdate.currentVersionNumber} → ${pendingUpdate.latestVersionNumber}` : ''}
          onClose={() => !downloading && setPendingUpdate(null)}
          id="update-title"
        />
        <p className="update-confirm">
          新文件会写入当前实例的对应目录，并替换更新记录。旧文件名不同的资源会被移除。
        </p>
        <div className="modal-foot">
          <Button variant="ghost" icon={X} onClick={() => setPendingUpdate(null)} disabled={!!downloading}>取消</Button>
          <Button variant="primary" icon={Download} loading={!!downloading} onClick={() => void applyUpdate()}>确认下载</Button>
        </div>
      </Modal>
    </div>
  )
}
