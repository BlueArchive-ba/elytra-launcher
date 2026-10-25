import React from 'react'
import { useApp } from '../store'

export default function Background({ variant = 'default' }: { variant?: 'default' | 'skin' | 'mods' | 'crash' }): React.JSX.Element {
  const { resolvedTheme } = useApp()
  return (
    <div key={resolvedTheme} className={`ambient ambient-${variant}`} aria-hidden="true">
      <div className="ambient-flat" />
      <div className="ambient-aurora aurora-a" />
      <div className="ambient-aurora aurora-b" />
      <div className="ambient-grid" />
      <div className="ambient-dust" />
      <div className="ambient-sweep" />
      <div className="ambient-noise" />
    </div>
  )
}
