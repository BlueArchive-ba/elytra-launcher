import React from 'react'
import { motion } from 'framer-motion'
import { Activity, Compass, Gamepad2, Home, PackageOpen, Puzzle, Settings2, UserRound } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useApp } from '../store'
import type { Page } from '../store'
import { classNames } from './ui'

const items: { page: Page; label: string; icon: LucideIcon }[] = [
  { page: 'home', label: '主页', icon: Home },
  { page: 'skin', label: '皮肤', icon: UserRound },
  { page: 'mods', label: '模组', icon: Puzzle },
  { page: 'crash', label: '崩溃', icon: Activity },
  { page: 'modpack', label: '整合包', icon: PackageOpen },
  { page: 'discover', label: '资源', icon: Compass },
  { page: 'game', label: '游戏', icon: Gamepad2 },
  { page: 'settings', label: '设置', icon: Settings2 }
]

function accountInitial(name?: string): string {
  return (name || '?').slice(0, 1).toUpperCase()
}

export default function Rail(): React.JSX.Element {
  const { route, navigate, activeAccount, setAccountOpen, launch, activeInstance, modUpdates } = useApp()

  return (
    <aside className="rail">
      <div className="rail-top">
        <div className="rail-status" data-tip={launch.status === 'running' ? '游戏运行中' : 'ELYTRA 在线'}>
          <span className={classNames('status-pulse', launch.status === 'running' && 'is-running')} />
        </div>
      </div>

      <nav className="rail-nav" aria-label="主导航">
        {items.map((item) => {
          const Icon = item.icon
          const active =
            route.page === item.page ||
            (item.page === 'settings' && route.page === 'instance-settings')
          return (
            <button
              key={item.page}
              type="button"
              className={classNames('rail-item', active && 'is-active')}
              onClick={() => navigate(item.page === 'home' ? '/' : `/${item.page}`)}
              data-tip={item.page === 'mods' && modUpdates.length ? `模组 · ${modUpdates.length} 个更新` : item.label}
              aria-label={item.label}
            >
              {active ? <motion.span layoutId="rail-glider" className="rail-glider" transition={{ type: 'spring', stiffness: 420, damping: 34 }} /> : null}
              <span className="rail-icon">
                <Icon size={20} strokeWidth={active ? 2.1 : 1.7} />
                {item.page === 'mods' && modUpdates.length ? <i className="rail-update-dot" /> : null}
              </span>
              <em>{item.label}</em>
            </button>
          )
        })}
      </nav>

      <div className="rail-bottom">
        {activeInstance ? (
          <button
            type="button"
            className={classNames('rail-instance', launch.status === 'running' && 'is-live')}
            onClick={() => navigate('/')}
            data-tip={`${activeInstance.name} · MC ${activeInstance.mcVersion}`}
          >
            <span>{activeInstance.emblem || activeInstance.name.slice(0, 1)}</span>
            <i />
          </button>
        ) : null}
        <button
          type="button"
          className="rail-account"
          onClick={() => setAccountOpen(true)}
          data-tip={activeAccount ? `${activeAccount.name} · ${activeAccount.online ? '在线' : '离线'}` : '未登录 · 点击登录'}
        >
          <span className={classNames('account-avatar', activeAccount?.online ? 'is-online' : 'is-offline')}>
            {activeAccount ? accountInitial(activeAccount.name) : <UserRound size={18} />}
          </span>
          <i className={classNames('account-dot', activeAccount?.online ? 'is-online' : activeAccount ? 'is-offline' : 'is-none')} />
        </button>
      </div>
    </aside>
  )
}
