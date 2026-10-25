import React, { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Loader2, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export function classNames(...values: (string | false | null | undefined)[]): string {
  return values.filter(Boolean).join(' ')
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'quiet'
type ButtonSize = 'sm' | 'md' | 'lg'

export function Button({
  children,
  variant = 'secondary',
  size = 'md',
  icon: Icon,
  iconRight: IconRight,
  loading,
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
  icon?: LucideIcon
  iconRight?: LucideIcon
  loading?: boolean
}): React.JSX.Element {
  return (
    <button
      className={classNames('btn', `btn-${variant}`, `btn-${size}`, loading && 'is-loading', className)}
      disabled={loading || rest.disabled}
      {...rest}
    >
      <span className="btn-sheen" />
      {loading ? <Loader2 size={16} className="spin" /> : Icon ? <Icon size={size === 'lg' ? 19 : 16} /> : null}
      <span className="btn-label">{children}</span>
      {IconRight ? <IconRight size={16} /> : null}
    </button>
  )
}

export function IconButton({
  icon: Icon,
  label,
  active,
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: LucideIcon
  label: string
  active?: boolean
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      data-tip={label}
      className={classNames('icon-btn', active && 'is-active', className)}
      {...rest}
    >
      <Icon size={18} />
    </button>
  )
}

export function Spinner({ size = 18 }: { size?: number }): React.JSX.Element {
  return <Loader2 size={size} className="spin" />
}

export function Pill({
  children,
  tone = 'default',
  dot,
  className
}: {
  children: React.ReactNode
  tone?: 'default' | 'accent' | 'success' | 'danger' | 'warning' | 'blue'
  dot?: boolean
  className?: string
}): React.JSX.Element {
  return (
    <span className={classNames('pill', `pill-${tone}`, className)}>
      {dot ? <i className="pill-dot" /> : null}
      {children}
    </span>
  )
}

export function Badge({ children, className }: { children: React.ReactNode; className?: string }): React.JSX.Element {
  return <span className={classNames('badge', className)}>{children}</span>
}

export function Kbd({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <kbd className="kbd">{children}</kbd>
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className,
  compact
}: {
  value: T
  options: { value: T; label: React.ReactNode; icon?: LucideIcon }[]
  onChange: (value: T) => void
  className?: string
  compact?: boolean
}): React.JSX.Element {
  return (
    <div className={classNames('segmented', compact && 'is-compact', className)} role="tablist">
      {options.map((option) => {
        const Icon = option.icon
        const active = option.value === value
        return (
          <button
            key={option.value}
            role="tab"
            aria-selected={active}
            className={classNames('segmented-item', active && 'is-active')}
            onClick={() => onChange(option.value)}
            type="button"
          >
            {active ? <motion.span layoutId={`segment-${className ?? 'default'}`} className="segmented-glider" /> : null}
            <span className="segmented-label">
              {Icon ? <Icon size={15} /> : null}
              {option.label}
            </span>
          </button>
        )
      })}
    </div>
  )
}

export function Switch({
  checked,
  onChange,
  disabled,
  label
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  label?: string
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={classNames('switch', checked && 'is-on')}
      onClick={() => onChange(!checked)}
    >
      <motion.span
        className="switch-thumb"
        animate={{ x: checked ? 20 : 2 }}
        transition={{ type: 'spring', stiffness: 520, damping: 34 }}
      />
    </button>
  )
}

export function Modal({
  open,
  onClose,
  children,
  className,
  size = 'md',
  labelledBy
}: {
  open: boolean
  onClose: () => void
  children: React.ReactNode
  className?: string
  size?: 'sm' | 'md' | 'lg' | 'xl'
  labelledBy?: string
}): React.JSX.Element | null {
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (typeof document === 'undefined') return null
  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div
          className="modal-layer"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.22 }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) onClose()
          }}
        >
          <motion.div
            className={classNames('modal', `modal-${size}`, className)}
            role="dialog"
            aria-modal="true"
            aria-labelledby={labelledBy}
            initial={{ opacity: 0, y: 28, scale: 0.975 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 18, scale: 0.985 }}
            transition={{ type: 'spring', stiffness: 320, damping: 30 }}
          >
            {children}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body
  )
}

export function ModalHeader({
  eyebrow,
  title,
  description,
  onClose,
  id
}: {
  eyebrow?: string
  title: React.ReactNode
  description?: React.ReactNode
  onClose?: () => void
  id?: string
}): React.JSX.Element {
  return (
    <div className="modal-head">
      <div>
        {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
        <h2 id={id} className="modal-title">
          {title}
        </h2>
        {description ? <p className="modal-desc">{description}</p> : null}
      </div>
      {onClose ? <IconButton icon={X} label="关闭" onClick={onClose} /> : null}
    </div>
  )
}

export function ProgressRing({
  value,
  size = 120,
  stroke = 4,
  children,
  tone = 'accent'
}: {
  value: number
  size?: number
  stroke?: number
  children?: React.ReactNode
  tone?: 'accent' | 'success' | 'danger' | 'blue'
}): React.JSX.Element {
  const radius = (size - stroke) / 2
  const circumference = radius * 2 * Math.PI
  const clamped = Math.max(0, Math.min(100, value))
  return (
    <div className={classNames('progress-ring', `tone-${tone}`)} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle className="ring-track" cx={size / 2} cy={size / 2} r={radius} strokeWidth={stroke} fill="none" />
        <circle
          className="ring-value"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={circumference - (clamped / 100) * circumference}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="ring-content">{children}</div>
    </div>
  )
}

export function SectionHeading({
  eyebrow,
  title,
  action
}: {
  eyebrow?: string
  title: React.ReactNode
  action?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="section-heading">
      <div>
        {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
        <h2>{title}</h2>
      </div>
      {action}
    </div>
  )
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  compact
}: {
  icon: LucideIcon
  title: string
  description?: string
  action?: React.ReactNode
  compact?: boolean
}): React.JSX.Element {
  return (
    <div className={classNames('empty-state', compact && 'is-compact')}>
      <div className="empty-orbit">
        <Icon size={compact ? 20 : 26} />
      </div>
      <h3>{title}</h3>
      {description ? <p>{description}</p> : null}
      {action ? <div className="empty-action">{action}</div> : null}
    </div>
  )
}

export function Tooltip({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <span className="tooltip-wrap" data-tip={label}>
      {children}
    </span>
  )
}

export function Divider({ label }: { label?: string }): React.JSX.Element {
  return (
    <div className="divider">
      <span />
      {label ? <em>{label}</em> : null}
      <span />
    </div>
  )
}

export function Meter({
  value,
  max = 100,
  tone = 'accent',
  className
}: {
  value: number
  max?: number
  tone?: 'accent' | 'blue' | 'success' | 'warning' | 'danger'
  className?: string
}): React.JSX.Element {
  const pct = Math.max(0, Math.min(100, (value / max) * 100))
  return (
    <div className={classNames('meter', `meter-${tone}`, className)}>
      <motion.span initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ type: 'spring', stiffness: 80, damping: 20 }} />
    </div>
  )
}
