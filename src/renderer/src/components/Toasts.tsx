import React from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, Check, Info, X, XCircle } from 'lucide-react'
import { useApp } from '../store'
import { classNames } from './ui'

const icons = {
  success: Check,
  error: XCircle,
  warning: AlertTriangle,
  info: Info
}

export default function Toasts(): React.JSX.Element {
  const { toasts, dismissToast } = useApp()
  return (
    <div className="toasts">
      <AnimatePresence initial={false}>
        {toasts.map((toast) => {
          const Icon = icons[toast.tone]
          return (
            <motion.div
              key={toast.id}
              layout
              initial={{ opacity: 0, x: 34, scale: 0.96 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 24, scale: 0.96 }}
              transition={{ type: 'spring', stiffness: 330, damping: 28 }}
              className={classNames('toast', `toast-${toast.tone}`)}
            >
              <span className="toast-icon">
                <Icon size={17} />
              </span>
              <div className="toast-body">
                <strong>{toast.title}</strong>
                {toast.message ? <p>{toast.message}</p> : null}
              </div>
              <button type="button" onClick={() => dismissToast(toast.id)} aria-label="关闭提示">
                <X size={14} />
              </button>
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}
