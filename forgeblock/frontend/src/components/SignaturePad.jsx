import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'

// Captures a live signature with the Pointer Events API (Section 3.4.2).
// Each stroke is a list of {x, y, t, pressure, tiltX, tiltY, azimuth?,
// altitude?}; t is ms since the first touch, azimuth/altitude are the pen
// angles in degrees (only when the browser reports them, e.g. Apple Pencil). Coalesced events are used so Apple Pencil's high sampling
// rate is kept.
const SignaturePad = forwardRef(function SignaturePad({ height = 220, penOnly = false, onChange }, ref) {
  const canvasRef = useRef(null)
  const strokesRef = useRef([])
  const drawingRef = useRef(false)
  const startRef = useRef(null)
  const [count, setCount] = useState(0)
  const [rejected, setRejected] = useState(false)

  const ctx = () => canvasRef.current.getContext('2d')

  const resize = useCallback(() => {
    const c = canvasRef.current
    const ratio = window.devicePixelRatio || 1
    const { width } = c.getBoundingClientRect()
    c.width = width * ratio
    c.height = height * ratio
    const g = ctx()
    g.scale(ratio, ratio)
    g.lineCap = 'round'
    g.lineJoin = 'round'
    g.strokeStyle = '#0c3b5e'
    redraw()
  }, [height])

  const redraw = () => {
    const c = canvasRef.current
    const g = ctx()
    g.clearRect(0, 0, c.width, c.height)
    for (const s of strokesRef.current) {
      for (let i = 1; i < s.length; i++) segment(s[i - 1], s[i])
    }
  }

  const segment = (a, b) => {
    const g = ctx()
    g.lineWidth = 1.2 + 2.4 * (b.pressure || 0.5)
    g.beginPath()
    g.moveTo(a.x, a.y)
    g.lineTo(b.x, b.y)
    g.stroke()
  }

  useEffect(() => {
    resize()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [resize])

  const point = (e) => {
    const r = canvasRef.current.getBoundingClientRect()
    if (startRef.current === null) startRef.current = e.timeStamp
    const p = {
      x: +(e.clientX - r.left).toFixed(2),
      y: +(e.clientY - r.top).toFixed(2),
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
    e.preventDefault()
    canvasRef.current.setPointerCapture(e.pointerId)
    drawingRef.current = true
    strokesRef.current.push([point(e)])
  }

  const move = (e) => {
    if (!drawingRef.current) return
    e.preventDefault()
    const stroke = strokesRef.current[strokesRef.current.length - 1]
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e]
    for (const ev of events.length ? events : [e]) {
      const p = point(ev)
      const last = stroke[stroke.length - 1]
      if (p.t <= last.t) continue
      segment(last, p)
      stroke.push(p)
    }
  }

  const up = () => {
    if (!drawingRef.current) return
    drawingRef.current = false
    const n = strokesRef.current.reduce((a, s) => a + s.length, 0)
    setCount(n)
    onChange?.(strokesRef.current)
  }

  useImperativeHandle(ref, () => ({
    clear() {
      strokesRef.current = []
      startRef.current = null
      setCount(0)
      redraw()
      onChange?.([])
    },
    getStrokes: () => strokesRef.current.map((s) => s.map((p) => ({ ...p }))),
    isEmpty: () => strokesRef.current.reduce((a, s) => a + s.length, 0) < 10,
  }))

  return (
    <div>
      <div className="relative rounded-xl border-2 border-dashed border-slate-300 bg-white">
        <canvas
          ref={canvasRef}
          style={{ height, touchAction: 'none' }}
          className="block w-full cursor-crosshair rounded-xl"
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          onPointerLeave={up}
        />
        <div className="pointer-events-none absolute inset-x-8 bottom-10 border-b border-slate-200" />
        {count === 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-slate-400">
            Sign here {penOnly ? 'with the pen' : ''}
          </div>
        )}
      </div>
      <div className="mt-1 flex justify-between text-xs text-slate-500">
        <span>{count} points captured</span>
        {rejected && <span className="text-amber-600">Pen-only mode: finger and mouse input are ignored.</span>}
      </div>
    </div>
  )
})

export default SignaturePad
