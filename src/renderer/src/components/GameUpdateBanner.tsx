import React, { useEffect, useState } from 'react'
import { ArrowRight, Sparkles, X } from 'lucide-react'
import type { GameUpdateInfo } from '@shared/types'
import { useApp } from '../store'

const DISMISS_KEY = 'elytra.game-update-dismissed'

function readDismissed(): Set<string> {
  try {
    return new Set(JSON.parse(sessionStorage.getItem(DISMISS_KEY) ?? '[]') as string[])
  } catch {
    return new Set()
  }
}

/** Mojang release / snapshot banners, shown once per session and version. */
export default function GameUpdateBanner(): React.JSX.Element | null {
  const { activeInstance, setCreateOpen } = useApp()
  const [info, setInfo] = useState<GameUpdateInfo | null>(null)
  const [dismissed, setDismissed] = useState<Set<string>>(() => readDismissed())

  useEffect(() => {
    let cancelled = false
    window.ember.gameUpdates
      .check()
      .then((data) => !cancelled && setInfo(data))
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  if (!activeInstance || !info) return null
  const releaseNew = info.release && info.release.version !== activeInstance.mcVersion
  const snapshotNew = info.snapshot && info.snapshot.version !== activeInstance.mcVersion && info.snapshot.version !== info.release?.version
  const rows = [
    releaseNew
      ? { id: `release:${info.release!.version}`, tag: '正式版更新', version: info.release!.version, tone: 'accent' as const }
      : null,
    snapshotNew
      ? { id: `snapshot:${info.snapshot!.version}`, tag: '快照更新', version: info.snapshot!.version, tone: 'default' as const }
      : null
  ].filter((row): row is NonNullable<typeof row> => !!row && !dismissed.has(row.id))

  if (!rows.length) return null

  const dismiss = (id: string) => {
    const next = new Set(dismissed)
    next.add(id)
    setDismissed(next)
    sessionStorage.setItem(DISMISS_KEY, JSON.stringify([...next]))
  }

  return (
    <>
      {rows.map((row) => (
        <div key={row.id} className={`game-update-banner is-${row.tone}`}>
          <span className="game-update-icon"><Sparkles size={14} /></span>
          <div className="game-update-copy">
            <strong>Minecraft {row.version} {row.tag}已发布</strong>
            <span>当前实例是 {activeInstance.mcVersion}。新建一个 {row.version} 实例即可使用。</span>
          </div>
          <button type="button" className="game-update-action" onClick={() => setCreateOpen(true)}>
            新建实例 <ArrowRight size={12} />
          </button>
          <button type="button" className="game-update-close" aria-label="关闭提示" onClick={() => dismiss(row.id)}>
            <X size={13} />
          </button>
        </div>
      ))}
    </>
  )
}
