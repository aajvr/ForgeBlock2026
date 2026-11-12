import { Pause, Play, RotateCcw } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

// Pressure 0..1 -> colour from light blue (light) to deep red (heavy).
function pressureColor(p) {
  const stops = [
    [0, [120, 180, 245]],
    [0.35, [15, 108, 189]],
    [0.65, [188, 75, 9]],
    [1, [197, 15, 31]],
  ]
  const v = Math.min(1, Math.max(0, p))
  for (let i = 1; i < stops.length; i++) {
    if (v <= stops[i][0]) {
      const [a, ca] = stops[i - 1]
      const [b, cb] = stops[i]
      const t = (v - a) / (b - a)
      return `rgb(${ca.map((c, k) => Math.round(c + (cb[k] - c) * t)).join(',')})`
    }
  }
  return 'rgb(197,15,31)'
}

// Animated replay of a dynamic signature, coloured by pen pressure.
export default function StrokeReplay({ strokes, title, height = 180, speed = 1, playing, onEnd }) {
  const canvasRef = useRef(null)
  const frame = useRef(null)
  const [progress, setProgress] = useState(1)

  const pts = (strokes || []).flatMap((s, si) => s.map((p, pi) => ({ ...p, si, first: pi === 0 })))
  const t0 = pts.length ? pts[0].t : 0
  const t1 = pts.length ? pts[pts.length - 1].t : 1
  const hasPressure = pts.some((p) => p.pressure && p.pressure !== 0.5)

  const draw = useCallback(
    (upTo) => {
      const c = canvasRef.current
      if (!c || !pts.length) return
      const ratio = window.devicePixelRatio || 1
      const W = c.getBoundingClientRect().width
      c.width = W * ratio
      c.height = height * ratio
      const g = c.getContext('2d')
      g.scale(ratio, ratio)
      g.clearRect(0, 0, W, height)
      const xs = pts.map((p) => p.x)
      const ys = pts.map((p) => p.y)
      const minX = Math.min(...xs)
      const minY = Math.min(...ys)
      const w = Math.max(...xs) - minX || 1
      const h = Math.max(...ys) - minY || 1
      const s = Math.min((W - 24) / w, (height - 24) / h)
      const ox = (W - w * s) / 2
      const oy = (height - h * s) / 2
      const X = (p) => ox + (p.x - minX) * s
      const Y = (p) => oy + (p.y - minY) * s
      g.lineCap = 'round'
      g.lineJoin = 'round'
      const limit = t0 + (t1 - t0) * upTo
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1]
        const b = pts[i]
        if (b.t > limit) break
        if (b.first) continue
        const p = hasPressure ? b.pressure : 0.45
        g.strokeStyle = hasPressure ? pressureColor(p) : '#0c3b5e'
        g.lineWidth = 1 + 3.2 * p
        g.beginPath()
        g.moveTo(X(a), Y(a))
        g.lineTo(X(b), Y(b))
        g.stroke()
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [strokes, height],
  )

  useEffect(() => draw(progress), [draw, progress])

  useEffect(() => {
    if (!playing || !pts.length) return
    const duration = (t1 - t0) / speed
    const start = performance.now()
    const step = (now) => {
      const p = Math.min(1, (now - start) / Math.max(duration, 1))
      setProgress(p)
      if (p < 1) frame.current = requestAnimationFrame(step)
      else onEnd?.()
    }
    frame.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, strokes, speed])

  return (
    <div>
      {title && <div className="mb-1 text-xs font-medium text-slate-500">{title}</div>}
      <div className="rounded-[12px] border border-line bg-white">
        <canvas ref={canvasRef} style={{ height }} className="block w-full" />
      </div>
      <div className="mt-1 flex justify-between text-[12.5px] text-slate-400">
        <span>{((t1 - t0) / 1000).toFixed(2)} s · {strokes?.length || 0} stroke(s)</span>
        {!hasPressure && <span>No pressure recorded</span>}
      </div>
    </div>
  )
}

export function ReplayControls({ playing, setPlaying, speed, setSpeed, onRestart }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button onClick={() => setPlaying(!playing)} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700">
        {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />} {playing ? 'Pause' : 'Replay'}
      </button>
      <button onClick={onRestart} className="inline-flex items-center gap-1.5 rounded-[8px] border border-[#dde3ec] bg-white px-3 py-1.5 text-xs font-semibold text-[#3b4a5e] hover:bg-slate-50">
        <RotateCcw className="h-3.5 w-3.5" /> Show full
      </button>
      <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} aria-label="Replay speed" className="rounded-[8px] border border-[#dde3ec] bg-white px-2 py-1.5 text-xs outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-100">
        <option value={0.5}>0.5× speed</option>
        <option value={1}>1× (real time)</option>
        <option value={2}>2× speed</option>
      </select>
      <span className="ml-2 flex items-center gap-1 text-[12.5px] text-slate-500">
        Pressure
        <span className="h-2 w-24 rounded-full" style={{ background: 'linear-gradient(90deg,#78b4f5,#0f6cbd,#bc4b09,#c50f1f)' }} />
        light → heavy
      </span>
    </div>
  )
}
