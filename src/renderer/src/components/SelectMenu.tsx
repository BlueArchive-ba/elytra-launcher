import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, ChevronDown } from 'lucide-react'
import { classNames } from './ui'

export interface SelectOption {
  value: string
  label: string
  group?: string
}

/**
 * Styled single-select. The panel is portaled to <body> and positioned with
 * viewport coordinates, so cards / overflow containers can never cover it.
 */
export default function SelectMenu({
  value,
  options,
  onChange,
  placeholder,
  className
}: {
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  placeholder: string
  className?: string
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ left: 0, top: 0, width: 180 })
  const triggerRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const selected = options.find((option) => option.value === value)

  const place = () => {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return
    const width = Math.max(rect.width, 180)
    setPosition({
      left: Math.max(8, Math.min(rect.left, window.innerWidth - Math.min(width, 280) - 8)),
      top: rect.bottom + 6,
      width
    })
  }

  useEffect(() => {
    if (!open) return
    place()
    const outside = (event: MouseEvent) => {
      const target = event.target as Node
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return
      setOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    const reposition = () => place()
    document.addEventListener('mousedown', outside)
    document.addEventListener('keydown', escape)
    window.addEventListener('resize', reposition)
    document.addEventListener('scroll', reposition, true)
    return () => {
      document.removeEventListener('mousedown', outside)
      document.removeEventListener('keydown', escape)
      window.removeEventListener('resize', reposition)
      document.removeEventListener('scroll', reposition, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const groups = new Map<string, SelectOption[]>()
  for (const option of options) {
    const key = option.group ?? ''
    groups.set(key, [...(groups.get(key) ?? []), option])
  }

  return (
    <div className={classNames('select-menu', open && 'is-open', className)} ref={triggerRef}>
      <button
        type="button"
        className="select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          place()
          setOpen((next) => !next)
        }}
      >
        <span className={classNames(!selected && 'is-placeholder')} title={selected?.label ?? placeholder}>
          {selected?.label ?? placeholder}
        </span>
        <ChevronDown size={13} className={classNames('select-chevron', open && 'is-open')} />
      </button>
      {createPortal(
        <AnimatePresence>
          {open ? (
            <motion.div
              ref={panelRef}
              className="select-panel select-panel-portal"
              role="listbox"
              initial={{ opacity: 0, y: -5, scale: 0.985 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.99 }}
              transition={{ duration: 0.16, ease: [0.22, 0.8, 0.2, 1] }}
              style={{ left: position.left, top: position.top, minWidth: position.width }}
            >
              {[...groups.entries()].map(([group, items]) => (
                <div className="select-group" key={group || '__default'}>
                  {group ? <span className="select-group-label">{group}</span> : null}
                  {items.map((option) => (
                    <button
                      key={option.value || '__empty'}
                      type="button"
                      role="option"
                      aria-selected={option.value === value}
                      className={classNames('select-option', option.value === value && 'is-selected')}
                      onClick={() => {
                        onChange(option.value)
                        setOpen(false)
                      }}
                    >
                      <span>{option.label}</span>
                      {option.value === value ? <Check size={12} strokeWidth={2.5} /> : null}
                    </button>
                  ))}
                </div>
              ))}
            </motion.div>
          ) : null}
        </AnimatePresence>,
        document.body
      )}
    </div>
  )
}
