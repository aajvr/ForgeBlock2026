import { Maximize2, Minimize2, Undo2 } from 'lucide-react'
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { PAD_HEIGHT_CLASS } from './padSize'
import { Button, ConfirmDialog } from './ui'

// Captures a live signature with the Pointer Events API (Section 3.4.2).
// Each stroke is a list of {x, y, t, pressure, tiltX, tiltY, azimuth?,
// altitude?}; t is ms since the first touch, azimuth/altitude are the pen
// angles in degrees (only when the browser reports them, e.g. Apple Pencil).
// Coalesced events are used so Apple Pencil's high sampling rate is kept.
//
// x and y are CSS pixels from the pad's top-left corner. One signature keeps
// one coordinate frame: the pad's size when its first stroke started. If the
// pad changes size mid-signature (rotation, the full-screen focus mode), the
// drawing is redrawn from the stored points, scaled to fit, and new points are
// mapped back into that same frame, so a signature never mixes two scales.
const SignaturePad = forwardRef(function SignaturePad({ penOnly = false, onPenOnlyChange, onChange, label }, ref) {
  const canvasRef = useRef(null)
  const strokesRef = useRef([])
  const drawingRef = useRef(false)
  const startRef = useRef(null)
  const frameRef = useRef(null) // {w, h} of the pad when this signature started
  const sizeRef = useRef({ w: 0, h: 0 }) // the pad's current CSS size
  const [count, setCount] = useState(0)
  const [touched, setTouched] = useState(false) // hides "Sign here" as soon as a stroke starts
  const [rejected, setRejected] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)

  const ctx = () => canvasRef.current?.getContext('2d')

  // Stored frame -> current pad: uniform scale k and centring offsets.
  const view = () => {
    const f = frameRef.current
    const { w, h } = sizeRef.current
    if (!f || !w || !h) return { k: 1, ox: 0, oy: 0 }
    const k = Math.min(w / f.w, h / f.h)
    return { k, ox: (w - f.w * k) / 2, oy: (h - f.h * k) / 2 }
  }

  const segment = (a, b, v = view()) => {
    const g = ctx()
    if (!g) return
    g.lineWidth = (1.2 + 2.4 * (b.pressure || 0.5)) * Math.max(0.6, Math.min(1.6, v.k))
    g.beginPath()
    g.moveTo(v.ox + a.x * v.k, v.oy + a.y * v.k)
    g.lineTo(v.ox + b.x * v.k, v.oy + b.y * v.k)
    g.stroke()
  }

  const redraw = () => {
    const c = canvasRef.current
    const g = ctx()
    if (!c || !g) return
    g.save()
    g.setTransform(1, 0, 0, 1, 0, 0)
    g.clearRect(0, 0, c.width, c.height)
    g.restore()
    const v = view()
    for (const s of strokesRef.current) {
      for (let i = 1; i < s.length; i++) segment(s[i - 1], s[i], v)
    }
  }

  // Sharp on high-density screens: the bitmap is the CSS size x devicePixelRatio.
  const resize = () => {
    const c = canvasRef.current
    if (!c) return
    const ratio = window.devicePixelRatio || 1
    const { width, height } = c.getBoundingClientRect()
    if (!width || !height) return
    sizeRef.current = { w: width, h: height }
    c.width = Math.round(width * ratio)
    c.height = Math.round(height * ratio)
    const g = ctx()
    g.setTransform(ratio, 0, 0, ratio, 0, 0)
    g.lineCap = 'round'
    g.lineJoin = 'round'
    g.strokeStyle = '#0c3b5e'
    redraw()
  }
  const resizeRef = useRef(resize)
  resizeRef.current = resize

  // Any size change (window, rotation, opening or closing the focus mode)
  // resizes the bitmap and redraws from the stored points. The canvas is a
  // new element in the focus mode, so this re-attaches when that toggles.
  useEffect(() => {
    const c = canvasRef.current
    if (!c) return
    resizeRef.current()
    const onResize = () => resizeRef.current()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(onResize) : null
    ro?.observe(c)
    window.addEventListener('resize', onResize)
    window.addEventListener('orientationchange', onResize)
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', onResize)
      window.removeEventListener('orientationchange', onResize)
    }
  }, [expanded])

  const point = (e) => {
    const r = canvasRef.current.getBoundingClientRect()
    if (startRef.current === null) startRef.current = e.timeStamp
    const v = view()
    const p = {
      x: +((e.clientX - r.left - v.ox) / v.k).toFixed(2),
      y: +((e.clientY - r.top - v.oy) / v.k).toFixed(2),
      t: +(e.timeStamp - startRef.current).toFixed(2),
      pressure: e.pointerType === 'mouse' ? 0.5 : +e.pressure.toFixed(3),
      tiltX: e.tiltX || 0,
      tiltY: e.tiltY || 0,
    }
    if (e.pointerType === 'pen' && typeof e.azimuthAngle === 'number' && typeof e.altitudeAngle === 'number') {
      p.azimuth = +(((e.azimuthAngle * 180) / Math.PI + 360) % 360).toFixed(2)
      p.altitude = +((e.altitudeAngle * 180) / Math.PI).toFixed(2)
    }
    return p
  }

  const down = (e) => {
    if (penOnly && e.pointerType !== 'pen') {
      setRejected(true)
      return
    }
    setRejected(false)
    setTouched(true)
    e.preventDefault()
    canvasRef.current.setPointerCapture(e.pointerId)
    drawingRef.current = true
    // A new signature takes the pad's current size as its coordinate frame.
    if (!strokesRef.current.length) frameRef.current = { ...sizeRef.current }
    strokesRef.current.push([point(e)])
  }

  const move = (e) => {
    if (!drawingRef.current) return
    e.preventDefault()
    const stroke = strokesRef.current[strokesRef.current.length - 1]
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e]
    const v = view()
    for (const ev of events.length ? events : [e]) {
      const p = point(ev)
      const last = stroke[stroke.length - 1]
      if (p.t <= last.t) continue
      segment(last, p, v)
      stroke.push(p)
    }
  }

  const changed = () => {
    setCount(strokesRef.current.reduce((a, s) => a + s.length, 0))
    onChange?.(strokesRef.current)
  }

  const up = () => {
    if (!drawingRef.current) return
    drawingRef.current = false
    changed()
  }

  const clear = () => {
    strokesRef.current = []
    startRef.current = null
    frameRef.current = null
    setCount(0)
    setTouched(false)
    redraw()
    onChange?.([])
  }

  const undo = () => {
    if (!strokesRef.current.length) return
    strokesRef.current.pop()
    if (!strokesRef.current.length) {
      startRef.current = null
      frameRef.current = null
      setTouched(false)
    }
    redraw()
    changed()
  }

  useImperativeHandle(ref, () => ({
    clear,
    getStrokes: () => strokesRef.current.map((s) => s.map((p) => ({ ...p }))),
    isEmpty: () => strokesRef.current.reduce((a, s) => a + s.length, 0) < 10,
  }))

  // Focus mode: lock page scroll, block pinch and double-tap zoom, Esc = Done.
  useEffect(() => {
    if (!expanded) return
    const html = document.documentElement
    const prev = [html.style.overflow, document.body.style.overflow]
    html.style.overflow = 'hidden'
    document.body.style.overflow = 'hidden'
    const stop = (e) => e.preventDefault()
    const multiTouch = (e) => e.touches && e.touches.length > 1 && e.preventDefault()
    const esc = (e) => e.key === 'Escape' && !confirmClear && setExpanded(false)
    document.addEventListener('gesturestart', stop, { passive: false }) // Safari pinch
    document.addEventListener('touchmove', multiTouch, { passive: false })
    document.addEventListener('dblclick', stop)
    window.addEventListener('keydown', esc)
    return () => {
      html.style.overflow = prev[0]
      document.body.style.overflow = prev[1]
      document.removeEventListener('gesturestart', stop)
      document.removeEventListener('touchmove', multiTouch)
      document.removeEventListener('dblclick', stop)
      window.removeEventListener('keydown', esc)
    }
  }, [expanded, confirmClear])

  const canvas = (
    <canvas
      ref={canvasRef}
      style={{ touchAction: 'none' }}
      className="absolute inset-0 block h-full w-full cursor-crosshair rounded-[inherit]"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onPointerLeave={up}
    />
  )
  // The signing line and the hint, sized to the pad.
  const guide = (big) => (
    <>
      <div className="pointer-events-none absolute inset-x-[6%] bottom-[22%] border-b-2 border-slate-200">
        <span className={`absolute -top-[1.1em] left-0 font-semibold text-slate-300 ${big ? 'text-[28px]' : 'text-[20px]'}`} aria-hidden="true">×</span>
      </div>
      {count === 0 && !touched && (
        <div className={`pointer-events-none absolute inset-x-0 bottom-[22%] flex justify-center pb-[6%] text-slate-400 ${big ? 'text-[22px]' : 'text-[17px]'}`}>
          Sign here {penOnly ? 'with the pen' : ''}
        </div>
      )}
    </>
  )
  const penToggle = onPenOnlyChange && (
    <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-[10px] px-2 text-[14px] font-medium text-ink">
      <input type="checkbox" className="h-5 w-5" checked={penOnly} onChange={(e) => onPenOnlyChange(e.target.checked)} />
      Pen-only
    </label>
  )
  const askClear = () => (strokesRef.current.length ? setConfirmClear(true) : clear())

  return (
    <div>
      {!expanded && (
        <div className={`relative w-full rounded-[12px] border-2 border-dashed border-[#cfd8e3] bg-white ${PAD_HEIGHT_CLASS}`}>
          {canvas}
          {guide(false)}
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="absolute right-2 top-2 flex h-11 w-11 items-center justify-center rounded-[10px] border border-line bg-white/90 text-[#3b4a5e] shadow-sm transition-colors hover:bg-slate-50 hover:text-ink focus-visible:outline-2 focus-visible:outline-brand-600"
            aria-label="Expand the signing pad to full screen"
            title="Expand"
          >
            <Maximize2 className="h-5 w-5" />
          </button>
        </div>
      )}
      {expanded && (
        <div className={`flex w-full items-center justify-center rounded-[12px] border-2 border-dashed border-[#cfd8e3] bg-slate-50 text-[14px] text-muted ${PAD_HEIGHT_CLASS}`}>
          Signing in full screen…
        </div>
      )}
      <div className="mt-1 flex justify-between gap-3 text-xs text-slate-500">
        <span>{count} points captured</span>
        {rejected && <span className="text-amber-600">Pen-only mode: finger and mouse input are ignored.</span>}
      </div>

      {expanded && createPortal(
        <div
          className="fixed inset-0 z-[45] flex flex-col bg-white"
          style={{ touchAction: 'none', overscrollBehavior: 'none', height: '100dvh' }}
          role="dialog"
          aria-modal="true"
          aria-label="Signing pad, full screen"
        >
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-3 py-1.5 sm:gap-3 sm:px-4" style={{ paddingTop: 'max(0.375rem, env(safe-area-inset-top))' }}>
            {/* A visible way out (Done and Esc do the same); the strokes are kept. */}
            <Button variant="secondary" className="min-h-11" onClick={() => setExpanded(false)} aria-label="Exit full screen (keeps the signature)">
              <Minimize2 className="h-4 w-4" /> <span className="hidden sm:inline">Exit full screen</span>
            </Button>
            <span className="mr-auto truncate font-mono text-[14px] font-semibold text-ink">{label}</span>
            {rejected && <span className="text-[13px] text-amber-600">Pen only: finger and mouse are ignored.</span>}
            {penToggle}
            <Button variant="secondary" className="min-h-11" onClick={undo} disabled={!count}>
              <Undo2 className="h-4 w-4" /> Undo last stroke
            </Button>
            <Button variant="secondary" className="min-h-11" onClick={askClear} disabled={!count}>Clear</Button>
            <Button className="min-h-11 min-w-[88px]" onClick={() => setExpanded(false)}>Done</Button>
          </div>
          <div className="relative min-h-0 flex-1 bg-white" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
            {canvas}
            {guide(true)}
          </div>
          <div className="shrink-0 px-4 pb-2 text-[12.5px] text-muted">{count} points captured</div>
        </div>,
        document.body,
      )}
      <ConfirmDialog
        open={confirmClear}
        title="Clear the signature?"
        confirmLabel="Clear"
        danger
        onConfirm={() => clear()}
        onClose={() => setConfirmClear(false)}
      >
        The strokes on the pad will be removed.
      </ConfirmDialog>
    </div>
  )
})

export default SignaturePad
