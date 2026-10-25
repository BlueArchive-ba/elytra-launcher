import React, { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, MotionConfig } from 'framer-motion'
import { AlertTriangle, ArrowRight, RotateCw, Square } from 'lucide-react'
import { useApp, AppProvider } from './store'
import TitleBar from './components/TitleBar'
import Rail from './components/Rail'
import Background from './components/Background'
import Toasts from './components/Toasts'
import ModUpdateNotice from './components/ModUpdateNotice'
import DownloadIndicator from './components/DownloadIndicator'
import LaunchOverlay from './components/LaunchOverlay'
import AccountDrawer from './components/AccountDrawer'
import CreateInstanceModal from './components/CreateInstanceModal'
import ImportGameModal from './components/ImportGameModal'
import CommandPalette from './components/CommandPalette'
import PageBoundary from './components/PageBoundary'
import GameUpdateBanner from './components/GameUpdateBanner'
import LauncherUpdateBanner from './components/LauncherUpdateBanner'
import Home from './pages/Home'
import InstanceSettingsPage from './pages/InstanceSettings'
import SkinPage from './pages/SkinPage'
import ModsPage from './pages/ModsPage'
import CrashPage from './pages/CrashPage'
import ModpackPage from './pages/ModpackPage'
import DiscoverPage from './pages/DiscoverPage'
import GameSettingsPage from './pages/GameSettingsPage'
import GlobalSettingsPage from './pages/GlobalSettings'
import { Button, classNames, Pill, ProgressRing } from './components/ui'
import { ACCENTS } from '@shared/utils'
import logo from './assets/logo.png'

function SplashScreen({ done }: { done: boolean }): React.JSX.Element {
  const { system } = useApp()
  const [phase, setPhase] = useState(0)
  useEffect(() => {
    const timers = [
      window.setTimeout(() => setPhase(1), 260),
      window.setTimeout(() => setPhase(2), 720),
      window.setTimeout(() => setPhase(3), 1180)
    ]
    return () => timers.forEach(window.clearTimeout)
  }, [])
  return (
    <motion.div
      className="splash"
      initial={{ opacity: 1 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.22, ease: [0.22, 0.8, 0.2, 1] }}
    >
      <motion.div className="splash-curtain left" animate={{ x: done ? '-101%' : '0%' }} transition={{ duration: 0.46, ease: [0.76, 0, 0.24, 1] }} />
      <motion.div className="splash-curtain right" animate={{ x: done ? '101%' : '0%' }} transition={{ duration: 0.46, ease: [0.76, 0, 0.24, 1] }} />
      <motion.div className="splash-decor" animate={{ opacity: done ? 0 : 1 }} transition={{ duration: 0.2 }}>
        <div className="splash-grid" />
        <div className="splash-glow" />
        <div className="splash-beam" />
        <div className="splash-frame"><i /><i /><i /><i /></div>
      </motion.div>
      <div className="splash-rail left">MINECRAFT / LAUNCHER</div>
      <div className="splash-rail right">ELYTRA // {system?.appVersion ?? '1.2.3'}</div>
      <motion.div className="splash-content" animate={{ opacity: done ? 0 : 1, scale: done ? 1.03 : 1 }} transition={{ duration: 0.2 }}>
        <motion.div className="splash-logo" initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 160, damping: 18 }}>
          <img src={logo} alt="ELYTRA" />
          <span className="splash-logo-ring" />
          <span className="splash-logo-ring second" />
        </motion.div>
        <div className="splash-word">
          <motion.h1 aria-label="ELYTRA">
            {'ELYTRA'.split('').map((letter, index) => (
              <motion.span
                key={`${letter}-${index}`}
                initial={{ y: 22, opacity: 0, rotateX: -40 }}
                animate={{ y: 0, opacity: 1, rotateX: 0 }}
                transition={{ delay: 0.12 + index * 0.045, type: 'spring', stiffness: 240, damping: 22 }}
              >
                {letter}
              </motion.span>
            ))}
          </motion.h1>
          <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }}>
            Minecraft 启动器
          </motion.span>
        </div>
        <div className="splash-status">
          <span className={classNames('splash-dot', phase >= 0 && 'is-on')} />
          {phase < 1 ? '正在读取配置' : phase < 2 ? '正在读取实例' : phase < 3 ? '正在连接 EML' : '准备完成'}
        </div>
        <div className="splash-progress">
          <motion.span initial={{ width: '4%' }} animate={{ width: done ? '100%' : phase >= 3 ? '92%' : phase >= 2 ? '68%' : phase >= 1 ? '36%' : '8%' }} transition={{ duration: 0.65, ease: [0.2, 0.8, 0.2, 1] }} />
        </div>
        <div className="splash-foot">
          <span>ELYTRA</span>
          <em>v{system?.appVersion ?? '1.2.3'}</em>
        </div>
      </motion.div>
    </motion.div>
  )
}

function LaunchDock(): React.JSX.Element | null {
  const { launch, launchOpen, openLaunch } = useApp()
  const active = ['launching', 'running'].includes(launch.status)
  if (!active || launchOpen) return null
  return (
    <motion.button
      className="launch-dock"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      onClick={openLaunch}
      type="button"
    >
      <ProgressRing value={launch.progress} size={42} stroke={3} tone={launch.status === 'running' ? 'success' : 'accent'}>
        <span className="dock-percent">{Math.round(launch.progress)}</span>
      </ProgressRing>
      <span className="launch-dock-copy">
        <em>{launch.status === 'running' ? '游戏运行中' : '正在启动'}</em>
        <strong>{launch.instanceName ?? 'Minecraft'}</strong>
      </span>
      <ArrowRight size={15} />
    </motion.button>
  )
}

function PageRouter(): React.JSX.Element {
  const { route } = useApp()
  switch (route.page) {
    case 'skin':
      return <SkinPage />
    case 'mods':
      return <ModsPage />
    case 'crash':
      return <CrashPage />
    case 'modpack':
      return <ModpackPage />
    case 'discover':
      return <DiscoverPage />
    case 'game':
      return <GameSettingsPage />
    case 'settings':
      return <GlobalSettingsPage />
    case 'instance-settings':
      return <InstanceSettingsPage />
    default:
      return <Home />
  }
}

function Shell(): React.JSX.Element {
  const { loading, error, boot, route, reload, launch, launchOpen, stopLaunch, personalization } = useApp()
  const [splashMinElapsed, setSplashMinElapsed] = useState(false)
  const [splashGone, setSplashGone] = useState(false)
  const timersRef = useRef<number[]>([])

  useEffect(() => {
    const root = document.documentElement
    const accent = ACCENTS.find((item) => item.key === personalization.accent) ?? ACCENTS[0]
    root.style.setProperty('--accent', accent.from)
    root.style.setProperty('--accent-2', accent.to)
    root.style.setProperty('--accent-glow', accent.glow)
    root.style.setProperty('--accent-soft', `color-mix(in srgb, ${accent.from} 14%, transparent)`)
    root.style.setProperty('--accent-line', `color-mix(in srgb, ${accent.from} 34%, transparent)`)
    root.dataset.ambient = personalization.ambient
    root.dataset.motion = personalization.motion ? 'on' : 'off'
  }, [personalization.accent, personalization.ambient, personalization.motion])

  useEffect(() => {
    const timer = window.setTimeout(() => setSplashMinElapsed(true), 1050)
    timersRef.current.push(timer)
    return () => timersRef.current.forEach(window.clearTimeout)
  }, [])

  useEffect(() => {
    if (!splashGone) return
    const timer = window.setTimeout(() => {
      document.querySelector('.content-scroll')?.scrollTo({ top: 0, behavior: 'auto' })
    }, 60)
    return () => window.clearTimeout(timer)
  }, [splashGone])

  useEffect(() => {
    if (boot && splashMinElapsed && !splashGone) {
      const timer = window.setTimeout(() => setSplashGone(true), 460)
      return () => window.clearTimeout(timer)
    }
  }, [boot, splashGone, splashMinElapsed])

  const bootReady = !!boot
  const showSplash = !splashGone

  if (error && !boot) {
    return (
      <div className="fatal-screen">
        <Background />
        <div className="fatal-card">
          <span className="fatal-icon"><AlertTriangle size={28} /></span>
          <span className="eyebrow">启动失败</span>
          <h1>启动器没有成功唤醒</h1>
          <p>{error}</p>
          <Button variant="primary" icon={RotateCw} onClick={() => void reload()}>
            重试
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <TitleBar />
      <Rail />
      <main className="content-scroll">
        <div className="game-update-banners">
          <GameUpdateBanner />
          <LauncherUpdateBanner />
        </div>
        <motion.div
          key={`${route.page}-${route.instanceId ?? ''}`}
          className="route-frame"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, ease: [0.22, 0.8, 0.2, 1] }}
        >
          <PageBoundary key={`${route.page}-${route.instanceId ?? ''}`}>
            <PageRouter />
          </PageBoundary>
        </motion.div>
      </main>

      <LaunchDock />
      <LaunchOverlay />
      <AccountDrawer />
      <CreateInstanceModal />
      <ImportGameModal />
      <CommandPalette />
      <Toasts />
      <DownloadIndicator />
      <ModUpdateNotice />

      <AnimatePresence>{showSplash ? <SplashScreen done={bootReady && splashMinElapsed} key="splash" /> : null}</AnimatePresence>

      {launch.status === 'running' && !launchOpen ? (
        <button type="button" className="runtime-ribbon" onClick={() => void stopLaunch()} title="停止 Minecraft">
          <span className="status-pulse is-running" />
          游戏运行中
          <em>{launch.instanceName}</em>
          <span className="runtime-stop"><Square size={9} fill="currentColor" /> 停止</span>
        </button>
      ) : null}
    </div>
  )
}

export default function App(): React.JSX.Element {
  return (
    <AppProvider>
      <MotionConfig reducedMotion="user">
        <Shell />
      </MotionConfig>
    </AppProvider>
  )
}
