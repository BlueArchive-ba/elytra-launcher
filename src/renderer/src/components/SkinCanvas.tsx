import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { IdleAnimation, FlyingAnimation, RunningAnimation, SkinViewer, WalkingAnimation } from 'skinview3d'
import type { PlayerAnimation } from 'skinview3d'
import fallbackSkin from '../assets/ember-skin.png'

export type SkinAnimation = 'idle' | 'walk' | 'run' | 'fly'

export interface SkinCanvasHandle {
  reset: () => void
}

interface Props {
  skinImage?: string
  capeImage?: string | null
  slim?: boolean
  animation: SkinAnimation
  autoRotate: boolean
  lightTheme?: boolean
}

function animationFor(name: SkinAnimation): PlayerAnimation {
  switch (name) {
    case 'walk':
      return new WalkingAnimation()
    case 'run':
      return new RunningAnimation()
    case 'fly':
      return new FlyingAnimation()
    default:
      return new IdleAnimation()
  }
}

async function loadImage(src: string): Promise<HTMLImageElement> {
  const image = new Image()
  image.decoding = 'async'
  image.crossOrigin = 'anonymous'
  image.src = src
  if (typeof image.decode === 'function') {
    await image.decode()
  } else {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('image decode failed'))
    })
  }
  return image
}

const SkinCanvas = forwardRef<SkinCanvasHandle, Props>(function SkinCanvas(
  { skinImage, capeImage, slim, animation, autoRotate, lightTheme }: Props,
  ref
) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<SkinViewer | null>(null)
  const [failed, setFailed] = useState(false)
  const [loading, setLoading] = useState(true)

  useImperativeHandle(ref, () => ({
    reset: () => {
      const viewer = viewerRef.current
      if (!viewer) return
      viewer.resetCameraPose()
      viewer.zoom = 0.95
      viewer.controls.target.set(0, 0, 0)
      viewer.controls.update()
    }
  }))

  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return
    let viewer: SkinViewer
    try {
      viewer = new SkinViewer({
        canvas,
        width: wrap.clientWidth,
        height: wrap.clientHeight,
        skin: fallbackSkin,
        model: 'auto-detect',
        zoom: 1.05,
        fov: 42,
        enableControls: true
      })
    } catch (err) {
      console.error('SkinViewer failed', err)
      setFailed(true)
      setLoading(false)
      return
    }
    viewerRef.current = viewer
    viewer.autoRotate = autoRotate
    viewer.autoRotateSpeed = 0.9
    viewer.controls.enablePan = false
    viewer.controls.minDistance = 24
    viewer.controls.maxDistance = 160
    viewer.resetCameraPose()
    viewer.zoom = 0.95
    viewer.controls.target.set(0, 0, 0)
    viewer.controls.update()
    viewer.playerObject.skin.visible = true
    viewer.globalLight.intensity = lightTheme ? 1.7 : 1.25
    viewer.cameraLight.intensity = 0.9
    viewer.renderer.setClearColor(0x000000, 0)
    viewer.animation = animationFor(animation)
    setLoading(false)

    let disposed = false
    const observer = new ResizeObserver(() => {
      if (!wrap || viewer.disposed) return
      viewer.setSize(Math.max(200, wrap.clientWidth), Math.max(260, wrap.clientHeight))
    })
    observer.observe(wrap)
    return () => {
      disposed = true
      observer.disconnect()
      viewer.dispose()
      viewerRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer) return
    viewer.autoRotate = autoRotate
  }, [autoRotate])

  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer) return
    viewer.animation = animationFor(animation)
  }, [animation])

  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer) return
    viewer.globalLight.intensity = lightTheme ? 1.7 : 1.25
    viewer.cameraLight.intensity = 0.9
  }, [lightTheme])

  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer) return
    let cancelled = false
    const load = async () => {
      try {
        const image = await loadImage(skinImage || fallbackSkin)
        if (!cancelled) viewer.loadSkin(image, { model: slim ? 'slim' : 'default' })
      } catch {
        /* keep previous texture */
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [skinImage, slim])

  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer) return
    let cancelled = false
    if (!capeImage) {
      viewer.resetCape()
      return
    }
    void loadImage(capeImage)
      .then((image) => {
        if (!cancelled) viewer.loadCape(image, { backEquipment: 'cape' })
      })
      .catch(() => viewer.resetCape())
    return () => {
      cancelled = true
    }
  }, [capeImage])

  return (
    <div className="skin-canvas-wrap" ref={wrapRef}>
      <div className="skin-aura" />
      <div className="skin-platform" />
      <canvas ref={canvasRef} className="skin-canvas" />
      {loading && !failed ? <div className="skin-loading">构建 3D 角色…</div> : null}
      {failed ? <div className="skin-loading">此设备无法初始化 WebGL 3D 预览</div> : null}
      <div className="skin-scanline" />
      <div className="skin-hud">
        <span>SKIN // RENDER</span>
        <span>3D · 60FPS</span>
      </div>
    </div>
  )
})

export default SkinCanvas
