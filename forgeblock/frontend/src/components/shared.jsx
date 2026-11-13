import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { Combobox } from './Combobox'
import { LIMITED_PEN_LABEL, penMissing, penWords } from './penData'
import { Alert, Field, Select, StrengthBadge } from './ui'

// Image served by an authenticated endpoint (viewed in the app only).
export function AuthImage({ src, className, alt = '' }) {
  const [url, setUrl] = useState(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let u
    let cancelled = false
    setUrl(null)
    setFailed(false)
    api
      .raw(src)
      .then(async (res) => {
        const b = await res.blob()
        if (!cancelled) setUrl((u = URL.createObjectURL(b)))
      })
      .catch(() => !cancelled && setFailed(true))
    return () => {
      cancelled = true
      if (u) URL.revokeObjectURL(u)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src])
  if (failed) return <div className={`${className} flex items-center justify-center bg-slate-50 text-xs text-slate-400`}>Not available</div>
  return url ? (
    <img src={url} alt={alt} className={className} draggable={false} onContextMenu={(e) => e.preventDefault()} />
  ) : (
    <div className={`${className} animate-pulse bg-slate-100`} />
  )
}

// v8.11: dynamic signatures without pen pressure or tilt (finger, mouse, a
// stylus that is not an Apple Pencil) are accepted and labelled "Limited pen
// data"; the comparison leaves out what either signature lacks.
export function LimitedPenBadge({ missing, className = '' }) {
  return (
    <span
      title={missing?.length ? `No ${penWords(missing)} recorded` : 'No pen pressure or tilt recorded'}
      className={`inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[11.5px] font-medium text-amber-800 ring-1 ring-inset ring-amber-200 ${className}`}
    >
      {LIMITED_PEN_LABEL}
    </span>
  )
}

// Shown above dynamic signing pads.
export function DevPenNotice() {
  return (
    <Alert kind="info">
      Use the Apple Pencil for the most reliable results. Signatures made with a finger, a mouse or another pen are accepted, but they have
      no pen pressure or tilt: they are labelled "{LIMITED_PEN_LABEL}" and compared on shape and timing only.
    </Alert>
  )
}

// After signing: tells the user right away that this signature lacks pen data.
export function PenDataHint({ strokes }) {
  const missing = penMissing(strokes)
  if (!strokes?.length || !missing.length) return null
  return (
    <Alert kind="warn">
      This signature has no {penWords(missing)}: the pen or finger used did not record it. It will still be accepted and labelled
      "{LIMITED_PEN_LABEL}".
    </Alert>
  )
}

// Draws saved strokes as a small SVG preview.
export function StrokePreview({ strokes, className = 'h-16 w-40', color = '#0c3b5e' }) {
  const pts = (strokes || []).flat()
  if (!pts.length) return null
  const xs = pts.map((p) => p.x)
  const ys = pts.map((p) => p.y)
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  const w = Math.max(...xs) - minX || 1
  const h = Math.max(...ys) - minY || 1
  return (
    <svg viewBox={`${minX - 5} ${minY - 5} ${w + 10} ${h + 10}`} className={className} preserveAspectRatio="xMidYMid meet">
      {strokes.map((s, i) => (
        <polyline key={i} points={s.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke={color} strokeWidth={Math.max(w, h) / 80} strokeLinecap="round" strokeLinejoin="round" />
      ))}
    </svg>
  )
}

// Picks a client on file; shows the threshold strength for the chosen module.
export function ClientPicker({ value, onChange, modality }) {
  const [clients, setClients] = useState(null)
  useEffect(() => {
    api.get('/api/clients').then(setClients).catch(() => setClients([]))
  }, [])
  const chosen = clients?.find((c) => String(c.id) === String(value))
  const strength = chosen && (modality === 'dynamic' ? chosen.dynamic_strength : chosen.static_strength)
  // Searchable list: name on top, code, group and reference count underneath.
  // Groups show as tabs at the top of the list (All, then each group A-Z).
  const options = useMemo(
    () =>
      [...(clients || [])]
        .sort((x, y) => x.full_name.localeCompare(y.full_name))
        .map((c) => {
          const n = modality === 'dynamic' ? c.dynamic_count : c.static_count
          return {
            value: c.id,
            label: c.full_name,
            sub: [c.client_code, c.group_name || 'No group', `${n} ref${n === 1 ? '' : 's'}`].join(' · '),
            keywords: `${c.client_code} ${c.group_name || ''}`,
            group: c.group_id ? String(c.group_id) : 'none',
          }
        }),
    [clients, modality],
  )
  const tabs = useMemo(() => {
    const seen = new Map()
    for (const c of clients || []) seen.set(c.group_id ? String(c.group_id) : 'none', c.group_name || 'No group')
    if (seen.size < 2) return undefined // one group: tabs add nothing
    return [...seen]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => (a.value === 'none') - (b.value === 'none') || a.label.localeCompare(b.label))
  }, [clients])
  return (
    // A div, not Field's <label>: a label would turn clicks inside the open list into toggles.
    <div>
      <span className="mb-1 block text-sm font-medium text-slate-800">Client on file</span>
      <div className="flex items-center gap-2">
        <Combobox
          field
          label="Client on file"
          anyLabel={clients === null ? 'Loading clients…' : 'Choose a client…'}
          placeholder="Search by name or code…"
          value={value}
          onChange={onChange}
          options={options}
          tabs={tabs}
          tabsLabel="by group"
          className="min-w-0 flex-1"
        />
        {strength && <StrengthBadge strength={strength} />}
      </div>
      <span className="mt-1 block text-xs text-slate-500">{chosen ? strength.note : 'The questioned signature is screened against this client’s references.'}</span>
    </div>
  )
}

export function CasePicker({ clientId, value, onChange }) {
  const [cases, setCases] = useState([])
  useEffect(() => {
    if (!clientId) return setCases([])
    api.get(`/api/cases?scope=all&client_id=${clientId}`).then((cs) => setCases(cs.filter((c) => c.status === 'open'))).catch(() => setCases([]))
  }, [clientId])
  return (
    <Field label="Case (optional)" hint="Leave empty: a case opens by itself if the result is not clearly Consistent.">
      <Select value={value} onChange={(e) => onChange(e.target.value)} disabled={!clientId}>
        <option value="">No case yet</option>
        {cases.map((c) => (
          <option key={c.id} value={c.id}>
            {c.case_code} · {c.title}
          </option>
        ))}
      </Select>
    </Field>
  )
}

