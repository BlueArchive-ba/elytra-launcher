import React, { useEffect, useState } from 'react'
import { Download, RefreshCw, X } from 'lucide-react'
import type { LauncherUpdateInfo } from '@shared/types'
import { errorMessage, useApp } from '../store'

const KEY = 'elytra.launcher-update-dismissed'

export default function LauncherUpdateBanner(): React.JSX.Element | null {
  const { pushToast } = useApp()
  const [info, setInfo] = useState<LauncherUpdateInfo | null>(null)
  const [busy, setBusy] = useState(false)
  const [dismissed, setDismissed] = useState(() => sessionStorage.getItem(KEY) ?? '')

  useEffect(() => {
    let cancelled = false
    window.ember.updates
      .check()
      .then((data) => !cancelled && setInfo(data))
      .catch(() => undefined)
    const manual = (event: Event) => {
      const detail = (event as CustomEvent<LauncherUpdateInfo>).detail
      if (!detail?.available) return
      setInfo(detail)
      setDismissed('')
      sessionStorage.removeItem(KEY)
    }
    window.addEventListener('elytra:update-available', manual)
    return () => {
      cancelled = true
      window.removeEventListener('elytra:update-available', manual)
    }
  }, [])

  if (!info?.available || dismissed === info.latest) return null

  const update = async () => {
    setBusy(true)
    try {
      const file = await window.ember.updates.download(info)
      await window.ember.updates.install(file)
    } catch (err) {
      setBusy(false)
      pushToast({ tone: 'error', title: '启动器更新失败', message: errorMessage(err) })
    }
  }

  const close = () => {
    sessionStorage.setItem(KEY, info.latest)
    setDismissed(info.latest)
  }

  return (
    <div className="game-update-banner launcher-update-banner">
      <span className="game-update-icon"><RefreshCw size={14} className={busy ? 'spin' : undefined} /></span>
      <div className="game-update-copy">
        <strong>ELYTRA {info.latest} 可用</strong>
        <span>{info.name || '发现启动器新版本'} · 当前 {info.current}，将从 GitHub Releases 下载安装。</span>
      </div>
      <button type="button" className="game-update-action" disabled={busy} onClick={() => void update()}>
        <Download size={12} /> {busy ? '正在更新' : '下载并安装'}
      </button>
      <button type="button" className="game-update-close" aria-label="关闭更新提示" onClick={close}>
        <X size={13} />
      </button>
    </div>
  )
}
