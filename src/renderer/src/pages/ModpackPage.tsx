import React, { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  AlertTriangle,
  ArrowRight,
  Check,
  FileJson,
  FolderOpen,
  Globe2,
  PackageOpen,
  Play,
  Rocket,
  Search,
  ShieldCheck,
  Sparkles,
  UploadCloud
} from 'lucide-react'
import type { LoaderSpec, ModpackInfo, ModpackRef } from '@shared/types'
import { formatBytes, LOADER_META } from '@shared/utils'
import { errorMessage, useApp } from '../store'
import { Button, classNames, EmptyState, Pill, Spinner } from '../components/ui'
import { VersionPicker } from '../components/VersionPicker'
import Background from '../components/Background'

export default function ModpackPage(): React.JSX.Element {
  const { activeInstance, reload, selectInstance, startLaunch, navigate, pushToast } = useApp()
  const [mode, setMode] = useState<'url' | 'local'>('url')
  const [url, setUrl] = useState('')
  const [local, setLocal] = useState<{ path: string; name: string } | null>(null)
  const [info, setInfo] = useState<ModpackInfo | null>(null)
  const [name, setName] = useState('')
  const [spec, setSpec] = useState<{ mcVersion: string; loader: LoaderSpec }>({ mcVersion: '', loader: { type: 'vanilla', version: '' } })
  const [inspecting, setInspecting] = useState(false)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const ref = useMemo<ModpackRef | null>(() => {
    if (mode === 'url' && url.trim()) return { kind: 'url', url: url.trim() }
    if (mode === 'local' && local) return { kind: 'local', localPath: local.path, name: local.name }
    return null
  }, [local, mode, url])

  useEffect(() => {
    setInfo(null)
    setError(null)
  }, [mode, url, local?.path])

  const inspect = async () => {
    if (!ref) {
      setError(mode === 'url' ? '请先填写清单 URL' : '请先选择一个本地 JSON 清单')
      return
    }
    setInspecting(true)
    setError(null)
    try {
      const data = await window.ember.modpack.inspect(ref)
      setInfo(data)
      setName(data.name)
      if (data.suggestedMcVersion) {
        setSpec({
          mcVersion: data.suggestedMcVersion,
          loader: data.suggestedLoader ?? { type: 'vanilla', version: data.suggestedMcVersion }
        })
      }
      if (!data.valid) setError(data.warnings[0] ?? '清单校验未通过，但仍可检查内容。')
    } catch (err) {
      setInfo(null)
      setError(errorMessage(err))
    } finally {
      setInspecting(false)
    }
  }

  const pickLocal = async () => {
    try {
      const picked = await window.ember.modpack.pick()
      if (picked) {
        setLocal(picked)
        setMode('local')
        setInfo(null)
      }
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  const doImport = async (launchAfter: boolean) => {
    if (!ref || !info) return
    if (!spec.mcVersion) {
      setError('请选择 Minecraft 版本')
      return
    }
    if (spec.loader.type !== 'vanilla' && !spec.loader.version) {
      setError('请选择加载器版本')
      return
    }
    setImporting(true)
    setError(null)
    try {
      const created = await window.ember.modpack.import({
        ref: { ...ref, name: info.name },
        name: name.trim() || info.name,
        mcVersion: spec.mcVersion,
        loader: spec.loader.type === 'vanilla' ? { type: 'vanilla', version: spec.mcVersion } : spec.loader
      })
      await reload(true)
      await selectInstance(created.id)
      pushToast({
        tone: 'success',
        title: '整合包已登记',
        message: launchAfter ? '开始首次启动，ELYTRA 将按清单解析并下载文件。' : '实例已创建。启动后会按清单安装文件。'
      })
      navigate('/')
      if (launchAfter) {
        window.setTimeout(() => void startLaunch(created.id), 300)
      }
    } catch (err) {
      setError(errorMessage(err))
      pushToast({ tone: 'error', title: '导入失败', message: errorMessage(err) })
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="page modpack-page">
      <Background variant="mods" />
      <div className="page-head">
        <div>
          <h1>导入整合包</h1>
          <p>读取 CurseForge、ELYTRA 或 EML 整合包清单，创建一个独立实例。</p>
        </div>
        <div className="page-head-actions">
          <Button variant="ghost" icon={FileJson} onClick={() => void window.ember.app.openExternal('https://emlproject.com/resources/modpack-json-generator/')}>
            清单格式
          </Button>
        </div>
      </div>

      <div className="modpack-single">
        <div className="modpack-main">
          <div className="intake-card">
            <div className="intake-grid" />
            <div className="intake-head">
              <span className="intake-icon"><UploadCloud size={24} /></span>
              <div>
                <h2>选择清单</h2>
              </div>
            </div>
            <div className="intake-tabs">
              <button type="button" className={mode === 'url' ? 'is-active' : ''} onClick={() => setMode('url')}>
                <Globe2 size={15} /> 远程地址
              </button>
              <button type="button" className={mode === 'local' ? 'is-active' : ''} onClick={() => setMode('local')}>
                <FileJson size={15} /> 本地文件
              </button>
            </div>

            {mode === 'url' ? (
              <div className="intake-url">
                <div className="mod-search">
                  <Globe2 size={15} />
                  <input
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && void inspect()}
                    placeholder="https://example.com/pack/manifest.json"
                    spellCheck={false}
                  />
                </div>
                <Button variant="secondary" icon={Search} loading={inspecting} onClick={() => void inspect()}>
                  校验清单
                </Button>
              </div>
            ) : (
              <div className="intake-local">
                <button type="button" className="local-drop" onClick={() => void pickLocal()}>
                  <span className="local-icon"><FileJson size={26} /></span>
                  {local ? (
                    <>
                      <strong>{local.name}</strong>
                      <em>{local.path}</em>
                    </>
                  ) : (
                    <>
                      <strong>选择本地整合包清单</strong>
                      <em>CurseForge manifest.json 或 EML 清单，仅选择 .json</em>
                    </>
                  )}
                </button>
                <Button variant="secondary" icon={FolderOpen} onClick={() => void pickLocal()}>
                  {local ? '更换文件' : '浏览文件'}
                </Button>
                {local ? (
                  <Button variant="ghost" icon={Search} loading={inspecting} onClick={() => void inspect()}>
                    校验
                  </Button>
                ) : null}
              </div>
            )}

            <div className="intake-format">
              <ShieldCheck size={15} />
              <p>支持 CurseForge manifest.json 与 EML 清单；暂不支持直接导入 CurseForge .zip 或 Modrinth .mrpack。CurseForge 文件会在首次启动时解析并缓存。</p>
            </div>

            {error ? (
              <motion.div className="intake-error" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
                <AlertTriangle size={16} />
                <span>{error}</span>
              </motion.div>
            ) : null}
          </div>

          {info ? (
            <motion.div className="manifest-card" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }}>
              <div className="manifest-head">
                <div>
                  <div className="eyebrow">已读取清单</div>
                  <h2>{info.name}</h2>
                  <p>清单位于 {info.source.kind === 'url' ? info.source.url : info.source.localPath}</p>
                </div>
                <div className="manifest-head-actions">
                  <Pill tone="default">{info.format === 'curseforge' ? 'CurseForge' : info.format === 'elytra' ? 'ELYTRA 清单' : 'EML 清单'}</Pill>
                  <Pill tone={info.valid ? 'success' : 'danger'} dot>
                    {info.valid ? '清单有效' : '需要检查'}
                  </Pill>
                </div>
              </div>

              <div className="manifest-stats">
                <div><span>文件条目</span><strong>{info.fileCount}</strong><em>个文件</em></div>
                <div><span>声明体积</span><strong>{info.format === 'curseforge' ? '待解析' : formatBytes(info.totalSize)}</strong><em>{info.format === 'curseforge' ? '首次启动解析' : info.format === 'elytra' ? '元数据体积' : '总大小'}</em></div>
                <div><span>来源主机</span><strong>{info.hosts.length}</strong><em>个来源</em></div>
                <div><span>安全校验</span><strong>{info.warnings.length ? info.warnings.length : 'OK'}</strong><em>警告</em></div>
              </div>

              {info.hosts.length ? (
                <div className="host-chips">
                  <span>下载来源</span>
                  {info.hosts.map((host) => <code key={host}>{host}</code>)}
                </div>
              ) : null}

              {info.warnings.length ? (
                <div className="manifest-warnings">
                  {info.warnings.map((warning) => (
                    <div key={warning}><AlertTriangle size={14} /> {warning}</div>
                  ))}
                </div>
              ) : null}

              <div className="manifest-config">
                <div className="field">
                  <label className="field-label">实例名称</label>
                  <input className="text-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={48} />
                </div>
                <VersionPicker value={spec} onChange={setSpec} />
              </div>

              <div className="manifest-actions">
                <div className="manifest-note">
                  <Sparkles size={15} />
                  <p>{info.format === 'elytra' ? '这是 ELYTRA 导出的元数据清单：会创建实例并保存待恢复列表；请把完整整合包 ZIP 的 overrides/mods 放到清单同目录，或从模组库恢复文件。' : '导入后首次启动会由 ELYTRA 解析清单并下载文件。CurseForge 文件较多时，首次解析需要一点时间；进度会显示在启动面板中。'}</p>
                </div>
                <div className="manifest-buttons">
                  <Button variant="secondary" icon={PackageOpen} loading={importing} onClick={() => void doImport(false)}>
                    仅创建实例
                  </Button>
                  <Button variant="primary" icon={Play} loading={importing} onClick={() => void doImport(true)}>
                    导入并启动
                  </Button>
                </div>
              </div>
            </motion.div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
