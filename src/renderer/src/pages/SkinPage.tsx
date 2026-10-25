import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  Check,
  FolderOpen,
  ImagePlus,
  Move3d,
  RefreshCw,
  RotateCcw,
  Shirt,
  Sparkles,
  Upload,
  UserRound,
  Wand2
} from 'lucide-react'
import type { AppearanceKind, SkinBundle } from '@shared/types'
import { errorMessage, useApp } from '../store'
import { Button, classNames, Pill, Spinner } from '../components/ui'
import SkinCanvas, { type SkinAnimation } from '../components/SkinCanvas'
import Background from '../components/Background'
import fallbackCape from '../assets/ember-cape.png'

const ANIMATIONS: { value: SkinAnimation; label: string }[] = [
  { value: 'idle', label: '待机' },
  { value: 'walk', label: '行走' },
  { value: 'run', label: '奔跑' },
  { value: 'fly', label: '飞行' }
]

export default function SkinPage(): React.JSX.Element {
  const { activeAccount, activeInstance, setAccountOpen, pushToast, resolvedTheme } = useApp()
  const [bundle, setBundle] = useState<SkinBundle | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [animation, setAnimation] = useState<SkinAnimation>('idle')
  const [rotate, setRotate] = useState(true)
  const [variant, setVariant] = useState<'classic' | 'slim'>('classic')
  const [selectedSkin, setSelectedSkin] = useState<string | null>(null)
  const [capeVisible, setCapeVisible] = useState(true)
  const [appliedSkinId, setAppliedSkinId] = useState<string | null>(null)
  const [appliedCapeId, setAppliedCapeId] = useState<string | null>(null)
  const canvasRef = useRef<{ reset: () => void }>(null)

  const local = bundle?.local
  const localMode = !!local?.detected

  const load = async (refresh = false) => {
    setLoading(true)
    try {
      const data = await window.ember.skin.get(refresh)
      setBundle(data)
      const active = data.skins.find((s) => s.state === 'active') ?? data.skins[0]
      setSelectedSkin(active?.image ?? null)
      setVariant(active?.variant ?? 'classic')
      setCapeVisible(data.supported ? !!data.activeCapeId : true)
    } catch (err) {
      setBundle({ supported: false, mode: 'none', reason: errorMessage(err), skins: [], capes: [], activeCapeId: null })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAccount?.id, activeInstance?.id])

  const activeSkin = useMemo(
    () =>
      bundle?.skins.find((s) => s.image === selectedSkin) ??
      bundle?.skins.find((s) => s.state === 'active') ??
      bundle?.skins[0] ??
      null,
    [bundle, selectedSkin]
  )

  const localActiveSkin = local?.skins.find((file) => file.id === local.activeSkinId) ?? local?.skins[0] ?? null
  const localActiveCape = local?.capes.find((file) => file.id === local.activeCapeId) ?? local?.capes[0] ?? null
  const activeCape = bundle?.capes.find((c) => c.id === bundle.activeCapeId) ?? bundle?.capes.find((c) => c.state === 'active') ?? null
  const skinImage = localMode ? localActiveSkin?.image : activeSkin?.image
  const capeImage = capeVisible ? (localMode ? localActiveCape?.image : activeCape?.image) ?? fallbackCape : null
  const modeLabel = localMode ? '万用皮肤补丁 · 本地' : bundle?.mode === 'account' ? '在线账户' : '离线预览'

  const upload = async () => {
    if (!bundle?.supported) {
      setAccountOpen(true)
      return
    }
    setBusy(true)
    try {
      await window.ember.skin.upload(undefined, variant)
      await load(true)
      pushToast({ tone: 'success', title: '皮肤已更新', message: '新的皮肤纹理已经应用到账户。' })
    } catch (err) {
      pushToast({ tone: 'error', title: '上传皮肤失败', message: errorMessage(err) })
    } finally {
      setBusy(false)
    }
  }

  const switchCape = async (capeId: string) => {
    setBusy(true)
    try {
      await window.ember.skin.switchCape(capeId)
      setCapeVisible(true)
      await load(true)
      pushToast({ tone: 'success', title: '披风已切换' })
    } catch (err) {
      pushToast({ tone: 'error', title: '切换披风失败', message: errorMessage(err) })
    } finally {
      setBusy(false)
    }
  }

  const hideCape = async () => {
    setBusy(true)
    try {
      await window.ember.skin.hideCape()
      setCapeVisible(false)
      await load(true)
      pushToast({ tone: 'success', title: '披风已隐藏' })
    } catch (err) {
      pushToast({ tone: 'error', title: '隐藏披风失败', message: errorMessage(err) })
    } finally {
      setBusy(false)
    }
  }

  const applyLocal = async (kind: AppearanceKind, fileId: string) => {
    setBusy(true)
    try {
      const data = await window.ember.skin.applyLocal(kind, fileId)
      setBundle(data)
      if (kind === 'skin') setAppliedSkinId(fileId)
      else setAppliedCapeId(fileId)
      setCapeVisible(true)
      pushToast({ tone: 'success', title: kind === 'skin' ? '本地皮肤已应用' : '本地披风已应用', message: '下次启动游戏时由万用皮肤补丁读取。' })
    } catch (err) {
      pushToast({ tone: 'error', title: '应用失败', message: errorMessage(err) })
    } finally {
      setBusy(false)
    }
  }

  const importLocal = async (kind: AppearanceKind) => {
    setBusy(true)
    try {
      const data = await window.ember.skin.importLocal(kind)
      setBundle(data)
      pushToast({ tone: 'success', title: kind === 'skin' ? '皮肤已加入外观库' : '披风已加入外观库' })
    } catch (err) {
      pushToast({ tone: 'error', title: '导入失败', message: errorMessage(err) })
    } finally {
      setBusy(false)
    }
  }

  const installSupport = async () => {
    setBusy(true)
    try {
      const data = await window.ember.skin.installSupport()
      setBundle(data)
      if (data.local?.detected) {
        pushToast({
          tone: 'success',
          title: '外观补丁已安装',
          message: '现在可以选择皮肤库/披风库；重启游戏后由 LocalSkin 读取。'
        })
      } else {
        pushToast({ tone: 'warning', title: '补丁未生效', message: '文件已下载，但当前实例还没有识别到 CustomSkinLoader。' })
      }
    } catch (err) {
      pushToast({ tone: 'error', title: '安装外观补丁失败', message: errorMessage(err) })
    } finally {
      setBusy(false)
    }
  }

  const libraryFor = (kind: AppearanceKind) => {
    const library = kind === 'skin' ? local?.librarySkins ?? [] : local?.libraryCapes ?? []
    const current = kind === 'skin' ? local?.skins ?? [] : local?.capes ?? []
    const ids = new Set(library.map((file) => file.id))
    return [...library, ...current.filter((file) => !ids.has(file.id))]
  }
  const localFor = (kind: AppearanceKind) => (kind === 'skin' ? local?.skins ?? [] : local?.capes ?? [])

  return (
    <div className="page skin-page">
      <Background variant="skin" />
      <div className="page-head">
        <div>
          <h1>皮肤与披风</h1>
          <p>在线账户使用官方皮肤；检测到万用皮肤补丁时改为读取实例内的 LocalSkin。</p>
        </div>
        <div className="page-head-actions">
          <Pill tone={localMode ? 'success' : 'default'} dot>{modeLabel}</Pill>
          <Button variant="ghost" icon={RefreshCw} loading={loading} onClick={() => void load(true)}>刷新</Button>
          {activeAccount ? null : <Button variant="primary" icon={UserRound} onClick={() => setAccountOpen(true)}>登录账户</Button>}
        </div>
      </div>

      <div className="skin-layout">
        <section className="skin-stage">
          <div className="skin-stage-head">
            <div>
              <div className="skin-hud">3D PREVIEW</div>
              <strong>{activeAccount?.name ?? '离线预览'}</strong>
            </div>
            <div className="stage-controls">
              <button type="button" onClick={() => canvasRef.current?.reset()} aria-label="重置视角"><RotateCcw size={15} /></button>
              <button type="button" className={rotate ? 'is-active' : ''} onClick={() => setRotate((value) => !value)} aria-label="自动旋转"><Move3d size={15} /></button>
            </div>
          </div>
          {loading ? (
            <div className="skin-canvas-loading"><Spinner size={20} /> 读取外观中…</div>
          ) : (
            <SkinCanvas
              ref={canvasRef}
              skinImage={skinImage}
              capeImage={capeImage}
              slim={variant === 'slim'}
              animation={animation}
              autoRotate={rotate}
              lightTheme={resolvedTheme === 'light'}
            />
          )}
          <div className="skin-stage-foot">
            <div className="animation-switch">
              {ANIMATIONS.map((item) => (
                <button key={item.value} type="button" className={classNames(animation === item.value && 'is-active')} onClick={() => setAnimation(item.value)}>
                  {item.label}
                </button>
              ))}
            </div>
            <span className="skin-fps">{localMode ? 'LocalSkin' : 'EML Skin'}</span>
          </div>
          {localMode ? (
            <div className="skin-offline-overlay">
              <Shirt size={22} />
              <div>
                <strong>本地外观已接管</strong>
                <p>{local?.modFile} · {local?.skinDir}</p>
              </div>
            </div>
          ) : !bundle?.supported ? (
            <div className="skin-offline-overlay">
              <UserRound size={22} />
              <div>
                <strong>当前是离线预览</strong>
                <p>{bundle?.reason ?? '登录账户或检测到万用皮肤补丁后可以更换外观。'}</p>
              </div>
              <Button variant="secondary" onClick={() => setAccountOpen(true)}>打开账户面板</Button>
            </div>
          ) : null}
        </section>

        <aside className="skin-panel">
          <div className="skin-panel-head">
            <div>
              <h2>外观</h2>
              <p>{localMode ? '本地皮肤与披风库' : '账户皮肤与披风'}</p>
            </div>
            <span className="skin-count">{localMode ? localFor('skin').length : bundle?.skins.length ?? 0} 个</span>
          </div>

          {localMode ? (
            <div className="appearance-mode">
              <span className="appearance-path" title={local?.gameDir}>{local?.gameDir}</span>
              <div className="appearance-current">
                <span>当前皮肤 <strong>{localActiveSkin?.name ?? '未设置'}</strong></span>
                <span>当前披风 <strong>{localActiveCape?.name ?? '未设置'}</strong></span>
              </div>
              <div className="appearance-mode-actions">
                <Button variant="ghost" icon={FolderOpen} onClick={() => void window.ember.skin.openLocal()} disabled={busy}>打开外观库</Button>
                <Button variant="ghost" icon={ImagePlus} onClick={() => void importLocal('skin')} disabled={busy}>导入皮肤</Button>
              </div>
            </div>
          ) : null}

          {!localMode ? (
            <div className="appearance-install">
              <div>
                <strong>本地皮肤 / 披风需要外观补丁</strong>
                <p>当前实例没有万用皮肤补丁。安装后可在启动器直接选择皮肤与披风，离线账户也能使用。</p>
              </div>
              <Button
                variant="secondary"
                icon={Shirt}
                loading={busy}
                disabled={activeInstance?.loader.type === 'vanilla'}
                onClick={() => void installSupport()}
              >
                {activeInstance?.loader.type === 'vanilla' ? 'Vanilla 无法安装' : '安装万用皮肤补丁'}
              </Button>
            </div>
          ) : null}

          <div className="appearance-section">
            <div className="appearance-section-head">
              <span>皮肤</span>
              <em>{localMode ? 'LocalSkin/skins' : '账户'}</em>
            </div>
            <div className="appearance-grid">
              {(localMode ? libraryFor('skin') : bundle?.skins ?? []).slice(0, 18).map((item) => {
                const id = 'id' in item ? item.id : ''
                const image = item.image
                const active = localMode ? local?.activeSkinId === id || appliedSkinId === id : activeSkin?.id === id
                return (
                  <button
                    key={id || image}
                    type="button"
                    className={classNames('appearance-tile', active && 'is-active')}
                    onClick={() => {
                      if (localMode) void applyLocal('skin', id)
                      else {
                        setSelectedSkin(image)
                        setVariant(('variant' in item && item.variant) || 'classic')
                      }
                    }}
                    title={localMode ? `应用 ${id}` : '预览'}
                  >
                    <span className="appearance-tile-image" style={{ backgroundImage: `url("${image}")` }} />
                    <span className="appearance-tile-copy">{'name' in item ? item.name : (item as { variant?: string }).variant ?? '皮肤'}</span>
                    {active ? <Check size={12} className="appearance-check" /> : null}
                  </button>
                )
              })}
              {localMode && !libraryFor('skin').length ? <p className="appearance-empty">外观库还没有皮肤，先导入 PNG。</p> : null}
            </div>
            {localMode ? (
              <div className="appearance-actions">
                <Button variant="ghost" icon={ImagePlus} onClick={() => void importLocal('skin')} disabled={busy}>添加到皮肤库</Button>
                <Button variant="ghost" icon={FolderOpen} onClick={() => void window.ember.skin.openLocal('skin')} disabled={busy}>打开文件夹</Button>
              </div>
            ) : (
              <div className="appearance-actions">
                <Button variant="ghost" icon={ImagePlus} onClick={() => void importLocal('skin')} disabled={busy}>导入皮肤</Button>
                <Button variant="ghost" icon={FolderOpen} onClick={() => void window.ember.skin.openLocal('skin')} disabled={busy}>打开本地皮肤库</Button>
                <Button variant="ghost" icon={Upload} onClick={() => void upload()} disabled={busy}>上传新皮肤</Button>
              </div>
            )}
          </div>

          <div className="appearance-section">
            <div className="appearance-section-head">
              <span>披风</span>
              <em>{localMode ? 'LocalSkin/capes' : '账户'}</em>
            </div>
            <div className="appearance-grid">
              {(localMode ? libraryFor('cape') : bundle?.capes ?? []).slice(0, 18).map((item) => {
                const id = 'id' in item ? item.id : ''
                const image = item.image
                const active = localMode ? local?.activeCapeId === id || appliedCapeId === id : bundle?.activeCapeId === id
                return (
                  <button
                    key={id || image}
                    type="button"
                    className={classNames('appearance-tile', active && 'is-active')}
                    onClick={() => {
                      if (localMode) void applyLocal('cape', id)
                      else void switchCape(id)
                    }}
                    title={localMode ? `应用 ${id}` : '切换披风'}
                  >
                    <span className="appearance-tile-image is-cape" style={{ backgroundImage: `url("${image}")` }} />
                    <span className="appearance-tile-copy">{'name' in item ? item.name : item.alias}</span>
                    {active ? <Check size={12} className="appearance-check" /> : null}
                  </button>
                )
              })}
              {localMode && !libraryFor('cape').length ? <p className="appearance-empty">外观库还没有披风，先导入 PNG。</p> : null}
            </div>
            {localMode ? (
              <div className="appearance-actions">
                <Button variant="ghost" icon={ImagePlus} onClick={() => void importLocal('cape')} disabled={busy}>添加到披风库</Button>
                <Button variant="ghost" icon={FolderOpen} onClick={() => void window.ember.skin.openLocal('cape')} disabled={busy}>打开文件夹</Button>
              </div>
            ) : (
              <div className="appearance-actions">
                <Button variant="ghost" icon={ImagePlus} onClick={() => void importLocal('cape')} disabled={busy}>导入披风</Button>
                <Button variant="ghost" icon={FolderOpen} onClick={() => void window.ember.skin.openLocal('cape')} disabled={busy}>打开本地披风库</Button>
                {bundle?.accountType === 'msa' && bundle.activeCapeId ? (
                  <Button variant="ghost" icon={Wand2} onClick={() => void hideCape()} disabled={busy}>隐藏当前披风</Button>
                ) : null}
              </div>
            )}
          </div>

          <div className="appearance-tip">
            <Sparkles size={14} />
            <p>
              {localMode
                ? '万用皮肤补丁会读取实例目录下的 LocalSkin：皮肤放 skins，披风放 capes，文件名必须与游戏内用户名一致。'
                : '外观库位于启动器数据目录，可以直接把 PNG 放进去或导入；检测到万用皮肤补丁后即可离线使用。'}
            </p>
          </div>

          <div className="skin-note">
            <Check size={13} />
            <span>{localMode ? '路径由当前实例的万用皮肤补丁配置决定。' : '未检测到万用皮肤补丁时沿用在线账户逻辑。'}</span>
          </div>
        </aside>
      </div>
    </div>
  )
}
