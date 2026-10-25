import React, { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertOctagon,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  FileSearch,
  FolderSearch,
  Info,
  Search,
  Sparkles,
  Terminal,
  XCircle
} from 'lucide-react'
import type { CrashAnalysis, CrashFinding, CrashHistoryEntry, CrashSeverity, CrashSource, IntegrityCheck } from '@shared/types'
import { classNames } from '../components/ui'
import { errorMessage, useApp } from '../store'
import { formatBytes, relativeTime } from '@shared/utils'
import { Button, EmptyState, Meter, Pill, ProgressRing } from '../components/ui'
import Background from '../components/Background'
import SelectMenu from '../components/SelectMenu'

type CrashTab = 'findings' | 'suspects' | 'checks' | 'log'

const SEVERITY_META: Record<CrashSeverity, { label: string; tone: 'danger' | 'warning' | 'default' | 'success'; icon: typeof AlertTriangle }> = {
  critical: { label: '严重', tone: 'danger', icon: AlertOctagon },
  warning: { label: '警告', tone: 'warning', icon: AlertTriangle },
  info: { label: '信息', tone: 'default', icon: Info },
  good: { label: '正常', tone: 'success', icon: CheckCircle2 }
}

const SOURCE_LABEL: Record<CrashSource['kind'], string> = {
  'crash-report': '崩溃报告',
  'latest-log': '最新日志',
  'debug-log': '调试日志',
  'launch-log': '启动日志',
  'hs-err': 'JVM 崩溃日志',
  'log-archive': '历史日志归档'
}

const CHECK_LABEL: Record<IntegrityCheck['status'], string> = {
  pass: '通过',
  warn: '注意',
  fail: '异常',
  skip: '跳过'
}

export default function CrashPage(): React.JSX.Element {
  const { activeInstance, instances, selectInstance, navigate, pushToast, boot } = useApp()
  const [sources, setSources] = useState<CrashSource[]>([])
  const [selected, setSelected] = useState('')
  const [analysis, setAnalysis] = useState<CrashAnalysis | null>(null)
  const [history, setHistory] = useState<CrashHistoryEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [openFindings, setOpenFindings] = useState<Set<string>>(new Set())
  const [tab, setTab] = useState<CrashTab>('findings')

  const run = async (sourcePath?: string) => {
    if (!activeInstance) return
    setLoading(true)
    try {
      const data = await window.ember.crash.analyze(activeInstance.id, sourcePath)
      setAnalysis(data)
      setHistory((prev) => [{ id: data.id, instanceId: data.instanceId, at: data.createdAt, analysis: data }, ...prev.filter((entry) => entry.id !== data.id)].slice(0, 8))
      setOpenFindings(new Set(data.findings.slice(0, 1).map((finding) => finding.id)))
      setTab('findings')
    } catch (err) {
      pushToast({ tone: 'error', title: '分析失败', message: errorMessage(err) })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!activeInstance) return
    let cancelled = false
    setAnalysis(null)
    setSources([])
    setHistory([])
    setLoading(true)
    void window.ember.crash.history(activeInstance.id).then((list) => !cancelled && setHistory(list)).catch(() => undefined)
    window.ember.crash
      .sources(activeInstance.id)
      .then((list) => {
        if (cancelled) return
        setSources(list)
        const primary = list.find((source) => source.primary) ?? list[0]
        setSelected(primary?.path ?? '')
        return window.ember.crash.analyze(activeInstance.id, boot?.demo ? undefined : primary?.path)
      })
      .then((data) => {
        if (cancelled || !data) return
        setAnalysis(data)
        setHistory((prev) => [{ id: data.id, instanceId: data.instanceId, at: data.createdAt, analysis: data }, ...prev.filter((entry) => entry.id !== data.id)].slice(0, 8))
        setOpenFindings(new Set(data.findings.slice(0, 1).map((finding) => finding.id)))
        setTab('findings')
      })
      .catch((err) => !cancelled && pushToast({ tone: 'error', title: '分析失败', message: errorMessage(err) }))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeInstance?.id])

  const counts = useMemo(() => {
    const value = { pass: 0, warn: 0, fail: 0, skip: 0 }
    analysis?.checks.forEach((check) => value[check.status]++)
    return value
  }, [analysis])

  if (!activeInstance) {
    return (
      <div className="page">
        <Background variant="crash" />
        <EmptyState icon={FileSearch} title="还没有选中的实例" description="选择一个实例后再读取崩溃报告。" action={<Button variant="primary" onClick={() => navigate('/')}>返回主页</Button>} />
      </div>
    )
  }

  const severity = analysis ? SEVERITY_META[analysis.severity] : SEVERITY_META.info
  const SeverityIcon = severity.icon
  const confidence = analysis ? Math.round(analysis.confidence * 100) : 0
  const nextSteps = Array.from(new Set((analysis?.findings ?? []).flatMap((finding) => finding.advice).filter(Boolean))).slice(0, 3)

  return (
    <div className="page crash-page">
      <Background variant="crash" />
      <div className="page-head">
        <div>
          <h1>崩溃分析</h1>
          <p>先看结论，再查看可疑代码和资源检查。</p>
        </div>
        <div className="page-head-actions">
          <SelectMenu
            value={activeInstance.id}
            options={instances.map((instance) => ({ value: instance.id, label: `${instance.name} · ${instance.mcVersion}` }))}
            onChange={(id) => void selectInstance(id)}
            placeholder="选择实例"
            className="crash-instance-select"
          />
          <Button variant="secondary" icon={FolderSearch} onClick={() => analysis?.sourceFile && void window.ember.crash.reveal(analysis.sourceFile)} disabled={!analysis?.sourceFile}>
            打开报告
          </Button>
          <Button variant="primary" icon={Search} loading={loading} onClick={() => void run(boot?.demo ? undefined : selected || undefined)}>
            重新分析
          </Button>
        </div>
      </div>

      <div className="crash-sourcebar">
        <div className="crash-source-select">
          <span className="field-label">选择日志</span>
          <SelectMenu
            value={selected}
            options={sources.length ? sources.map((source) => ({ value: source.path, label: source.label })) : [{ value: '', label: '没有可用日志' }]}
            onChange={(next) => {
              setSelected(next)
              void run(boot?.demo ? undefined : next)
            }}
            placeholder="选择日志"
            className="crash-source-menu"
          />
        </div>
        <div className="source-meta">
          {analysis ? (
            <>
              <span>{SOURCE_LABEL[analysis.sourceKind]}</span>
              <span>{formatBytes(analysis.byteSize)}</span>
              <span>{relativeTime(analysis.createdAt)}</span>
              <Pill tone={severity.tone} dot>{severity.label}</Pill>
            </>
          ) : <span>等待分析</span>}
        </div>
      </div>

      {history.length ? (
        <section className="crash-history">
          <div className="crash-history-head">
            <strong>最近分析</strong>
            <span>保存最近 {history.length} 次结论，切换到其他页面后仍可回看</span>
          </div>
          <div className="crash-history-list">
            {history.slice(0, 8).map((entry) => (
              <button
                key={entry.id}
                type="button"
                className={classNames('crash-history-item', analysis?.id === entry.id && 'is-active')}
                onClick={() => {
                  setAnalysis(entry.analysis)
                  setSelected(entry.analysis.sourceFile)
                  setOpenFindings(new Set(entry.analysis.findings.slice(0, 1).map((finding) => finding.id)))
                  setTab('findings')
                }}
              >
                <span className={`history-dot severity-${entry.analysis.severity}`} />
                <span className="history-copy">
                  <strong>{entry.analysis.findings[0]?.title ?? entry.analysis.headline}</strong>
                  <em>{relativeTime(entry.at)} · {SOURCE_LABEL[entry.analysis.sourceKind]}</em>
                </span>
                <ArrowRight size={13} />
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {loading ? (
        <div className="crash-loading">
          <div className="forensic-spinner">
            <span />
            <span />
            <span />
            <FileSearch size={28} />
          </div>
          <strong>正在分析日志</strong>
          <p>匹配规则、过滤原版代码、检查模组与资源</p>
        </div>
      ) : analysis ? (
        <>
          <section className={classNames('crash-verdict', `severity-${analysis.severity}`)}>
            <div className="verdict-left">
              <div className="verdict-icon">
                <SeverityIcon size={32} />
                <span className="verdict-ripple" />
              </div>
              <div className="verdict-copy">
                <div className="verdict-eyebrow">
                  最可能原因 · {severity.label} · {analysis.findings.filter((finding) => finding.severity !== 'good').length} 条结论
                </div>
                <h2>{analysis.findings[0]?.title ?? analysis.headline}</h2>
                <p>{analysis.findings[0]?.summary ?? '没有发现明确的崩溃原因。'}</p>
                <div className="verdict-tags">
                  <Pill tone="danger" dot>退出码 {analysis.exitCode ?? -1}</Pill>
                  {analysis.suspects[0]?.mod ? <Pill tone="warning">{analysis.suspects[0].mod}</Pill> : null}
                </div>
              </div>
            </div>
            <div className="verdict-confidence">
              <ProgressRing value={confidence} size={104} stroke={3} tone={analysis.severity === 'critical' ? 'danger' : 'accent'}>
                <strong>{confidence}</strong>
                <em>置信度</em>
              </ProgressRing>
            </div>
          </section>

          {nextSteps.length ? (
            <section className="crash-next-steps">
              <div className="crash-next-head">
                <span>先做这几步</span>
                <em>按顺序处理，通常可以从这里解决</em>
              </div>
              <ol>
                {nextSteps.map((step, index) => (
                  <li key={step}>
                    <span>{index + 1}</span>
                    <p>{step}</p>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}

          <div className="crash-tabs">
            <button type="button" className={tab === 'findings' ? 'is-active' : ''} onClick={() => setTab('findings')}>
              诊断 <span>{analysis.findings.length}</span>
            </button>
            <button type="button" className={tab === 'suspects' ? 'is-active' : ''} onClick={() => setTab('suspects')}>
              可疑代码 <span>{analysis.suspects.length}</span>
            </button>
            <button type="button" className={tab === 'checks' ? 'is-active' : ''} onClick={() => setTab('checks')}>
              资源检查 <span>{counts.fail + counts.warn}</span>
            </button>
            <button type="button" className={tab === 'log' ? 'is-active' : ''} onClick={() => setTab('log')}>
              日志
            </button>
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={tab}
              className="crash-tab-body"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -5 }}
              transition={{ duration: 0.18 }}
            >
              {tab === 'findings' ? (
                <div className="finding-list">
                  {analysis.findings.map((finding, index) => (
                    <FindingCard
                      key={finding.id}
                      finding={finding}
                      index={index}
                      open={openFindings.has(finding.id)}
                      onToggle={() =>
                        setOpenFindings((prev) => {
                          const next = new Set(prev)
                          if (next.has(finding.id)) next.delete(finding.id)
                          else next.add(finding.id)
                          return next
                        })
                      }
                    />
                  ))}
                </div>
              ) : null}

              {tab === 'suspects' ? (
                <>
                  <div className="crash-section-head">
                    <div>
                      <h3>第一个可疑位置</h3>
                      <p>已经跳过 Minecraft、加载器与 JDK 的代码。</p>
                    </div>
                  </div>
                  <div className="suspect-grid">
                    {analysis.suspects.length ? analysis.suspects.map((suspect, index) => (
                      <motion.div
                        key={suspect.frame}
                        className={classNames('suspect-card', index === 0 && 'is-primary')}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: index * 0.05 }}
                      >
                        <div className="suspect-rank">
                          <span>0{index + 1}</span>
                          <em>评分</em>
                          <strong>{suspect.score}</strong>
                        </div>
                        <div className="suspect-main">
                          <div className="suspect-title">
                            <strong>{suspect.mod ?? suspect.className.split('.').slice(-2).join('.')}</strong>
                            {suspect.mod ? <Pill tone="warning">模组</Pill> : <Pill tone="default">类</Pill>}
                            {index === 0 ? <Pill tone="danger">首要</Pill> : null}
                          </div>
                          <code className="suspect-frame">{suspect.frame}</code>
                          <div className="suspect-meta">
                            <span>{suspect.source}</span>
                            <span>{suspect.method}()</span>
                          </div>
                          <p>{suspect.reason}</p>
                          <Meter value={suspect.score} tone={index === 0 ? 'danger' : 'warning'} />
                        </div>
                      </motion.div>
                    )) : (
                      <div className="suspect-empty">
                        <CircleHelp size={22} />
                        <strong>没有提取到第三方代码</strong>
                        <p>日志可能被截断，或崩溃发生在原版代码中。</p>
                      </div>
                    )}
                  </div>
                </>
              ) : null}

              {tab === 'checks' ? (
                <div className="crash-two-col">
                  <section className="integrity-card">
                    <div className="crash-section-head compact">
                      <h3>资源检查</h3>
                      <Pill tone={counts.fail ? 'danger' : counts.warn ? 'warning' : 'success'}>
                        {counts.fail ? `${counts.fail} 项异常` : counts.warn ? `${counts.warn} 项注意` : '全部通过'}
                      </Pill>
                    </div>
                    <div className="check-list">
                      {analysis.checks.map((check) => (
                        <div key={check.id} className={classNames('check-row', `check-${check.status}`)}>
                          <span className="check-dot" />
                          <div>
                            <strong>{check.label}</strong>
                            <p>{check.detail}</p>
                          </div>
                          <em>{CHECK_LABEL[check.status]}</em>
                        </div>
                      ))}
                    </div>
                  </section>
                  <section className="exceptions-card">
                    <div className="crash-section-head compact">
                      <h3>异常链</h3>
                      <Pill tone="danger">{analysis.exceptions.length}</Pill>
                    </div>
                    <div className="exception-list">
                      {analysis.exceptions.length ? analysis.exceptions.map((exception, index) => (
                        <div key={index} className="exception-row">
                          <span>{String(index + 1).padStart(2, '0')}</span>
                          <code>{exception}</code>
                        </div>
                      )) : <p className="field-hint">日志中没有提取到异常类。</p>}
                    </div>
                  </section>
                </div>
              ) : null}

              {tab === 'log' ? (
                <section className="raw-log-card">
                  <div className="crash-section-head compact">
                    <h3>日志尾部</h3>
                    <Pill tone="default">{analysis.logTail.length} 行</Pill>
                  </div>
                  <pre>
                    {analysis.logTail.map((line, index) => (
                      <div key={index} className={/ERROR|Exception/i.test(line) ? 'is-error' : /WARN/i.test(line) ? 'is-warn' : ''}>
                        <span>{String(index + 1).padStart(3, '0')}</span>
                        {line}
                      </div>
                    ))}
                  </pre>
                </section>
              ) : null}
            </motion.div>
          </AnimatePresence>
        </>
      ) : (
        <EmptyState
          icon={FileSearch}
          title="没有可分析的日志"
          description="启动一次游戏后，崩溃报告和日志会出现在实例目录中。"
          action={<Button variant="primary" icon={Sparkles} onClick={() => void run()}>尝试分析</Button>}
        />
      )}

      <div className="crash-footnote">
        <Info size={13} />
        <span>诊断基于本地规则与日志证据，仅用于定位方向。</span>
      </div>
    </div>
  )
}

function FindingCard({
  finding,
  index,
  open,
  onToggle
}: {
  finding: CrashFinding
  index: number
  open: boolean
  onToggle: () => void
}): React.JSX.Element {
  const meta = SEVERITY_META[finding.severity]
  const Icon = meta.icon
  return (
    <motion.div
      className={classNames('finding-card', `finding-${finding.severity}`, open && 'is-open')}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.035 }}
    >
      <button type="button" className="finding-head" onClick={onToggle}>
        <span className="finding-icon"><Icon size={18} /></span>
        <span className="finding-title">
          <strong>{finding.title}</strong>
          <em>{meta.label} · 置信度 {Math.round(finding.confidence * 100)}%</em>
        </span>
        <span className="finding-index">0{index + 1}</span>
        <ChevronDown size={16} className={classNames('chevron', open && 'is-open')} />
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div className="finding-body" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22 }}>
            <p>{finding.summary}</p>
            {finding.evidence.length ? (
              <div className="evidence-block">
                <span>证据</span>
                {finding.evidence.map((line, off) => <code key={off}>{line}</code>)}
              </div>
            ) : null}
            {finding.advice.length ? (
              <div className="advice-block">
                <span>建议</span>
                <ul>
                  {finding.advice.map((line, off) => (
                    <li key={off}><ArrowRight size={12} /> {line}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.div>
  )
}
