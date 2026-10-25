import React, { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertTriangle,
  Activity,
  Check,
  ChevronDown,
  Coffee,
  Download,
  Package,
  Play,
  Rocket,
  Square,
  Terminal,
  X,
  Zap
} from 'lucide-react'
import { useApp } from '../store'
import { ACCENTS } from '@shared/utils'
import { Button, classNames, Pill, ProgressRing } from './ui'
import AnimatedNumber from './AnimatedNumber'

const STEPS = [
  { phase: 'preparing', label: '准备实例', hint: 'PREPARE', icon: Rocket },
  { phase: 'download', label: '下载资源', hint: 'DOWNLOAD', icon: Download },
  { phase: 'loader', label: '安装加载器', hint: 'LOADER', icon: Package },
  { phase: 'java', label: '检查 Java', hint: 'RUNTIME', icon: Coffee },
  { phase: 'starting', label: '唤起游戏', hint: 'IGNITE', icon: Zap }
]

const LOCAL_STEPS = [
  { phase: 'preparing', label: '读取本地版本', hint: 'LOCAL', icon: Rocket },
  { phase: 'java', label: '检查 Java 与运行库', hint: 'RUNTIME', icon: Coffee },
  { phase: 'starting', label: '唤起游戏', hint: 'IGNITE', icon: Zap },
  { phase: 'running', label: '游戏运行中', hint: 'RUNNING', icon: Activity }
]

const LOCAL_PHASE_ORDER: Record<string, number> = {
  idle: 0,
  preparing: 0,
  compute: 0,
  download: 0,
  loader: 0,
  extract: 1,
  assets: 1,
  patch: 1,
  java: 1,
  clean: 1,
  starting: 2,
  running: 3,
  success: 3,
  crashed: 3,
  error: 3
}

const PHASE_ORDER: Record<string, number> = {
  idle: 0,
  preparing: 0,
  compute: 0,
  download: 1,
  loader: 2,
  extract: 2,
  assets: 2,
  patch: 2,
  java: 3,
  clean: 3,
  starting: 4,
  running: 5,
  success: 5,
  crashed: 5,
  error: 5
}

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function logTone(line: string): string {
  if (/ERROR|Exception|失败|崩溃/i.test(line)) return 'is-error'
  if (/WARN|警告/i.test(line)) return 'is-warn'
  if (/成功|完成|启动|running|Java/i.test(line)) return 'is-good'
  if (/──/.test(line)) return 'is-phase'
  return ''
}

export default function LaunchOverlay(): React.JSX.Element | null {
  const { launchOpen, launch, cancelLaunch, stopLaunch, dismissLaunch, activeInstance, navigate, startLaunch } = useApp()
  const [showLogs, setShowLogs] = useState(true)
  const [elapsed, setElapsed] = useState(0)
  const logRef = useRef<HTMLDivElement>(null)
  const accent = ACCENTS.find((a) => a.key === activeInstance?.accent) ?? ACCENTS[0]
  const running = launch.status === 'running'
  const crashed = launch.status === 'crashed'
  const failed = launch.status === 'error'
  const success = launch.status === 'success'
  const finished = crashed || failed || success
  const isLocal = launch.launchMode === 'local'
  const steps = isLocal ? LOCAL_STEPS : STEPS
  const activeStep = (isLocal ? LOCAL_PHASE_ORDER[launch.phase] : PHASE_ORDER[launch.phase]) ?? 0
  const percent = Math.round(launch.progress)

  useEffect(() => {
    if (!launchOpen) return
    setShowLogs(true)
    const started = launch.startedAt ?? Date.now()
    setElapsed(Date.now() - started)
    const timer = window.setInterval(() => setElapsed(Date.now() - started), 1000)
    return () => window.clearInterval(timer)
  }, [launchOpen, launch.startedAt])

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [launch.logs.length, showLogs])

  const headline = useMemo(() => {
    if (crashed) return '游戏崩溃了'
    if (failed) return '启动失败'
    if (success) return '游戏已退出'
    if (running) return '游戏运行中'
    if (launch.status === 'idle') return '准备启动'
    return launch.message || '正在启动'
  }, [crashed, failed, launch.message, launch.status, running, success])

  const subline = useMemo(() => {
    if (crashed) return launch.message || 'EMBER 已保存本次日志，可在崩溃分析中定位原因。'
    if (failed) return launch.message
    if (success) return '本次游玩时长已记录。'
    if (running) return 'Minecraft 正在后台运行。你可以收起此面板继续浏览。'
    if (launch.launchMode === 'local') return '正在读取本地版本、运行库与 Java，不会下载或覆盖文件。'
    return launch.detail || 'EML 正在构建启动文件与运行时。'
  }, [crashed, failed, launch.detail, launch.launchMode, launch.message, running, success])

  if (typeof document === 'undefined') return null

  return (
    <AnimatePresence>
      {launchOpen ? (
        <motion.div
          className={classNames('launch-layer', crashed && 'is-crashed', running && 'is-running')}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
        >
          <div className="launch-backdrop" onClick={finished || running ? dismissLaunch : undefined} />
          <div className="launch-rays" />
          <motion.div
            className="launch-sheet"
            initial={{ opacity: 0, y: 40, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 30, scale: 0.985 }}
            transition={{ type: 'spring', stiffness: 220, damping: 28 }}
            style={{ '--instance-a': accent.from, '--instance-b': accent.to, '--instance-glow': accent.glow } as React.CSSProperties}
          >
            <div className="launch-sheet-head">
              <div className="launch-breadcrumb">
                <span className="launch-blink" />
                启动游戏
                <em>/</em>
                {activeInstance?.name ?? launch.instanceName ?? 'EMBER'}
              </div>
              <div className="launch-head-actions">
                {!finished && !running ? (
                  <button type="button" className="launch-cancel" onClick={() => void cancelLaunch()}>
                    取消启动
                  </button>
                ) : null}
                <button type="button" className="launch-close" onClick={dismissLaunch} aria-label="收起启动面板">
                  <X size={17} />
                </button>
              </div>
            </div>

            <div className="launch-main">
              <div className="launch-visual">
                <div className="launch-orbits">
                  <span className="orbit orbit-a" />
                  <span className="orbit orbit-b" />
                  <span className="orbit orbit-c" />
                  <span className="orbit-dot dot-a" />
                  <span className="orbit-dot dot-b" />
                </div>
                <ProgressRing
                  value={finished ? 100 : percent}
                  size={232}
                  stroke={3}
                  tone={crashed || failed ? 'danger' : success || running ? 'success' : 'accent'}
                >
                  <div className="launch-percent">
                    {crashed || failed ? (
                      <AlertTriangle size={42} />
                    ) : success || running ? (
                      <Check size={46} />
                    ) : (
                      <>
                        <strong><AnimatedNumber value={percent} /></strong>
                        <span>%</span>
                      </>
                    )}
                  </div>
                </ProgressRing>
                <div className="launch-version">
                  <span>版本</span>
                  <strong>{activeInstance?.mcVersion ?? '—'}</strong>
                  <em>{activeInstance?.loader.type ?? ''}</em>
                </div>
              </div>

              <div className="launch-copy">
                <div className="launch-status-line">
                  <span className="launch-pulse" />
                  {running ? '游戏运行中' : crashed ? '游戏已退出' : failed ? '启动失败' : success ? '游戏已退出' : '正在启动'}
                  <em>{formatElapsed(elapsed)}</em>
                </div>
                <h1>{headline}</h1>
                <p>{subline}</p>

                {running ? (
                  <div className="launch-live-stats">
                    <div>
                      <span>账户</span>
                      <strong>已登录</strong>
                    </div>
                    <div>
                      <span>内存上限</span>
                      <strong>{activeInstance?.effective.memoryMax ?? '—'} MB</strong>
                    </div>
                    <div>
                      <span>状态</span>
                      <strong>运行中</strong>
                    </div>
                  </div>
                ) : null}

                <div className="launch-steps">
                  {steps.map((step, index) => {
                    const Icon = step.icon
                    const done = activeStep > index || finished || running
                    const active = activeStep === index && !finished && !running
                    return (
                      <div key={step.phase} className={classNames('launch-step', done && 'is-done', active && 'is-active')}>
                        <span className="launch-step-icon">
                          {done ? <Check size={13} /> : <Icon size={14} />}
                        </span>
                        <span className="launch-step-word">
                          <strong>{step.label}</strong>
                          <em>{step.hint}</em>
                        </span>
                        {active ? (
                          <motion.span
                            className="launch-step-bar"
                            initial={{ width: 0 }}
                            animate={{ width: `${Math.max(14, percent - index * 18)}%` }}
                          />
                        ) : null}
                      </div>
                    )
                  })}
                </div>

                <div className="launch-actions">
                  {finished ? (
                    <>
                      {crashed || failed ? (
                        <Button
                          variant="primary"
                          icon={Activity}
                          onClick={() => {
                            dismissLaunch()
                            navigate('/crash')
                          }}
                        >
                          打开崩溃分析
                        </Button>
                      ) : (
                        <Button variant="primary" icon={Play} onClick={dismissLaunch}>
                          返回 ELYTRA
                        </Button>
                      )}
                      {failed ? (
                        <Button variant="secondary" icon={Rocket} onClick={() => void startLaunch()}>
                          重试启动
                        </Button>
                      ) : null}
                      <Button variant="ghost" onClick={dismissLaunch}>
                        关闭面板
                      </Button>
                    </>
                  ) : running ? (
                    <>
                      <Button variant="primary" icon={ChevronDown} onClick={dismissLaunch}>
                        收起面板
                      </Button>
                      <Button variant="danger" icon={Square} onClick={() => void stopLaunch()}>
                        停止游戏
                      </Button>
                      <Button variant="ghost" onClick={() => setShowLogs((v) => !v)}>
                        {showLogs ? '隐藏日志' : '查看日志'}
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button variant="secondary" icon={Terminal} onClick={() => setShowLogs((v) => !v)}>
                        {showLogs ? '收起日志' : '展开日志'}
                      </Button>
                      <Button variant="ghost" icon={ChevronDown} onClick={dismissLaunch}>
                        后台运行
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </div>

            <AnimatePresence initial={false}>
              {showLogs ? (
                <motion.div
                  className="launch-terminal"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.25 }}
                >
                  <div className="terminal-head">
                    <span>
                      <Terminal size={13} /> EML 启动日志
                    </span>
                    <span className="terminal-live">
                      <i /> {finished ? '已结束' : '实时'}
                    </span>
                  </div>
                  <div className="terminal-body" ref={logRef}>
                    {launch.logs.length ? (
                      launch.logs.map((line, index) => (
                        <div key={index} className={classNames('terminal-line', logTone(line))}>
                          <span>{String(index + 1).padStart(3, '0')}</span>
                          <em>{line}</em>
                        </div>
                      ))
                    ) : (
                      <div className="terminal-line is-muted">
                        <span>000</span>
                        <em>等待 EML 输出启动日志…</em>
                      </div>
                    )}
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>

            <div className="launch-foot">
              <Pill tone={running ? 'success' : crashed || failed ? 'danger' : 'accent'} dot>
                {running ? '游戏运行中' : crashed ? '游戏崩溃' : failed ? '启动失败' : success ? '已退出' : '正在启动'}
              </Pill>
              <span className="launch-foot-meta">
                {launch.logFile ? `日志 · ${launch.logFile.split(/[\\/]/).pop()}` : 'ELYTRA · EML'}
              </span>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
