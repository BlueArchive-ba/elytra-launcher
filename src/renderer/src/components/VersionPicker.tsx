import React, { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown, Loader2, Search, Sparkles } from 'lucide-react'
import type { LoaderSpec, LoaderType, LoaderVersion, MinecraftVersion } from '@shared/types'
import { LOADER_META } from '@shared/utils'
import { classNames, Pill } from './ui'
import { OptionRow } from './Choice'

const LOADER_ORDER: LoaderType[] = ['vanilla', 'fabric', 'forge', 'neoforge', 'quilt']

function useOutsideClose(ref: React.RefObject<HTMLElement | null>, open: boolean, close: () => void): void {
  useEffect(() => {
    if (!open) return
    const handler = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) close()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [ref, open, close])
}

export function VersionPicker({
  value,
  onChange,
  compact
}: {
  value: { mcVersion: string; loader: LoaderSpec }
  onChange: (next: { mcVersion: string; loader: LoaderSpec }) => void
  compact?: boolean
}): React.JSX.Element {
  const [versions, setVersions] = useState<MinecraftVersion[]>([])
  const [loadingVersions, setLoadingVersions] = useState(true)
  const [versionOpen, setVersionOpen] = useState(false)
  const [versionQuery, setVersionQuery] = useState('')
  const [channel, setChannel] = useState<'release' | 'snapshot' | 'all'>('release')
  const [loaderVersions, setLoaderVersions] = useState<LoaderVersion[]>([])
  const [loadingLoaders, setLoadingLoaders] = useState(false)
  const [loaderOpen, setLoaderOpen] = useState(false)
  const [loaderQuery, setLoaderQuery] = useState('')
  const [manual, setManual] = useState(false)
  const versionRef = useRef<HTMLDivElement>(null)
  const loaderRef = useRef<HTMLDivElement>(null)

  useOutsideClose(versionRef, versionOpen, () => setVersionOpen(false))
  useOutsideClose(loaderRef, loaderOpen, () => setLoaderOpen(false))

  useEffect(() => {
    let cancelled = false
    setLoadingVersions(true)
    window.ember.versions
      .minecraft()
      .then((list) => {
        if (cancelled) return
        setVersions(list)
        if (!value.mcVersion && list.length) {
          const latest = list.find((v) => v.type === 'release')
          if (latest) onChange({ mcVersion: latest.id, loader: value.loader.type === 'vanilla' ? { type: 'vanilla', version: latest.id } : value.loader })
        }
      })
      .catch(() => undefined)
      .finally(() => !cancelled && setLoadingVersions(false))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (value.loader.type === 'vanilla') {
      setLoaderVersions([])
      if (value.loader.version !== value.mcVersion) {
        onChange({ mcVersion: value.mcVersion, loader: { type: 'vanilla', version: value.mcVersion } })
      }
      return
    }
    if (!value.mcVersion) return
    let cancelled = false
    setLoadingLoaders(true)
    setLoaderVersions([])
    window.ember.versions
      .loaders(value.mcVersion, value.loader.type)
      .then((list) => {
        if (cancelled) return
        setLoaderVersions(list)
        const stillValid = list.some((item) => item.version === value.loader.version)
        if (!stillValid) {
          onChange({
            mcVersion: value.mcVersion,
            loader: { ...value.loader, version: list[0]?.version ?? '' }
          })
        }
      })
      .catch(() => undefined)
      .finally(() => !cancelled && setLoadingLoaders(false))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.mcVersion, value.loader.type])

  const filteredVersions = useMemo(() => {
    const q = versionQuery.trim().toLowerCase()
    return versions
      .filter((v) => (channel === 'all' ? true : v.type === channel))
      .filter((v) => !q || v.id.toLowerCase().includes(q))
      .slice(0, 80)
  }, [channel, versionQuery, versions])

  const filteredLoaders = useMemo(() => {
    const q = loaderQuery.trim().toLowerCase()
    return loaderVersions.filter((v) => !q || v.version.toLowerCase().includes(q)).slice(0, 100)
  }, [loaderQuery, loaderVersions])

  const selectVersion = (version: MinecraftVersion) => {
    setVersionOpen(false)
    setVersionQuery('')
    onChange({
      mcVersion: version.id,
      loader:
        value.loader.type === 'vanilla'
          ? { type: 'vanilla', version: version.id }
          : { ...value.loader, version: '' }
    })
  }

  return (
    <div className={classNames('version-picker', compact && 'is-compact')}>
      <div className="field">
        <label className="field-label">
          Minecraft 版本 <em>GAME VERSION</em>
        </label>
        <div className="dropdown" ref={versionRef}>
          <button
            type="button"
            className={classNames('dropdown-trigger', versionOpen && 'is-open')}
            onClick={() => setVersionOpen((v) => !v)}
          >
            <span className="version-trigger-main">
              <strong>{value.mcVersion || (loadingVersions ? '正在读取版本…' : '选择版本')}</strong>
              {value.mcVersion ? <Pill tone="default">MC</Pill> : null}
            </span>
            {loadingVersions ? <Loader2 size={15} className="spin" /> : <ChevronDown size={16} className={classNames('chevron', versionOpen && 'is-open')} />}
          </button>
          <AnimatePresence>
            {versionOpen ? (
              <motion.div
                className="dropdown-panel version-panel"
                initial={{ opacity: 0, y: -6, scale: 0.985 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -4, scale: 0.99 }}
                transition={{ duration: 0.18, ease: [0.22, 0.8, 0.2, 1] }}
              >
              <div className="dropdown-search">
                <Search size={14} />
                <input
                  autoFocus
                  value={versionQuery}
                  onChange={(event) => setVersionQuery(event.target.value)}
                  placeholder="搜索版本，例如 1.21"
                  spellCheck={false}
                />
              </div>
              <div className="dropdown-tabs">
                {(
                  [
                    ['release', '正式版'],
                    ['snapshot', '快照'],
                    ['all', '全部']
                  ] as const
                ).map(([key, label]) => (
                  <button key={key} type="button" className={channel === key ? 'is-active' : ''} onClick={() => setChannel(key)}>
                    {label}
                  </button>
                ))}
              </div>
              <div className="dropdown-list">
                {loadingVersions ? (
                  <div className="dropdown-state">
                    <Loader2 size={16} className="spin" /> 正在连接 Mojang 版本清单…
                  </div>
                ) : filteredVersions.length ? (
                  filteredVersions.map((version) => (
                    <OptionRow
                      key={version.id}
                      selected={version.id === value.mcVersion}
                      title={version.id}
                      meta={version.type === 'release' ? '正式版' : version.type === 'snapshot' ? '快照' : '远古版本'}
                      side={version.releaseTime ? version.releaseTime.slice(0, 10) : undefined}
                      onSelect={() => selectVersion(version)}
                    />
                  ))
                ) : (
                  <div className="dropdown-state">没有匹配的版本</div>
                )}
              </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </div>

      <div className="field">
        <label className="field-label">
          模组加载器 <em>MOD LOADER</em>
        </label>
        <div className="loader-tabs">
          {LOADER_ORDER.map((type) => {
            const meta = LOADER_META[type]
            return (
              <button
                key={type}
                type="button"
                className={classNames('loader-tab', value.loader.type === type && 'is-active')}
                onClick={() => onChange({ mcVersion: value.mcVersion, loader: { type, version: type === 'vanilla' ? value.mcVersion : '' } })}
              >
                <span className="loader-mark" style={{ '--loader-color': meta.color } as React.CSSProperties}>
                  {meta.short}
                </span>
                <span>{meta.label}</span>
              </button>
            )
          })}
        </div>
      </div>

      {value.loader.type !== 'vanilla' ? (
        <div className="field">
          <div className="field-label-row">
            <label className="field-label">
              加载器版本 <em>LOADER BUILD</em>
            </label>
            <button type="button" className="field-manual" onClick={() => setManual((v) => !v)}>
              {manual ? '使用列表' : '手动输入'}
            </button>
          </div>
          <div className="dropdown" ref={loaderRef}>
            <button
              type="button"
              className={classNames('dropdown-trigger', loaderOpen && 'is-open')}
              onClick={() => setLoaderOpen((v) => !v)}
            >
              <span className="version-trigger-main">
                <strong>{value.loader.version || (loadingLoaders ? '正在读取构建…' : '选择加载器版本')}</strong>
                <Pill tone="default">{LOADER_META[value.loader.type].label}</Pill>
              </span>
              {loadingLoaders ? <Loader2 size={15} className="spin" /> : <ChevronDown size={16} className={classNames('chevron', loaderOpen && 'is-open')} />}
            </button>
            <AnimatePresence>
              {loaderOpen ? (
                <motion.div
                  className="dropdown-panel"
                  initial={{ opacity: 0, y: -6, scale: 0.985 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -4, scale: 0.99 }}
                  transition={{ duration: 0.18, ease: [0.22, 0.8, 0.2, 1] }}
                >
                <div className="dropdown-search">
                  <Search size={14} />
                  <input
                    autoFocus
                    value={loaderQuery}
                    onChange={(event) => setLoaderQuery(event.target.value)}
                    placeholder={`搜索 ${LOADER_META[value.loader.type].label} 构建`}
                    spellCheck={false}
                  />
                </div>
                <div className="dropdown-list">
                  {loadingLoaders ? (
                    <div className="dropdown-state">
                      <Loader2 size={16} className="spin" /> 正在连接 {LOADER_META[value.loader.type].label} Meta…
                    </div>
                  ) : filteredLoaders.length ? (
                    filteredLoaders.map((item, index) => (
                      <OptionRow
                        key={item.version}
                        selected={item.version === value.loader.version}
                        title={item.version}
                        meta={index === 0 ? <><Sparkles size={10} /> 推荐</> : undefined}
                        onSelect={() => {
                          onChange({ mcVersion: value.mcVersion, loader: { ...value.loader, version: item.version } })
                          setLoaderOpen(false)
                          setLoaderQuery('')
                        }}
                      />
                    ))
                  ) : (
                    <div className="dropdown-state">
                      没有自动获取到构建列表。
                      <button type="button" className="linkish" onClick={() => setManual(true)}>
                        手动输入
                      </button>
                    </div>
                  )}
                </div>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
          {manual || (!loadingLoaders && !loaderVersions.length) ? (
            <input
              className="text-input mono"
              value={value.loader.version}
              onChange={(event) => onChange({ mcVersion: value.mcVersion, loader: { ...value.loader, version: event.target.value.trim() } })}
              placeholder={`手动输入 ${LOADER_META[value.loader.type].label} 版本`}
            />
          ) : null}
          <p className="field-hint">
            首次启动时，EML 会自动下载该加载器及其依赖。列表为空时可以从官方 Maven 手动填写构建号。
          </p>
        </div>
      ) : (
        <div className="vanilla-note">
          <span className="vanilla-orbit" />
          <div>
            <strong>纯净 Vanilla</strong>
            <p>不安装加载器，首次启动只会下载官方客户端与资源。</p>
          </div>
        </div>
      )}
    </div>
  )
}
