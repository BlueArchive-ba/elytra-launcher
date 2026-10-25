import React from 'react'

export default function Background({ variant = 'default' }: { variant?: 'default' | 'skin' | 'mods' | 'crash' }): React.JSX.Element {
  return (
    <div className={`ambient ambient-${variant}`} aria-hidden="true">
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
