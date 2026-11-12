import { CalendarDays, ChevronDown } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

// One "Date range" control: a button with the current range that opens a popover
// with presets and a from/to picker for Custom. Values are 'YYYY-MM-DD' strings
// ('' = open-ended), the same format as the API's date_from / date_to.
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const parse = (s) => {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}
const daysAgo = (n) => {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return iso(d)
}

const PRESETS = [
  { key: 'today', label: 'Today', range: () => [iso(new Date()), iso(new Date())] },
  { key: '7', label: 'Last 7 days', range: () => [daysAgo(6), iso(new Date())] },
  { key: '30', label: 'Last 30 days', range: () => [daysAgo(29), iso(new Date())] },
  { key: 'month', label: 'This month', range: () => { const d = new Date(); return [iso(new Date(d.getFullYear(), d.getMonth(), 1)), iso(d)] } },
]

export function rangeLabel(from, to) {
  if (!from && !to) return 'Any date'
  const now = new Date().getFullYear()
  const f = from && parse(from)
  const t = to && parse(to)
  const fmt = (d, year) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(year && { year: 'numeric' }) })
  if (f && t) {
    const sameYear = f.getFullYear() === t.getFullYear()
    if (from === to) return fmt(f, true)
    return `${fmt(f, !sameYear)} – ${fmt(t, true)}`
  }
  if (f) return `From ${fmt(f, f.getFullYear() !== now)}`
  return `Until ${fmt(t, t.getFullYear() !== now)}`
}

export default function DateRange({ from, to, onChange, className = '' }) {
  const [open, setOpen] = useState(false)
  const [custom, setCustom] = useState(false)
  const ref = useRef(null)
  const active = PRESETS.find((p) => { const [a, b] = p.range(); return a === from && b === to })
  useEffect(() => {
    if (!open) return
    const close = (e) => !ref.current?.contains(e.target) && setOpen(false)
    const esc = (e) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', esc)
    }
  }, [open])
  useEffect(() => {
    if (open) setCustom(!!(from || to) && !active)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
  const item = (on) => `w-full rounded-lg px-3 py-1.5 text-left text-sm transition ${on ? 'bg-brand-50 font-medium text-brand-700' : 'text-slate-700 hover:bg-slate-100'}`
  const dateInput = 'w-full min-w-0 rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-brand-600'
  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`flex w-full items-center gap-2 rounded-xl border bg-white px-3 py-2 text-left text-sm transition hover:border-slate-400 ${from || to ? 'border-brand-300 text-slate-900' : 'border-slate-300 text-slate-600'}`}
      >
        <CalendarDays className="h-4 w-4 shrink-0 text-slate-400" />
        <span className="min-w-0 flex-1 truncate font-medium">{rangeLabel(from, to)}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div role="dialog" aria-label="Date range" className="absolute right-0 z-40 mt-1 w-64 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl sm:left-0 sm:right-auto">
          <button type="button" className={item(!from && !to && !custom)} onClick={() => { onChange('', ''); setOpen(false) }}>Any date</button>
          {PRESETS.map((p) => (
            <button key={p.key} type="button" className={item(active?.key === p.key && !custom)} onClick={() => { const [a, b] = p.range(); onChange(a, b); setOpen(false) }}>{p.label}</button>
          ))}
          <button type="button" className={item(custom)} onClick={() => setCustom(true)}>Custom…</button>
          {custom && (
            <div className="mt-1 grid grid-cols-2 gap-2 border-t border-slate-100 p-1.5 pt-2.5">
              <label className="text-xs text-slate-500">From
                <input type="date" value={from} max={to || undefined} onChange={(e) => onChange(e.target.value, to)} className={dateInput} />
              </label>
              <label className="text-xs text-slate-500">To
                <input type="date" value={to} min={from || undefined} onChange={(e) => onChange(from, e.target.value)} className={dateInput} />
              </label>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
