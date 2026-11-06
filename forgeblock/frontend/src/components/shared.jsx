import { useEffect, useState } from 'react'
import { api } from '../api'
import { useAuth } from '../auth'
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

// Shown on dynamic signing pads when the server accepts development pens
// without tilt (DEV_PEN_DEVICES), e.g. a Wacom One CTL-472.
export function DevPenNotice() {
  const { user } = useAuth()
  if (!user?.dev_pen_devices) return null
  return (
    <Alert kind="warn">
      Development pen mode is on. A pen without tilt (such as a Wacom One) is accepted, but results are less accurate, are marked "Development
      device", are compared only with development-device references and are left out of the evaluation figures. Use the Apple Pencil for real
      signatures.
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
  const [clients, setClients] = useState([])
  useEffect(() => {
    api.get('/api/clients').then(setClients).catch(() => setClients([]))
  }, [])
  const chosen = clients.find((c) => String(c.id) === String(value))
  const strength = chosen && (modality === 'dynamic' ? chosen.dynamic_strength : chosen.static_strength)
  return (
    <Field
      label="Client on file"
      hint={chosen ? strength.note : 'The questioned signature is screened against this client’s references.'}
    >
      <div className="flex items-center gap-2">
        <Select value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">Choose a client…</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.full_name} ({c.client_code}) · {modality === 'dynamic' ? c.dynamic_count : c.static_count} refs
            </option>
          ))}
        </Select>
        {strength && <StrengthBadge strength={strength} />}
      </div>
    </Field>
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

