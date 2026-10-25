import React, { useEffect, useState } from 'react'
import { Command, Copy, Maximize2, Minus, Monitor, Moon, Search, Sun, X } from 'lucide-react'
import { useApp } from '../store'
import { IconButton, Kbd } from './ui'
import logo from '../assets/logo.png'

export default function TitleBar(): React.JSX.Element {
  const { themeMode, setTheme, setCommandOpen, navigate } = useApp()
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    void window.ember.app.isMaximized().then(setMaximized)
    return window.ember.app.onMaximizeChange(setMaximized)
  }, [])

  return (
    <header className="titlebar">
      <div
        className="titlebar-drag"
        onDoubleClick={(event) => {
          if ((event.target as HTMLElement).closest('button')) return
          window.ember.app.toggleMaximize()
        }}
      >
        <button className="brand" onClick={() => navigate('/')} type="button">
          <span className="brand-mark">
            <img src={logo} alt="" draggable={false} />
            <i />
          </span>
          <span className="brand-words">
            <strong>ELYTRA</strong>
            <em>Minecraft 启动器</em>
          </span>
        </button>

        <button className="command-bar" onClick={() => setCommandOpen(true)} type="button">
          <Search size={14} />
          <span>搜索实例、页面或命令</span>
          <Kbd>
            <Command size={10} /> K
          </Kbd>
        </button>
      </div>

      <div className="titlebar-actions">
        <div className="theme-switch" role="group" aria-label="主题">
          <button
            type="button"
            className={themeMode === 'light' ? 'is-active' : ''}
            onClick={() => setTheme('light')}
            aria-label="浅色模式"
            data-tip="浅色"
          >
            <Sun size={14} />
          </button>
          <button
            type="button"
            className={themeMode === 'dark' ? 'is-active' : ''}
            onClick={() => setTheme('dark')}
            aria-label="深色模式"
            data-tip="深色"
          >
            <Moon size={14} />
          </button>
          <button
            type="button"
            className={themeMode === 'system' ? 'is-active' : ''}
            onClick={() => setTheme('system')}
            aria-label="跟随系统"
            data-tip="跟随系统"
          >
            <Monitor size={14} />
          </button>
        </div>

        <span className="titlebar-sep" />

        <div className="window-controls">
          <IconButton icon={Minus} label="最小化" onClick={() => window.ember.app.minimize()} />
          <IconButton
            icon={maximized ? Copy : Maximize2}
            label={maximized ? '还原' : '最大化'}
            onClick={() => window.ember.app.toggleMaximize()}
            className={maximized ? 'is-maximized' : ''}
          />
          <IconButton icon={X} label="关闭" className="window-close" onClick={() => window.ember.app.close()} />
        </div>
      </div>
    </header>
  )
}
