import { Link } from 'react-router-dom'
import { useState } from 'react'

// Status colours for screening results (always shown with a label).
export const RESULT_COLORS = { consistent: '#107c10', inconclusive: '#e8a317', inconsistent: '#c50f1f' }
const RESULT_LABELS = { consistent: 'Consistent', inconclusive: 'Inconclusive', inconsistent: 'Inconsistent' }

export function Legend({ items }) {
  return (
    <div className="flex flex-wrap gap-4 text-xs text-slate-600">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  )
}

// Screenings per day, stacked by screening result, with a hover tooltip.
export function StackedDays({ series, height = 180 }) {
  const [hover, setHover] = useState(null)
  const keys = ['consistent', 'inconclusive', 'inconsistent']
  const max = Math.max(1, ...series.map((d) => d.total))
  const W = 640
  const H = height
  const pad = { l: 28, r: 8, t: 8, b: 22 }
  const bw = (W - pad.l - pad.r) / series.length
  const y = (v) => pad.t + (H - pad.t - pad.b) * (1 - v / max)
  const ticks = [0, Math.ceil(max / 2), max]
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Screenings per day by result">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="#e2e8f0" />
            <text x={pad.l - 6} y={y(t) + 3} textAnchor="end" fontSize="10" fill="#64748b">{t}</text>
          </g>
        ))}
        {series.map((d, i) => {
          let acc = 0
          const x = pad.l + i * bw + bw * 0.18
          const w = bw * 0.64
          return (
            <g key={d.date} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={pad.l + i * bw} y={pad.t} width={bw} height={H - pad.t - pad.b} fill={hover === i ? '#f1f5f9' : 'transparent'} />
              {keys.map((k) => {
                if (!d[k]) return null
                const y0 = y(acc)
                acc += d[k]
                const y1 = y(acc)
                return <rect key={k} x={x} y={y1 + 1} width={w} height={Math.max(0, y0 - y1 - 2)} rx="2" fill={RESULT_COLORS[k]} />
              })}
              {(i % Math.ceil(series.length / 7) === 0 || i === series.length - 1) && (
                <text x={pad.l + i * bw + bw / 2} y={H - 6} textAnchor="middle" fontSize="10" fill="#64748b">
                  {d.date.slice(5)}
                </text>
              )}
            </g>
          )
        })}
      </svg>
      {hover !== null && (
        <div className="pointer-events-none absolute top-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-md" style={{ left: `${((hover + 0.5) / series.length) * 100}%`, transform: 'translateX(-50%)' }}>
          <div className="font-medium">{series[hover].date}</div>
          {keys.map((k) => (
            <div key={k} className="flex items-center gap-1.5 text-slate-600">
              <span className="h-2 w-2 rounded-sm" style={{ background: RESULT_COLORS[k] }} /> {RESULT_LABELS[k]}: {series[hover][k]}
            </div>
          ))}
        </div>
      )}
      <div className="mt-2">
        <Legend items={keys.map((k) => ({ label: RESULT_LABELS[k], color: RESULT_COLORS[k] }))} />
      </div>
    </div>
  )
}

// Horizontal bars with labels (single series, no legend needed).
export function HBars({ rows, color = '#0f6cbd' }) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  return (
    <div className="space-y-2">
      {rows.map((r) => {
        const inner = (
          <>
            <span className={`truncate ${r.to ? 'text-brand-700 group-hover:underline' : 'text-slate-600'}`}>{r.label}</span>
            <div className="h-2.5 rounded-full bg-slate-100">
              <div className="h-full rounded-full" style={{ width: `${(r.value / max) * 100}%`, background: r.color || color }} />
            </div>
            <span className="text-right tabular-nums text-slate-700">{r.value}</span>
          </>
        )
        const cls = 'grid grid-cols-[120px_1fr_40px] items-center gap-3 text-sm'
        return r.to ? (
          <Link key={r.label} to={r.to} className={`group -mx-1.5 rounded-md px-1.5 py-0.5 transition-colors hover:bg-slate-50 ${cls}`} title={`${r.label}: ${r.value}. Open these records`}>{inner}</Link>
        ) : (
          <div key={r.label} className={cls} title={`${r.label}: ${r.value}`}>{inner}</div>
        )
      })}
    </div>
  )
}

// FAR and FRR against a cosine threshold, with a crosshair at the chosen value.
export function RateCurves({ points, threshold, onPick }) {
  const W = 640
  const H = 220
  const pad = { l: 36, r: 10, t: 10, b: 26 }
  const xs = points.map((p) => p.cosine)
  const lo = Math.max(0, Math.min(...xs, 0.5) - 0.05)
  const hi = 1
  const X = (v) => pad.l + ((v - lo) / (hi - lo)) * (W - pad.l - pad.r)
  const Y = (v) => pad.t + (1 - v) * (H - pad.t - pad.b)
  const gen = points.filter((p) => p.label === 'genuine').map((p) => p.cosine)
  const forg = points.filter((p) => p.label === 'forged').map((p) => p.cosine)
  const steps = Array.from({ length: 101 }, (_, i) => lo + ((hi - lo) * i) / 100)
  const far = steps.map((t) => (forg.length ? forg.filter((c) => c >= t).length / forg.length : 0))
  const frr = steps.map((t) => (gen.length ? gen.filter((c) => c < t).length / gen.length : 0))
  const path = (vals) => vals.map((v, i) => `${i ? 'L' : 'M'}${X(steps[i]).toFixed(1)},${Y(v).toFixed(1)}`).join('')
  const pick = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    const v = lo + (((e.clientX - r.left) / r.width) * W - pad.l) / (W - pad.l - pad.r) * (hi - lo)
    onPick?.(Math.min(hi, Math.max(lo, v)))
  }
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full cursor-crosshair" onClick={pick} role="img" aria-label="False acceptance and false rejection rates by threshold">
        {[0, 0.5, 1].map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={Y(t)} y2={Y(t)} stroke="#e2e8f0" />
            <text x={pad.l - 6} y={Y(t) + 3} textAnchor="end" fontSize="10" fill="#64748b">{t * 100}%</text>
          </g>
        ))}
        {[lo, (lo + hi) / 2, hi].map((t) => (
          <text key={t} x={X(t)} y={H - 8} textAnchor="middle" fontSize="10" fill="#64748b">{t.toFixed(2)}</text>
        ))}
        <path d={path(far)} fill="none" stroke="#0f6cbd" strokeWidth="2" />
        <path d={path(frr)} fill="none" stroke="#bc4b09" strokeWidth="2" />
        <line x1={X(threshold)} x2={X(threshold)} y1={pad.t} y2={H - pad.b} stroke="#0f172a" strokeDasharray="3 3" />
      </svg>
      <Legend items={[{ label: 'FAR: forgeries accepted', color: '#0f6cbd' }, { label: 'FRR: genuine rejected', color: '#bc4b09' }]} />
    </div>
  )
}
