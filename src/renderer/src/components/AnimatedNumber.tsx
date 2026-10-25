import React, { useEffect, useRef, useState } from 'react'
import { animate } from 'framer-motion'

/** Small count-up used by stats. It keeps the same layout width with tabular numbers. */
export default function AnimatedNumber({
  value,
  format = (next) => String(Math.round(next)),
  className
}: {
  value: number | null | undefined
  format?: (value: number) => string
  className?: string
}): React.JSX.Element {
  const safe = typeof value === 'number' && Number.isFinite(value) ? value : 0
  const [display, setDisplay] = useState(safe)
  const current = useRef(safe)

  useEffect(() => {
    if (current.current === safe) {
      setDisplay(safe)
      return
    }
    const controls = animate(current.current, safe, {
      duration: 0.55,
      ease: [0.22, 0.8, 0.2, 1],
      onUpdate: (next) => {
        current.current = next
        setDisplay(next)
      },
      onComplete: () => {
        current.current = safe
      }
    })
    return () => controls.stop()
  }, [safe])

  return <span className={className}>{format(display)}</span>
}
