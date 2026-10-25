import React from 'react'
import { Check } from 'lucide-react'
import { motion } from 'framer-motion'
import { classNames } from './ui'

/** Single choice row used by version / build lists. */
export function OptionRow({
  selected,
  title,
  meta,
  side,
  onSelect,
  className
}: {
  selected: boolean
  title: React.ReactNode
  meta?: React.ReactNode
  side?: React.ReactNode
  onSelect: () => void
  className?: string
}): React.JSX.Element {
  return (
    <motion.button
      type="button"
      layout="position"
      className={classNames('dropdown-option', selected && 'is-selected', className)}
      onClick={onSelect}
      whileTap={{ scale: 0.994 }}
      transition={{ type: 'spring', stiffness: 460, damping: 34 }}
    >
      <span className="option-main">
        <strong>{title}</strong>
        {meta ? <em>{meta}</em> : null}
      </span>
      {side ? <span className="option-side">{side}</span> : null}
      <span className="option-radio" data-selected={selected ? '1' : '0'}>
        {selected ? (
          <motion.span
            className="option-radio-dot"
            initial={{ scale: 0.2, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 520, damping: 26 }}
          />
        ) : null}
      </span>
      <motion.span
        className="option-swipe"
        initial={false}
        animate={{ opacity: selected ? 1 : 0, x: selected ? '0%' : '-12%' }}
        transition={{ duration: 0.2, ease: [0.22, 0.8, 0.2, 1] }}
      />
    </motion.button>
  )
}

/** Multiple choice chip used by filter groups. */
export function MultiChip({
  active,
  children,
  onToggle
}: {
  active: boolean
  children: React.ReactNode
  onToggle: () => void
}): React.JSX.Element {
  return (
    <motion.button
      type="button"
      className={classNames('multi-chip', active && 'is-active')}
      onClick={onToggle}
      whileTap={{ scale: 0.97 }}
      layout
      transition={{ type: 'spring', stiffness: 480, damping: 32 }}
    >
      <span className="multi-chip-box" data-active={active ? '1' : '0'}>
        {active ? (
          <motion.span
            initial={{ scale: 0.4, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 540, damping: 24 }}
          >
            <Check size={10} strokeWidth={3.4} />
          </motion.span>
        ) : null}
      </span>
      {children}
    </motion.button>
  )
}
