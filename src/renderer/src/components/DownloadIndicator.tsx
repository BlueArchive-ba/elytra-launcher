import React from 'react'
import { Download } from 'lucide-react'
import { useApp } from '../store'
import { formatBytes } from '@shared/utils'

/** Global "what is downloading right now" indicator, visible on every page. */
export default function DownloadIndicator(): React.JSX.Element | null {
  const { modProgress } = useApp()
  if (!modProgress) return null
  return (
    <div className="download-indicator" role="status">
      <span className="download-indicator-icon"><Download size={14} /></span>
      <div className="download-indicator-copy">
        <strong title={modProgress.fileName}>{modProgress.fileName}</strong>
        <div className="download-indicator-bar"><span style={{ width: `${modProgress.percent}%` }} /></div>
        <em>
          {modProgress.percent}% · {formatBytes(modProgress.received)} / {formatBytes(modProgress.total)} ·{' '}
          {(modProgress.speed / 1024 / 1024).toFixed(1)} MB/s · {modProgress.threads} 线程
        </em>
      </div>
    </div>
  )
}
