import React, { useMemo } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowRight,
  FolderOpen,
  LogIn,
  Play,
  Plus,
  Settings2,
  Puzzle
} from 'lucide-react'
import { ACCENTS, LOADER_META, relativeTime } from '@shared/utils'
import { useApp } from '../store'
import { Button, classNames, Pill } from '../components/ui'
import AnimatedNumber from '../components/AnimatedNumber'
import Background from '../components/Background'

function loaderName(type: keyof typeof LOADER_META): string {
  return type === 'vanilla' ? '原版' : LOADER_META[type].label
}

export default function Home(): React.JSX.Element {
  const {
    activeInstance,
    instances,
    activeAccount,
    system,
    boot,
    launch,
    startLaunch,
    stopLaunch,
    navigate,
    setCreateOpen,
    setImportOpen,
    setAccountOpen,
    selectInstance
  } = useApp()

  const accent = ACCENTS.find((item) => item.key === activeInstance?.accent) ?? ACCENTS[0]
  const live = launch.instanceId === activeInstance?.id && ['launching', 'running'].includes(launch.status)
  const accountName = activeAccount?.name ?? '未登录'

  const sortedInstances = useMemo(
    () => [...instances].sort((a, b) => (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0)),
    [instances]
  )

  if (!activeInstance) {
    return (
      <div className="page home-page">
        <Background />
        <header className="home-head">
          <div>
            <h1>实例</h1>
            <p>选择一个世界开始游戏。</p>
          </div>
          <div className="home-head-actions">
            <Button variant="ghost" icon={FolderOpen} onClick={() => setImportOpen(true)}>
              加载已有游戏
            </Button>
            <Button variant="primary" icon={Plus} onClick={() => setCreateOpen(true)}>
              新建实例
            </Button>
          </div>
        </header>

        <section className="home-empty-simple">
          <span className="home-empty-mark">+</span>
          <h2>还没有实例</h2>
          <p>新建一个版本开始安装，或者加载已经下载好的游戏目录。</p>
          <div className="home-empty-actions">
            <Button variant="primary" icon={Plus} onClick={() => setCreateOpen(true)}>
              新建实例
            </Button>
            <Button variant="secondary" icon={FolderOpen} onClick={() => setImportOpen(true)}>
              加载已有游戏
            </Button>
            <Button variant="ghost" icon={LogIn} onClick={() => setAccountOpen(true)}>
              登录账户
            </Button>
          </div>
        </section>

        <footer className="home-footline">
          <span>ELYTRA</span>
          <span>v{boot?.version ?? '1.3.2'}</span>
          <span>{system?.platform ?? 'win32'} · {system?.arch ?? 'x64'}</span>
        </footer>
      </div>
    )
  }

  return (
    <div className="page home-page">
      <Background />

      <header className="home-head">
        <div>
          <h1>实例</h1>
          <p>选择一个世界开始游戏。</p>
        </div>
        <div className="home-head-actions">
          <button type="button" className="account-chip" onClick={() => setAccountOpen(true)}>
            <span className={classNames('account-chip-dot', activeAccount?.online ? 'is-online' : activeAccount ? 'is-offline' : 'is-none')} />
            <span>{accountName}</span>
          </button>
          <Button variant="ghost" icon={FolderOpen} onClick={() => setImportOpen(true)}>
            加载已有游戏
          </Button>
          <Button variant="primary" icon={Plus} onClick={() => setCreateOpen(true)}>
            新建实例
          </Button>
        </div>
      </header>

      <div className="home-grid">
        <aside className="instance-list-panel">
          <div className="panel-head">
            <h2>我的实例</h2>
            <span><AnimatedNumber value={instances.length} /></span>
          </div>

          <div className="instance-rows">
            {sortedInstances.map((instance, index) => {
              const active = instance.id === activeInstance.id
              const instanceAccent = ACCENTS.find((item) => item.key === instance.accent) ?? ACCENTS[0]
              return (
                <button
                  key={instance.id}
                  type="button"
                  className={classNames('instance-row', active && 'is-active')}
                  onClick={() => void selectInstance(instance.id)}
                  style={{ '--row-accent': instanceAccent.from } as React.CSSProperties}
                >
                  {active ? <motion.span className="instance-row-bar" layoutId="instance-row-bar" /> : null}
                  <span className="instance-row-emblem">{instance.emblem || instance.name.slice(0, 1)}</span>
                  <span className="instance-row-copy">
                    <strong>{instance.name}</strong>
                    <em>
                      {instance.mcVersion} · {loaderName(instance.loader.type)}
                      {instance.importedFrom ? ' · 已有目录' : ''}
                    </em>
                  </span>
                  <span className="instance-row-side">
                    <em>{relativeTime(instance.lastPlayedAt)}</em>
                    <i />
                  </span>
                </button>
              )
            })}
          </div>
        </aside>

        <section className="instance-detail" style={{ '--detail-accent': accent.from } as React.CSSProperties}>
          <AnimatePresence mode="wait">
            <motion.div
              key={activeInstance.id}
              className="detail-inner"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.22 }}
            >
              <div className="detail-head">
                <span className="detail-emblem">{activeInstance.emblem || activeInstance.name.slice(0, 1)}</span>
                <div>
                  <span className="detail-label">
                    {live ? '正在运行' : '当前实例'}
                    {activeInstance.resolvedLaunchMode === 'local' ? <Pill tone="success">本地启动</Pill> : <Pill tone="default">ELYTRA</Pill>}
                    {activeInstance.sourceLauncher === 'pcl' ? <Pill tone="blue">PCL</Pill> : null}
                  </span>
                  <h2>{activeInstance.name}</h2>
                  <p>{activeInstance.description || '一个世界，等待开始。'}</p>
                </div>
                <button
                  type="button"
                  className="icon-btn detail-settings"
                  aria-label="启动设置"
                  onClick={() => navigate({ page: 'instance-settings', instanceId: activeInstance.id })}
                >
                  <Settings2 size={17} />
                </button>
              </div>

              <div className="detail-meta">
                <div>
                  <span>版本</span>
                  <strong>{activeInstance.mcVersion}</strong>
                </div>
                <div>
                  <span>加载器</span>
                  <strong>{loaderName(activeInstance.loader.type)}</strong>
                </div>
                <div>
                  <span>模组</span>
                  <strong>{activeInstance.modCount} 个</strong>
                </div>
                <div>
                  <span>上次游玩</span>
                  <strong>{relativeTime(activeInstance.lastPlayedAt)}</strong>
                </div>
              </div>

              <button type="button" className={classNames('detail-launch', live && 'is-live')} onClick={() => (live ? void stopLaunch() : void startLaunch())} title={live ? '点击停止游戏' : '启动游戏'}>
                <span className="detail-launch-icon">
                  {live ? <span className="live-bars"><i /><i /><i /></span> : <Play size={20} fill="currentColor" />}
                </span>
                <span>
                  <strong>{live ? (launch.status === 'running' ? '游戏运行中' : '正在启动') : '启动游戏'}</strong>
                  <em>{live ? `${Math.round(launch.progress)}% · 点击停止` : `${activeInstance.effective.memoryMax} MB 内存`}</em>
                </span>
                <ArrowRight size={18} />
              </button>

              <div className="detail-actions">
                <Button variant="secondary" icon={Settings2} onClick={() => navigate({ page: 'instance-settings', instanceId: activeInstance.id })}>
                  启动设置
                </Button>
                <Button variant="ghost" icon={Puzzle} onClick={() => navigate('/mods')}>
                  管理模组
                </Button>
                <Button variant="ghost" icon={FolderOpen} onClick={() => void window.ember.instances.openDir(activeInstance.id)}>
                  打开目录
                </Button>
              </div>

              <div className="detail-foot">
                <span className="detail-path" title={activeInstance.gameDir}>
                  {activeInstance.gameDir}
                </span>
                <button type="button" onClick={() => setAccountOpen(true)}>
                  {activeAccount ? `${activeAccount.name} · ${activeAccount.online ? '在线' : '离线'}` : '登录账户'}
                </button>
              </div>

              {live ? (
                <div className="detail-progress">
                  <span style={{ width: `${Math.max(3, launch.progress)}%` }} />
                </div>
              ) : null}
            </motion.div>
          </AnimatePresence>
        </section>
      </div>

      <footer className="home-footline">
        <span>ELYTRA · EML</span>
        <span>v{boot?.version ?? '1.3.2'}</span>
        <span>{system?.platform ?? 'win32'} · {system?.arch ?? 'x64'}</span>
      </footer>
    </div>
  )
}
