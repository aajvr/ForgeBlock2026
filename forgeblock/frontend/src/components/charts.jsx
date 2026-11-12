import { Link } from 'react-router-dom'
import { useState } from 'react'

// Result colours (v3, the same for every role; always shown with a label).
export const RESULT_COLORS = { consistent: '#0f6cbd', inconclusive: '#e8950c', inconsistent: '#d13438' }
const RESULT_LABELS = { consistent: 'Consistent', inconclusive: 'Inconclusive', inconsistent: 'Inconsistent' }
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function Legend({ items }) {
  return (
    <div className="flex flex-wrap gap-x-[18px] gap-y-1 text-[12.5px] text-[#4b5a6e]">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5">
          <span className="h-[9px] w-[9px] rounded-[3px]" style={{ background: i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  )
}

// A round step for the y axis, so the gridlines land on 1, 2, 5, 10, 20, 50 ...
function niceStep(max) {
  const raw = Math.max(1, max / 3)
  const mag = 10 ** Math.floor(Math.log10(raw))
  return [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw)
}

// "2026-11-01" -> "Nov 1"; other days just "2". The month shows on the first label and when it changes.
function dayLabel(date, prevShown) {
  const [, m, d] = date.split('-').map(Number)
  const newMonth = !prevShown || prevShown.split('-')[1] !== date.split('-')[1]
  return newMonth ? `${MONTHS[m - 1]} ${d}` : String(d)
}

// Screenings per day, stacked by screening result (v3): solid rounded bars,
// light gridlines, legend chips and a dark tooltip. Each day can be focused
// with the keyboard and reads out its counts.
export function StackedDays({ series, height = 224 }) {
  const [hover, setHover] = useState(null)
  const keys = ['consistent', 'inconclusive', 'inconsistent']
  const max = Math.max(1, ...series.map((d) => d.total))
  const step = niceStep(max)
  const top = Math.ceil(max / step) * step
  const ticks = Array.from({ length: top / step + 1 }, (_, i) => i * step)
  const every = series.length > 16 ? 3 : 1
  let prevShown = null
  const labels = series.map((d, i) => {
    if (i % every !== 0) return ''
    const l = dayLabel(d.date, prevShown)
    prevShown = d.date
    return l
  })
  const say = (d) => `${d.date}: ${keys.map((k) => `${d[k]} ${RESULT_LABELS[k].toLowerCase()}`).join(', ')}`
  return (
    <div>
      <Legend items={keys.map((k) => ({ label: RESULT_LABELS[k], color: RESULT_COLORS[k] }))} />
      <div className="relative mt-4 flex" role="group" aria-label="Screenings per day by result">
        {/* y axis */}
        <div className="relative w-8 shrink-0 text-[11px] text-[#94a0b2]" style={{ height }} aria-hidden="true">
          {ticks.map((t) => (
            <span key={t} className="absolute right-2.5 -translate-y-1/2 tabular-nums" style={{ top: `${(1 - t / top) * 100}%` }}>{t}</span>
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <div className="relative" style={{ height }}>
            {ticks.map((t) => (
              <span key={t} className="absolute inset-x-0 h-px bg-track" style={{ top: `${(1 - t / top) * 100}%` }} aria-hidden="true" />
            ))}
            <div className="absolute inset-0 flex items-end gap-[3%] px-1 sm:gap-2">
              {series.map((d, i) => (
                <div
                  key={d.date}
                  tabIndex={0}
                  aria-label={say(d)}
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                  className="flex h-full min-w-0 flex-1 cursor-default items-end justify-center rounded-md outline-none focus-visible:bg-brand-50"
                >
                  <div
                    className={`flex w-full max-w-[24px] flex-col-reverse gap-[2px] transition-shadow ${hover === i ? 'rounded-[6px] shadow-[0_0_0_3px_rgb(15_108_189/0.18)]' : ''}`}
                    style={{ height: `${(d.total / top) * 100}%` }}
                  >
                    {keys.map((k) => (d[k] ? (
                      <span key={k} className="block min-h-[3px] rounded-[3px] first:rounded-b-[3px] last:rounded-t-[6px]" style={{ flexGrow: d[k], background: RESULT_COLORS[k] }} />
                    ) : null))}
                  </div>
                </div>
              ))}
            </div>
            {hover !== null && (
              <div
                className="pointer-events-none absolute bottom-full z-10 mb-[-24px] flex -translate-x-1/2 flex-col gap-[3px] whitespace-nowrap rounded-[10px] px-[13px] py-2.5 text-[12px] text-white shadow-[0_10px_24px_rgb(12_59_94/0.3)]"
                style={{
                  background: 'var(--role-active)',
                  left: `clamp(70px, ${((hover + 0.5) / series.length) * 100}%, calc(100% - 70px))`,
                }}
                aria-hidden="true"
              >
                <b className="text-[13px] font-semibold">{dayLabel(series[hover].date, null)}</b>
                {keys.map((k) => (
                  <span key={k} className="flex items-center">
                    <i className="mr-1.5 inline-block h-[9px] w-[9px] rounded-[3px]" style={{ background: RESULT_COLORS[k] }} />
                    {series[hover][k]} {RESULT_LABELS[k].toLowerCase()}
                  </span>
                ))}
              </div>
            )}
          </div>
          {/* x axis */}
          <div className="mt-2 flex gap-[3%] px-1 sm:gap-2" aria-hidden="true">
            {labels.map((l, i) => (
              <span key={series[i].date} className="min-w-0 flex-1 overflow-visible whitespace-nowrap text-center text-[10.5px] text-[#94a0b2]">{l}</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// Horizontal bars (v3): an optional icon bubble, the label and count on one line,
// and a thin bar under them. With `to` the row links to the matching records.
// rows: [{ label, value, color, to, icon, tint }]
export function HBars({ rows, color = '#0f6cbd' }) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  return (
    <div className="space-y-1">
      {rows.map((r) => {
        const Icon = r.icon
        const inner = (
          <>
            {Icon && (
              <span className={`flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] ${r.tint || 'bg-brand-50 text-brand-600'}`}>
                <Icon className="h-4 w-4" aria-hidden="true" />
              </span>
            )}
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-3 text-[13.5px]">
                <span className={`truncate text-ink ${r.to ? 'group-hover:text-brand-700 group-hover:underline' : ''}`}>{r.label}</span>
                <b className="font-semibold tabular-nums text-ink">{r.value}</b>
              </span>
              <span className="mt-1.5 block h-[7px] overflow-hidden rounded-full bg-track">
                <span className="block h-full rounded-full" style={{ width: `${(r.value / max) * 100}%`, background: r.color || color }} />
              </span>
            </span>
          </>
        )
        const cls = 'flex items-center gap-3 rounded-[10px] py-1.5'
        return r.to ? (
          <Link key={r.label} to={r.to} className={`group -mx-2 px-2 transition-colors hover:bg-[#f5f8fc] focus-visible:outline-2 focus-visible:outline-brand-600 ${cls}`} title={`${r.label}: ${r.value}. Open these records`}>{inner}</Link>
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
