import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  ArrowRight,
  Compass,
  FolderOpen,
  Gamepad2,
  Home,
  Moon,
  Monitor,
  PackageOpen,
  Play,
  Plus,
  Puzzle,
  Search,
  Settings2,
  Sun,
  UserRound
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useApp } from '../store'
import { Kbd, Modal } from './ui'

interface CommandItem {
  id: string
  label: string
  hint: string
  icon: LucideIcon
  group: string
  run: () => void
}

export default function CommandPalette(): React.JSX.Element {
  const {
    commandOpen,
    setCommandOpen,
    navigate,
    activeInstance,
    setCreateOpen,
    setImportOpen,
    setAccountOpen,
    setTheme,
    startLaunch,
    instances,
    selectInstance
  } = useApp()
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (commandOpen) {
      setQuery('')
      setSelected(0)
      window.setTimeout(() => inputRef.current?.focus(), 80)
    }
  }, [commandOpen])

  const commands = useMemo<CommandItem[]>(() => {
    const list: CommandItem[] = [
      { id: 'home', label: '回到主页', hint: 'HOME', icon: Home, group: '导航', run: () => navigate('/') },
      { id: 'skin', label: '打开皮肤工坊', hint: 'SKIN', icon: UserRound, group: '导航', run: () => navigate('/skin') },
      { id: 'mods', label: '管理本地 Mod', hint: 'MODS', icon: Puzzle, group: '导航', run: () => navigate('/mods') },
      { id: 'crash', label: '分析崩溃报告', hint: 'CRASH', icon: Activity, group: '导航', run: () => navigate('/crash') },
      { id: 'modpack', label: '导入整合包', hint: 'MODPACK', icon: PackageOpen, group: '导航', run: () => navigate('/modpack') },
      { id: 'discover', label: '浏览 Modrinth 资源', hint: 'DISCOVER', icon: Compass, group: '导航', run: () => navigate('/discover') },
      { id: 'game', label: '统一游戏设置', hint: 'OPTIONS', icon: Gamepad2, group: '导航', run: () => navigate('/game') },
      { id: 'settings', label: '全局设置', hint: 'CONFIG', icon: Settings2, group: '导航', run: () => navigate('/settings') },
      { id: 'create', label: '创建新实例', hint: 'NEW', icon: Plus, group: '动作', run: () => setCreateOpen(true) },
      { id: 'import', label: '加载已有游戏', hint: 'LOCAL', icon: FolderOpen, group: '动作', run: () => setImportOpen(true) },
      { id: 'account', label: '切换账户', hint: 'ACCOUNT', icon: UserRound, group: '动作', run: () => setAccountOpen(true) },
      {
        id: 'launch',
        label: `启动 ${activeInstance?.name ?? '当前实例'}`,
        hint: 'LAUNCH',
        icon: Play,
        group: '动作',
        run: () => void startLaunch()
      },
      { id: 'theme-dark', label: '切换到长夜主题', hint: 'DARK', icon: Moon, group: '外观', run: () => setTheme('dark') },
      { id: 'theme-light', label: '切换到白昼主题', hint: 'LIGHT', icon: Sun, group: '外观', run: () => setTheme('light') },
      { id: 'theme-system', label: '跟随系统主题', hint: 'SYSTEM', icon: Monitor, group: '外观', run: () => setTheme('system') }
    ]
    for (const instance of instances.slice(0, 6)) {
      list.push({
        id: `instance-${instance.id}`,
        label: `切换至 ${instance.name}`,
        hint: `MC ${instance.mcVersion}`,
        icon: ArrowRight,
        group: '实例',
        run: () => {
          void selectInstance(instance.id)
          void startLaunch(instance.id)
        }
      })
    }
    return list
  }, [activeInstance?.name, instances, navigate, setAccountOpen, setCreateOpen, setImportOpen, setTheme, selectInstance, startLaunch])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return commands
    return commands.filter((command) => `${command.label} ${command.hint} ${command.group}`.toLowerCase().includes(q))
  }, [commands, query])

  useEffect(() => {
    setSelected(0)
  }, [query])

  const choose = (command: CommandItem) => {
    command.run()
    setCommandOpen(false)
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setSelected((v) => Math.min(filtered.length - 1, v + 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setSelected((v) => Math.max(0, v - 1))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const command = filtered[selected]
      if (command) choose(command)
    }
  }

  let lastGroup = ''

  return (
    <Modal open={commandOpen} onClose={() => setCommandOpen(false)} size="sm" className="command-modal" labelledBy="command-title">
      <div className="command-head">
        <Search size={18} />
        <input
          id="command-title"
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="输入命令、实例或页面…"
          spellCheck={false}
        />
        <Kbd>ESC</Kbd>
      </div>
      <div className="command-list">
        {filtered.length ? (
          filtered.map((command, index) => {
            const Icon = command.icon
            const showGroup = command.group !== lastGroup
            lastGroup = command.group
            return (
              <React.Fragment key={command.id}>
                {showGroup ? <div className="command-group">{command.group}</div> : null}
                <button
                  type="button"
                  className={`command-item ${index === selected ? 'is-selected' : ''}`}
                  onMouseEnter={() => setSelected(index)}
                  onClick={() => choose(command)}
                >
                  <span className="command-icon">
                    <Icon size={16} />
                  </span>
                  <span className="command-label">{command.label}</span>
                  <em>{command.hint}</em>
                  <ArrowRight size={13} />
                </button>
              </React.Fragment>
            )
          })
        ) : (
          <div className="command-empty">没有找到匹配的命令</div>
        )}
      </div>
      <div className="command-foot">
        <span>
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd> 导航
        </span>
        <span>
          <Kbd>↵</Kbd> 执行
        </span>
        <span className="command-brand">ELYTRA COMMAND</span>
      </div>
    </Modal>
  )
}
