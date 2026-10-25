import React, { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Download, X } from 'lucide-react'
import { useApp } from '../store'
import { Button } from './ui'

export default function ModUpdateNotice(): React.JSX.Element | null {
  const { modUpdates, updatingMods, modProgress, updateAllMods, navigate } = useApp()
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (modUpdates.length) setDismissed(false)
  }, [modUpdates.length])

  if (!modUpdates.length || dismissed) return null
  const busy = updatingMods.length > 0

  return (
    <motion.div
      className="mod-update-notice"
      initial={{ opacity: 0, y: 14, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8 }}
    >
      <div className="mod-update-icon">
        <Download size={17} />
      </div>
      <div className="mod-update-copy">
        <strong>{modUpdates.length} 个模组有更新</strong>
        {busy && modProgress ? (
          <div className="mod-update-progress">
            <div className="mod-update-progress-head">
              <span>{modProgress.fileName}</span>
              <em>{modProgress.percent}% · {(modProgress.speed / 1024 / 1024).toFixed(1)} MB/s · {modProgress.threads} 线程</em>
            </div>
            <div className="mod-update-progress-bar"><span style={{ width: `${modProgress.percent}%` }} /></div>
          </div>
        ) : (
          <p>{modUpdates.slice(0, 2).map((item) => item.title).join('、')}{modUpdates.length > 2 ? ' 等' : ''}</p>
        )}
      </div>
      <div className="mod-update-actions">
        <Button variant="ghost" onClick={() => navigate('/mods')}>查看</Button>
        <Button variant="primary" loading={busy} onClick={() => void updateAllMods()}>一键更新</Button>
      </div>
      <button type="button" className="mod-update-close" onClick={() => setDismissed(true)} aria-label="关闭更新提示">
        <X size={13} />
      </button>
    </motion.div>
  )
}
