import React, { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Check,
  Gamepad2,
  Keyboard,
  Layers,
  MessageSquare,
  Monitor,
  Plus,
  RotateCcw,
  Save,
  Trash2,
  Volume2,
  X
} from 'lucide-react'
import type { InstanceView } from '@shared/types'
import { useApp } from '../store'
import { Button, classNames, Modal, ModalHeader, Pill, Switch } from '../components/ui'
import Background from '../components/Background'
import SelectMenu from '../components/SelectMenu'

type Category = 'video' | 'sound' | 'controls' | 'interface' | 'raw'

interface Field {
  key: string
  label: string
  type: 'range' | 'switch' | 'select' | 'key' | 'text'
  default: string
  min?: number
  max?: number
  step?: number
  hint?: string
  options?: { value: string; label: string }[]
  display?: (value: string) => string
}

const VIDEO: Field[] = [
  {
    key: 'fov',
    label: '视场角',
    type: 'range',
    default: '0',
    min: -1,
    max: 1,
    step: 0.01,
    hint: '30–110°（options 使用 -1–1）',
    display: (value) => `${Math.round(40 * Number(value) + 70)}°`
  },
  { key: 'renderDistance', label: '渲染距离', type: 'range', default: '12', min: 2, max: 32, step: 1, hint: '区块' },
  { key: 'simulationDistance', label: '模拟距离', type: 'range', default: '12', min: 5, max: 32, step: 1, hint: '区块' },
  { key: 'maxFps', label: '最大帧率', type: 'range', default: '120', min: 10, max: 260, step: 10, hint: '260 = 不限' },
  { key: 'graphicsMode', label: '图像品质', type: 'select', default: '1', options: [{ value: '0', label: '流畅' }, { value: '1', label: '高品质' }, { value: '2', label: '极佳' }] },
  { key: 'renderClouds', label: '云', type: 'select', default: 'true', options: [{ value: 'true', label: '高品质' }, { value: 'fast', label: '流畅' }, { value: 'false', label: '关闭' }] },
  { key: 'particles', label: '粒子效果', type: 'select', default: '0', options: [{ value: '0', label: '全部' }, { value: '1', label: '减少' }, { value: '2', label: '最少' }] },
  { key: 'ao', label: '平滑光照', type: 'switch', default: 'true' },
  { key: 'entityShadows', label: '实体阴影', type: 'switch', default: 'true' },
  { key: 'mipmapLevels', label: 'mipmap 级别', type: 'range', default: '4', min: 0, max: 4, step: 1 },
  { key: 'guiScale', label: '界面尺寸', type: 'select', default: '0', options: [{ value: '0', label: '自动' }, { value: '1', label: '1' }, { value: '2', label: '2' }, { value: '3', label: '3' }, { value: '4', label: '4' }] },
  { key: 'gamma', label: '亮度', type: 'range', default: '0.5', min: 0, max: 1, step: 0.05 },
  { key: 'enableVsync', label: '垂直同步', type: 'switch', default: 'true' },
  { key: 'bobView', label: '视角摇晃', type: 'switch', default: 'true' },
  { key: 'fovEffectScale', label: '速度视场变化', type: 'range', default: '1', min: 0, max: 1, step: 0.05 },
  { key: 'screenEffectScale', label: '屏幕效果强度', type: 'range', default: '1', min: 0, max: 1, step: 0.05 },
  { key: 'fullscreen', label: '游戏内全屏', type: 'switch', default: 'false', hint: '与启动器窗口设置不同' }
]

const SOUND_KEYS: [string, string][] = [
  ['soundCategory_master', '主音量'],
  ['soundCategory_music', '音乐'],
  ['soundCategory_record', '音符盒 / 唱片机'],
  ['soundCategory_block', '方块'],
  ['soundCategory_hostile', '敌对生物'],
  ['soundCategory_neutral', '中立生物'],
  ['soundCategory_player', '玩家'],
  ['soundCategory_ambient', '环境'],
  ['soundCategory_weather', '天气'],
  ['soundCategory_voice', '复述'],
  ['soundCategory_ui', '界面']
]

const SOUND: Field[] = SOUND_KEYS.map(([key, label]) => ({
  key,
  label,
  type: 'range',
  default: '1',
  min: 0,
  max: 1,
  step: 0.05
}))

const CONTROLS: Field[] = [
  { key: 'mouseSensitivity', label: '鼠标灵敏度', type: 'range', default: '0.5', min: 0, max: 1, step: 0.01 },
  { key: 'invertYMouse', label: '反转鼠标 Y 轴', type: 'switch', default: 'false' },
  { key: 'rawMouseInput', label: '原始鼠标输入', type: 'switch', default: 'true' },
  { key: 'key_key.forward', label: '前进', type: 'key', default: 'key.keyboard.w' },
  { key: 'key_key.back', label: '后退', type: 'key', default: 'key.keyboard.s' },
  { key: 'key_key.left', label: '左移', type: 'key', default: 'key.keyboard.a' },
  { key: 'key_key.right', label: '右移', type: 'key', default: 'key.keyboard.d' },
  { key: 'key_key.jump', label: '跳跃', type: 'key', default: 'key.keyboard.space' },
  { key: 'key_key.sneak', label: '潜行', type: 'key', default: 'key.keyboard.left.shift' },
  { key: 'key_key.sprint', label: '疾跑', type: 'key', default: 'key.keyboard.left.control' },
  { key: 'key_key.inventory', label: '物品栏', type: 'key', default: 'key.keyboard.e' },
  { key: 'key_key.drop', label: '丢弃物品', type: 'key', default: 'key.keyboard.q' },
  { key: 'key_key.use', label: '使用 / 放置', type: 'key', default: 'key.mouse.right' },
  { key: 'key_key.attack', label: '攻击 / 破坏', type: 'key', default: 'key.mouse.left' },
  { key: 'key_key.pickItem', label: '选取方块', type: 'key', default: 'key.mouse.middle' },
  { key: 'key_key.chat', label: '聊天', type: 'key', default: 'key.keyboard.t' },
  { key: 'key_key.command', label: '命令', type: 'key', default: 'key.keyboard.slash' },
  { key: 'key_key.playerlist', label: '玩家列表', type: 'key', default: 'key.keyboard.tab' },
  { key: 'key_key.socialInteractions', label: '社交屏幕', type: 'key', default: 'key.keyboard.p' },
  { key: 'key_key.advancements', label: '进度', type: 'key', default: 'key.keyboard.l' },
  { key: 'key_key.swapOffhand', label: '交换副手', type: 'key', default: 'key.keyboard.f' },
  { key: 'key_key.togglePerspective', label: '切换视角', type: 'key', default: 'key.keyboard.f5' },
  { key: 'key_key.fullscreen', label: '全屏', type: 'key', default: 'key.keyboard.f11' },
  { key: 'key_key.saveToolbarActivator', label: '保存快捷栏', type: 'key', default: 'key.keyboard.c' },
  { key: 'key_key.loadToolbarActivator', label: '加载快捷栏', type: 'key', default: 'key.keyboard.x' }
]

const INTERFACE: Field[] = [
  { key: 'lang', label: '游戏语言', type: 'select', default: 'zh_cn', options: [{ value: 'zh_cn', label: '简体中文' }, { value: 'zh_tw', label: '繁體中文' }, { value: 'en_us', label: 'English' }, { value: 'ja_jp', label: '日本語' }] },
  { key: 'chatVisibility', label: '聊天可见性', type: 'select', default: '0', options: [{ value: '0', label: '全部' }, { value: '1', label: '仅命令' }, { value: '2', label: '隐藏' }] },
  { key: 'chatOpacity', label: '聊天背景不透明度', type: 'range', default: '1', min: 0, max: 1, step: 0.05 },
  { key: 'chatScale', label: '聊天文字大小', type: 'range', default: '1', min: 0, max: 1, step: 0.05 },
  { key: 'chatWidth', label: '聊天宽度', type: 'range', default: '1', min: 0, max: 1, step: 0.05 },
  { key: 'chatHeightFocused', label: '聊天高度（展开）', type: 'range', default: '1', min: 0, max: 1, step: 0.05 },
  { key: 'chatHeightUnfocused', label: '聊天高度（收起）', type: 'range', default: '0.4375', min: 0, max: 1, step: 0.0625 },
  { key: 'chatColors', label: '聊天颜色', type: 'switch', default: 'true' },
  { key: 'chatLinks', label: '聊天链接', type: 'switch', default: 'true' },
  { key: 'chatLinksPrompt', label: '链接确认', type: 'switch', default: 'true' },
  { key: 'reducedDebugInfo', label: '简化调试信息', type: 'switch', default: 'false' },
  { key: 'showSubtitles', label: '字幕', type: 'switch', default: 'false' },
  { key: 'narrator', label: '复述功能', type: 'select', default: '0', options: [{ value: '0', label: '关闭' }, { value: '1', label: '全部' }, { value: '2', label: '聊天' }, { value: '3', label: '系统' }] },
  { key: 'textBackgroundOpacity', label: '文字背景不透明度', type: 'range', default: '0.5', min: 0, max: 1, step: 0.05 },
  { key: 'attackIndicator', label: '攻击指示器', type: 'select', default: '1', options: [{ value: '0', label: '关闭' }, { value: '1', label: '准星' }, { value: '2', label: '快捷栏' }] },
  { key: 'autoJump', label: '自动跳跃', type: 'switch', default: 'false' },
  { key: 'toggleCrouch', label: '切换潜行', type: 'switch', default: 'false' },
  { key: 'toggleSprint', label: '切换疾跑', type: 'switch', default: 'false' },
  { key: 'backgroundForChatOnly', label: '仅聊天时显示背景', type: 'switch', default: 'true' }
]

const SKIN_PARTS: [string, string][] = [
  ['modelPart_hat', '帽子'],
  ['modelPart_jacket', '外套'],
  ['modelPart_left_sleeve', '左袖'],
  ['modelPart_right_sleeve', '右袖'],
  ['modelPart_left_pants_leg', '左裤腿'],
  ['modelPart_right_pants_leg', '右裤腿'],
  ['modelPart_cape', '披风']
]

const INTERFACE_EXTRA: Field[] = SKIN_PARTS.map(([key, label]) => ({
  key,
  label: `显示${label}`,
  type: 'switch',
  default: 'true'
}))

const ALL = [...VIDEO, ...SOUND, ...CONTROLS, ...INTERFACE, ...INTERFACE_EXTRA]
const FIELD_MAP = new Map(ALL.map((field) => [field.key, field]))

function displayValue(value: string): string {
  if (value.startsWith('key.keyboard.')) return value.slice('key.keyboard.'.length).replace(/\./g, ' ')
  if (value.startsWith('key.mouse.')) return `鼠标 ${value.slice('key.mouse.'.length)}`
  return value
}

function mapKeyCode(code: string): string | null {
  const lower = code.toLowerCase()
  if (/^key[a-z]$/.test(lower)) return `key.keyboard.${lower.slice(3)}`
  if (/^digit[0-9]$/.test(lower)) return `key.keyboard.${lower.slice(5)}`
  if (/^numpad[0-9]$/.test(lower)) return `key.keyboard.keypad.${lower.slice(6)}`
  if (/^f([1-9]|1[0-2])$/.test(lower)) return `key.keyboard.${lower}`
  const map: Record<string, string> = {
    space: 'space',
    enter: 'enter',
    escape: 'escape',
    tab: 'tab',
    backspace: 'backspace',
    delete: 'delete',
    insert: 'insert',
    home: 'home',
    end: 'end',
    pageup: 'page.up',
    pagedown: 'page.down',
    arrowup: 'up',
    arrowdown: 'down',
    arrowleft: 'left',
    arrowright: 'right',
    shiftleft: 'left.shift',
    shiftright: 'right.shift',
    controlleft: 'left.control',
    controlright: 'right.control',
    altleft: 'left.alt',
    altright: 'right.alt',
    metaleft: 'left.meta',
    metaright: 'right.meta',
    caplock: 'caps.lock',
    semicolon: 'semicolon',
    quote: 'apostrophe',
    comma: 'comma',
    period: 'period',
    slash: 'slash',
    backslash: 'backslash',
    bracketleft: 'left.bracket',
    bracketright: 'right.bracket',
    minus: 'minus',
    equal: 'equal',
    backquote: 'grave'
  }
  return map[lower] ? `key.keyboard.${map[lower]}` : null
}

function KeyCapture({ value, onChange }: { value: string; onChange: (value: string) => void }): React.JSX.Element {
  const [capturing, setCapturing] = useState(false)
  useEffect(() => {
    if (!capturing) return
    const key = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()
      if (event.code === 'Escape') {
        setCapturing(false)
        return
      }
      const mapped = mapKeyCode(event.code)
      if (mapped) {
        onChange(mapped)
        setCapturing(false)
      }
    }
    const mouse = (event: MouseEvent) => {
      event.preventDefault()
      event.stopPropagation()
      const button = event.button === 0 ? 'left' : event.button === 1 ? 'middle' : event.button === 2 ? 'right' : String(event.button + 1)
      onChange(`key.mouse.${button}`)
      setCapturing(false)
    }
    window.addEventListener('keydown', key, true)
    window.addEventListener('mousedown', mouse, true)
    return () => {
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('mousedown', mouse, true)
    }
  }, [capturing, onChange])
  return (
    <button type="button" className={classNames('game-key', capturing && 'is-capturing')} onClick={() => setCapturing((v) => !v)}>
      {capturing ? '按下按键或鼠标…' : displayValue(value)}
    </button>
  )
}

function FieldRow({
  field,
  values,
  setValue,
  clear
}: {
  field: Field
  values: Record<string, string>
  setValue: (key: string, value: string) => void
  clear: (key: string) => void
}): React.JSX.Element {
  const current = values[field.key] ?? field.default
  const shown = field.display ? field.display(current) : current
  return (
    <div className={classNames('game-field', values[field.key] !== undefined && 'is-set')}>
      <div className="game-field-copy">
        <span className="game-field-label">{field.label}</span>
        <em>{field.hint ?? field.key}</em>
      </div>
      <div className="game-field-control">
        {field.type === 'range' ? (
          <div className="game-range">
            <input
              type="range"
              min={field.min}
              max={field.max}
              step={field.step}
              value={Number(current)}
              onChange={(event) => setValue(field.key, event.target.value)}
            />
            <strong>{shown}</strong>
          </div>
        ) : field.type === 'switch' ? (
          <Switch checked={current === 'true'} onChange={(checked) => setValue(field.key, String(checked))} label={field.label} />
        ) : field.type === 'select' ? (
          <SelectMenu
            value={current}
            options={(field.options ?? []).map((option) => ({ value: option.value, label: option.label }))}
            onChange={(next) => setValue(field.key, next)}
            placeholder="选择"
            className="game-select-menu"
          />
        ) : field.type === 'key' ? (
          <KeyCapture value={current} onChange={(value) => setValue(field.key, value)} />
        ) : (
          <input className="text-input" value={current} onChange={(event) => setValue(field.key, event.target.value)} />
        )}
        {values[field.key] !== undefined ? (
          <button type="button" className="game-clear" onClick={() => clear(field.key)} aria-label={`清除 ${field.label}`}>
            <RotateCcw size={13} />
          </button>
        ) : null}
      </div>
    </div>
  )
}

export default function GameSettingsPage(): React.JSX.Element {
  const { config, instances, activeInstance, reload, pushToast } = useApp()
  const [values, setValues] = useState<Record<string, string>>({})
  const [tab, setTab] = useState<Category>('video')
  const [applyOpen, setApplyOpen] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [rawKey, setRawKey] = useState('')
  const [rawValue, setRawValue] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setValues(config?.gameOptions ?? {})
  }, [config?.gameOptions])

  const count = Object.keys(values).length
  const dirty = useMemo(
    () => JSON.stringify(values) !== JSON.stringify(config?.gameOptions ?? {}),
    [config?.gameOptions, values]
  )

  const setValue = (key: string, value: string) => setValues((prev) => ({ ...prev, [key]: value }))
  const clear = (key: string) =>
    setValues((prev) => {
      const next = { ...prev }
      delete next[key]
      return next
    })

  const save = async (silent = false): Promise<boolean> => {
    if (busy) return false
    setBusy(true)
    try {
      await window.ember.gameSettings.update(values)
      await reload(true)
      if (!silent) pushToast({ tone: 'success', title: '游戏设置模板已保存', message: '不会修改已有版本；新下载或新加载的版本会自动应用。' })
      return true
    } catch (err) {
      pushToast({ tone: 'error', title: '保存失败', message: err instanceof Error ? err.message : String(err) })
      return false
    } finally {
      setBusy(false)
    }
  }

  const openApply = () => {
    setSelected(new Set(activeInstance ? [activeInstance.id] : []))
    setApplyOpen(true)
  }

  const apply = async () => {
    if (!selected.size) {
      pushToast({ tone: 'warning', title: '请选择至少一个版本' })
      return
    }
    if (!(await save(true))) return
    setBusy(true)
    try {
      const result = await window.ember.gameSettings.apply([...selected])
      await reload(true)
      setApplyOpen(false)
      pushToast({
        tone: result.failed.length ? 'warning' : 'success',
        title: `已应用到 ${result.applied} 个版本`,
        message: result.failed.length ? `${result.failed.length} 个失败：${result.failed[0].error}` : '已备份原 options.txt，只覆盖模板中的键。'
      })
    } catch (err) {
      pushToast({ tone: 'error', title: '应用失败', message: err instanceof Error ? err.message : String(err) })
    } finally {
      setBusy(false)
    }
  }

  const fields = tab === 'video' ? VIDEO : tab === 'sound' ? SOUND : tab === 'controls' ? CONTROLS : [...INTERFACE, ...INTERFACE_EXTRA]
  const customKeys = Object.keys(values).filter((key) => !FIELD_MAP.has(key))

  return (
    <div className="page game-settings-page">
      <Background />
      <div className="page-head">
        <div>
          <h1>游戏设置</h1>
          <p>统一模板。保存不会修改已有版本；新下载、新加载的游戏会自动套用。</p>
        </div>
        <div className="page-head-actions">
          <Pill tone={count ? 'accent' : 'default'}>{count} 项覆盖</Pill>
          <Button variant="secondary" icon={Layers} onClick={openApply} disabled={!instances.length || !count}>
            应用到已有版本
          </Button>
          <Button variant="primary" icon={Save} loading={busy} disabled={!dirty} onClick={() => void save()}>
            保存模板
          </Button>
        </div>
      </div>

      <div className="game-notice">
        <Layers size={15} />
        <p>
          当前模板只会影响<strong>新建实例</strong>和<strong>新加载的已有游戏</strong>。想修改已存在的版本，请点击「应用到已有版本」；应用前会备份原 <code>options.txt</code>。未修改的数值只是默认值，不会写入模板。
        </p>
      </div>

      <div className="game-tabs">
        {([
          ['video', '画面', Monitor],
          ['sound', '声音', Volume2],
          ['controls', '控制', Keyboard],
          ['interface', '界面与聊天', MessageSquare],
          ['raw', '原始选项', Gamepad2]
        ] as [Category, string, typeof Monitor][]).map(([id, label, Icon]) => (
          <button key={id} type="button" className={classNames(tab === id && 'is-active')} onClick={() => setTab(id)}>
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>

      {tab !== 'raw' ? (
        <motion.div key={tab} className="game-grid" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
          {fields.map((field) => (
            <FieldRow key={field.key} field={field} values={values} setValue={setValue} clear={clear} />
          ))}
        </motion.div>
      ) : (
        <div className="game-raw">
          <div className="game-raw-add">
            <input className="text-input mono" placeholder="键名，例如 fov 或 key_key.forward" value={rawKey} onChange={(event) => setRawKey(event.target.value)} />
            <input className="text-input mono" placeholder="值" value={rawValue} onChange={(event) => setRawValue(event.target.value)} />
            <Button
              variant="secondary"
              icon={Plus}
              onClick={() => {
                if (!rawKey.trim()) return
                setValue(rawKey.trim(), rawValue)
                setRawKey('')
                setRawValue('')
              }}
            >
              添加
            </Button>
          </div>
          <div className="game-raw-list">
            {Object.keys(values).length ? (
              Object.entries(values).map(([key, value]) => (
                <div key={key} className="game-raw-row">
                  <code>{key}</code>
                  <span>{value}</span>
                  <button type="button" onClick={() => clear(key)} aria-label={`删除 ${key}`}>
                    <Trash2 size={13} />
                  </button>
                </div>
              ))
            ) : (
              <p className="game-raw-empty">还没有覆盖项。所有未设置的键会保留游戏原有值。</p>
            )}
          </div>
          {customKeys.length ? <p className="game-raw-hint">原始键会直接写入 options.txt；请确认键名与游戏版本匹配。</p> : null}
        </div>
      )}

      <div className="game-actions">
        <Button
          variant="ghost"
          icon={RotateCcw}
          onClick={() => setValues({})}
          disabled={!Object.keys(values).length}
        >
          清空模板
        </Button>
        <span>清空后不会自动改回已有版本；仅影响之后的新版本。</span>
      </div>

      <Modal open={applyOpen} onClose={() => !busy && setApplyOpen(false)} size="md" className="game-apply-modal" labelledBy="game-apply-title">
        <ModalHeader
          eyebrow="应用到已有版本"
          title="选择要修改的版本"
          description="会合并模板键到每个版本的 options.txt，并先备份原文件。PCL 版本的 options.txt 也会被修改。"
          onClose={() => !busy && setApplyOpen(false)}
          id="game-apply-title"
        />
        <div className="game-apply-tools">
          <button type="button" onClick={() => setSelected(new Set(instances.map((item) => item.id)))}>全选</button>
          <button type="button" onClick={() => setSelected(new Set())}>清空</button>
          <span>{selected.size} / {instances.length}</span>
        </div>
        <div className="game-apply-list">
          {instances.map((instance) => (
            <button
              key={instance.id}
              type="button"
              className={classNames('game-apply-row', selected.has(instance.id) && 'is-selected')}
              onClick={() =>
                setSelected((prev) => {
                  const next = new Set(prev)
                  if (next.has(instance.id)) next.delete(instance.id)
                  else next.add(instance.id)
                  return next
                })
              }
            >
              <span className="ui-check">{selected.has(instance.id) ? <Check size={12} strokeWidth={3} /> : null}</span>
              <span className="game-apply-copy">
                <strong>{instance.name}</strong>
                <em>MC {instance.mcVersion} · {instance.loader.type}</em>
                <code>{instance.gameDir}/options.txt</code>
              </span>
              {instance.id === activeInstance?.id ? <Pill tone="default">当前</Pill> : null}
            </button>
          ))}
        </div>
        <div className="modal-foot">
          <Button variant="ghost" icon={X} onClick={() => setApplyOpen(false)} disabled={busy}>取消</Button>
          <Button variant="primary" icon={Layers} loading={busy} onClick={() => void apply()}>
            应用到 {selected.size} 个版本
          </Button>
        </div>
      </Modal>
    </div>
  )
}
