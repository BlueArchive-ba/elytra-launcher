import React, { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, ArrowRight, Check, Cpu, Layers3, Sparkles, Wand2 } from 'lucide-react'
import type { AccentKey, LoaderSpec } from '@shared/types'
import { ACCENTS, LOADER_META, formatBytes } from '@shared/utils'
import { useApp } from '../store'
import { Button, classNames, Modal, ModalHeader, Pill } from './ui'
import { VersionPicker } from './VersionPicker'

const STEPS = [
  { id: 1, label: '名称' },
  { id: 2, label: '版本' },
  { id: 3, label: '确认' }
]

export default function CreateInstanceModal(): React.JSX.Element {
  const { createOpen, setCreateOpen, createInstance, config, system, pushToast } = useApp()
  const [step, setStep] = useState(1)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [emblem, setEmblem] = useState('')
  const [emblemTouched, setEmblemTouched] = useState(false)
  const [accent, setAccent] = useState<AccentKey>('ember')
  const [mcVersion, setMcVersion] = useState('')
  const [loader, setLoader] = useState<LoaderSpec>({ type: 'vanilla', version: '' })
  const [memory, setMemory] = useState(4096)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!createOpen) return
    setStep(1)
    setName('')
    setDescription('')
    setEmblem('')
    setEmblemTouched(false)
    setAccent('ember')
    setMcVersion('')
    setLoader({ type: 'vanilla', version: '' })
    setMemory(Math.min(8192, config?.global.memoryMax ?? 4096))
    setBusy(false)
  }, [createOpen, config?.global.memoryMax])

  const accentMeta = ACCENTS.find((a) => a.key === accent) ?? ACCENTS[0]
  const canContinue = useMemo(() => {
    if (step === 1) return name.trim().length > 0
    if (step === 2) return !!mcVersion && (loader.type === 'vanilla' || !!loader.version)
    return true
  }, [loader, mcVersion, name, step])

  const effectiveEmblem = (emblem || name.trim().slice(0, 2) || 'E').toUpperCase().slice(0, 2)
  const totalMem = system?.totalMemMb ?? 16384
  const maxMem = Math.max(2048, Math.min(32768, Math.floor(totalMem / 1024) * 1024))
  const memoryStep = 512

  const close = () => {
    if (busy) return
    setCreateOpen(false)
  }

  const submit = async () => {
    if (busy) return
    setBusy(true)
    try {
      await createInstance({
        name: name.trim(),
        description: description.trim(),
        emblem: effectiveEmblem,
        accent,
        mcVersion,
        loader: loader.type === 'vanilla' ? { type: 'vanilla', version: mcVersion } : loader,
        memoryMax: memory
      })
    } catch (err) {
      pushToast({ tone: 'error', title: '创建实例失败', message: err instanceof Error ? err.message : String(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={createOpen} onClose={close} size="lg" className="create-modal" labelledBy="create-title">
      <ModalHeader
        eyebrow="新建实例"
        title="新建实例"
        description="每个实例有独立目录，Mod、配置与存档互不影响。"
        onClose={close}
        id="create-title"
      />

      <div className="stepper">
        {STEPS.map((item) => (
          <div key={item.id} className={classNames('step', step === item.id && 'is-active', step > item.id && 'is-done')}>
            <span className="step-num">{step > item.id ? <Check size={13} /> : `0${item.id}`}</span>
            <span className="step-word">
              <strong>{item.label}</strong>
            </span>
            {item.id < STEPS.length ? <i className="step-line" /> : null}
          </div>
        ))}
      </div>

      <div className="create-body">
        <div className="create-preview" style={{ '--card-a': accentMeta.from, '--card-b': accentMeta.to } as React.CSSProperties}>
          <div className="preview-orb" />
          <div className="preview-grid" />
          <div className="preview-emblem">{effectiveEmblem}</div>
          <div className="preview-ring ring-a" />
          <div className="preview-ring ring-b" />
          <div className="preview-label">
            <span>新实例</span>
            <strong>{name.trim() || '新世界'}</strong>
          </div>
          <div className="preview-meta">
            <span>Minecraft {mcVersion || '—'}</span>
            <span>{loader.type === 'vanilla' ? '原版' : LOADER_META[loader.type].label}</span>
          </div>
        </div>

        <div className="create-form">
          <AnimatePresence mode="wait">
            {step === 1 ? (
              <motion.div key="step1" className="step-pane" initial={{ opacity: 0, x: 18 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -18 }} transition={{ duration: 0.22 }}>
                <div className="field">
                  <label className="field-label">
                    实例名称 <em>NAME</em>
                  </label>
                  <input
                    className="text-input big"
                    value={name}
                    onChange={(event) => {
                      setName(event.target.value)
                      if (!emblemTouched) setEmblem(event.target.value.trim().slice(0, 2).toUpperCase())
                    }}
                    placeholder="例如：Crimson Depths"
                    maxLength={40}
                    autoFocus
                  />
                </div>
                <div className="field">
                  <label className="field-label">
                    一句话描述 <em>OPTIONAL</em>
                  </label>
                  <textarea
                    className="text-input"
                    rows={2}
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    placeholder="这个实例是为了什么而存在的？"
                    maxLength={160}
                  />
                </div>
                <div className="field-row">
                  <div className="field">
                    <label className="field-label">
                      徽记 <em>EMBLEM</em>
                    </label>
                    <input
                      className="text-input mono emblem-input"
                      value={emblem || effectiveEmblem}
                      onChange={(event) => {
                        setEmblemTouched(true)
                        setEmblem(event.target.value.toUpperCase().slice(0, 2))
                      }}
                      maxLength={2}
                    />
                  </div>
                  <div className="field">
                    <label className="field-label">
                      能量色 <em>ACCENT</em>
                    </label>
                    <div className="accent-swatches">
                      {ACCENTS.map((item) => (
                        <button
                          key={item.key}
                          type="button"
                          className={classNames('accent-swatch', accent === item.key && 'is-active')}
                          style={{ '--sw-a': item.from, '--sw-b': item.to } as React.CSSProperties}
                          onClick={() => setAccent(item.key)}
                          aria-label={item.label}
                          data-tip={item.label}
                        >
                          {accent === item.key ? <Check size={12} /> : null}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </motion.div>
            ) : null}

            {step === 2 ? (
              <motion.div key="step2" className="step-pane" initial={{ opacity: 0, x: 18 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -18 }} transition={{ duration: 0.22 }}>
                <VersionPicker value={{ mcVersion, loader }} onChange={(next) => { setMcVersion(next.mcVersion); setLoader(next.loader) }} />
              </motion.div>
            ) : null}

            {step === 3 ? (
              <motion.div key="step3" className="step-pane" initial={{ opacity: 0, x: 18 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -18 }} transition={{ duration: 0.22 }}>
                <div className="ignite-summary">
                  <div className="summary-row">
                    <span>实例</span>
                    <strong>{name}</strong>
                  </div>
                  <div className="summary-row">
                    <span>版本</span>
                    <strong>
                      MC {mcVersion} · {LOADER_META[loader.type].label}
                      {loader.type !== 'vanilla' ? ` ${loader.version}` : ''}
                    </strong>
                  </div>
                  <div className="summary-row">
                    <span>游戏目录</span>
                    <em>每个实例独立隔离 · ~/.ember/{name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'instance'}</em>
                  </div>
                </div>

                <div className="field">
                  <div className="field-label-row">
                    <label className="field-label">
                      最大内存 <em>MAX MEMORY</em>
                    </label>
                    <Pill tone="accent">{formatBytes(memory * 1024 * 1024)}</Pill>
                  </div>
                  <div className="memory-slider">
                    <span className="memory-fill" style={{ width: `${Math.min(100, (memory / maxMem) * 100)}%` }} />
                    <input
                      type="range"
                      min={1024}
                      max={maxMem}
                      step={memoryStep}
                      value={memory}
                      onChange={(event) => setMemory(Number(event.target.value))}
                    />
                  </div>
                  <div className="slider-labels">
                    <span>1 GB</span>
                    <span>系统内存 {formatBytes(totalMem * 1024 * 1024)}</span>
                    <span>{Math.round(maxMem / 1024)} GB</span>
                  </div>
                  <p className="field-hint">
                    推荐为大型模组包分配 6–8 GB。分配超过物理内存的 60% 反而更容易触发 OOM 或原生崩溃。
                  </p>
                </div>

                <div className="ignite-note">
                  <Wand2 size={17} />
                  <p>
                    首次启动会由 <strong>EML</strong> 自动下载并安装 Minecraft {mcVersion}
                    {loader.type !== 'vanilla' ? ` 与 ${LOADER_META[loader.type].label} ${loader.version}` : ''}。下载进度会显示在启动面板中。
                  </p>
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </div>

      <div className="create-foot">
        <div className="create-foot-left">
          {step === 2 && mcVersion ? (
            <Pill tone="default" dot>
              {mcVersion} · {LOADER_META[loader.type].label}
            </Pill>
          ) : (
            <span className="create-hint">
              <Cpu size={13} /> 全局内存上限 {config?.global.memoryMax ?? 4096} MB
            </span>
          )}
        </div>
        <div className="create-foot-actions">
          {step > 1 ? (
            <Button variant="ghost" icon={ArrowLeft} onClick={() => setStep((s) => s - 1)} disabled={busy}>
              上一步
            </Button>
          ) : (
            <Button variant="ghost" icon={Layers3} onClick={() => setCreateOpen(false)}>
              取消
            </Button>
          )}
          {step < 3 ? (
            <Button variant="primary" iconRight={ArrowRight} disabled={!canContinue} onClick={() => setStep((s) => s + 1)}>
              下一步
            </Button>
          ) : (
            <Button variant="primary" icon={Sparkles} loading={busy} onClick={() => void submit()}>
              创建实例
            </Button>
          )}
        </div>
      </div>
    </Modal>
  )
}
