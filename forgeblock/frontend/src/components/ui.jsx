import { CheckCircle2, ChevronRight, CircleAlert, CircleHelp, Info, Loader2, X, XCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

export function Card({ title, subtitle, actions, children, className = '', bodyClass = 'p-5', ...rest }) {
  return (
    <section className={`min-w-0 rounded-2xl border border-slate-200/70 bg-white shadow-soft ${className}`} {...rest}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
            {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
          </div>
          {actions}
        </header>
      )}
      <div className={bodyClass}>{children}</div>
    </section>
  )
}

const BUTTON_STYLES = {
  primary: 'bg-brand-600 text-white shadow-sm hover:bg-brand-700 hover:shadow-md disabled:bg-brand-300 disabled:shadow-none',
  secondary: 'border border-slate-300 bg-white text-slate-800 shadow-sm hover:border-slate-400 hover:bg-slate-50 disabled:text-slate-400',
  danger: 'bg-bad-600 text-white shadow-sm hover:bg-bad-700 hover:shadow-md disabled:opacity-50',
  ghost: 'text-slate-600 hover:bg-slate-100',
  subtle: 'bg-brand-50 text-brand-700 hover:bg-brand-100',
}

export function Button({ variant = 'primary', size = 'md', className = '', loading, children, ...props }) {
  const sz = size === 'sm' ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-sm'
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-xl font-medium transition active:scale-[0.98] disabled:cursor-not-allowed disabled:active:scale-100 ${sz} ${BUTTON_STYLES[variant]} ${className}`}
      disabled={loading || props.disabled}
      {...props}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  )
}

export function Field({ label, hint, children, className = '' }) {
  return (
    <label className={`block ${className}`}>
      {label && <span className="mb-1 block text-sm font-medium text-slate-800">{label}</span>}
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  )
}

export const inputClass =
  'w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition placeholder:text-slate-400 focus:border-brand-600 focus:ring-2 focus:ring-brand-100'

export function Input(props) {
  return <input className={inputClass} {...props} />
}

export function Textarea(props) {
  return <textarea className={`${inputClass} min-h-24`} {...props} />
}

export function Select({ children, ...props }) {
  return (
    <select className={inputClass} {...props}>
      {children}
    </select>
  )
}

export function Alert({ kind = 'error', children, className = '' }) {
  if (!children) return null
  const styles = {
    error: 'border-bad-100 bg-bad-50 text-bad-700',
    info: 'border-brand-100 bg-brand-50 text-brand-800',
    success: 'border-ok-100 bg-ok-50 text-ok-700',
    warn: 'border-warn-100 bg-warn-50 text-warn-700',
  }
  return <div className={`rounded-xl border px-4 py-3 text-sm ${styles[kind]} ${className}`}>{children}</div>
}

export function Badge({ children, tone = 'gray', className = '', title }) {
  const tones = {
    gray: 'bg-slate-100 text-slate-700 ring-slate-200',
    blue: 'bg-brand-50 text-brand-700 ring-brand-100',
    green: 'bg-ok-50 text-ok-700 ring-ok-100',
    amber: 'bg-warn-50 text-warn-700 ring-warn-100',
    red: 'bg-bad-50 text-bad-700 ring-bad-100',
    violet: 'bg-violet-50 text-violet-700 ring-violet-100',
  }
  return (
    <span title={title} className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${tones[tone]} ${className}`}>
      {children}
    </span>
  )
}

export const RESULT = {
  consistent: { label: 'Consistent', long: 'Consistent with references', tone: 'green', Icon: CheckCircle2, text: 'text-ok-600', bar: 'bg-ok-600', tint: 'border-ok-100 bg-gradient-to-br from-ok-100/80 via-ok-50 to-white' },
  inconclusive: { label: 'Inconclusive', long: 'Inconclusive, examiner review needed', tone: 'amber', Icon: CircleHelp, text: 'text-warn-600', bar: 'bg-warn-600', tint: 'border-warn-100 bg-gradient-to-br from-warn-100/80 via-warn-50 to-white' },
  inconsistent: { label: 'Inconsistent', long: 'Inconsistent, refer for examination', tone: 'red', Icon: XCircle, text: 'text-bad-600', bar: 'bg-bad-600', tint: 'border-bad-100 bg-gradient-to-br from-bad-100/80 via-bad-50 to-white' },
}

export function ScreeningBadge({ value, long }) {
  const r = RESULT[value]
  if (!r) return <span className="text-slate-400">-</span>
  return (
    <Badge tone={r.tone}>
      <r.Icon className="h-3.5 w-3.5" />
      {long ? r.long : r.label}
    </Badge>
  )
}

// The examiner's final finding. Only Genuine and Forged can be given; an
// Inconclusive finding may still appear on records made before v7.
export const FINDING = {
  genuine: { label: 'Genuine', tone: 'green' },
  forged: { label: 'Forged', tone: 'red' },
  inconclusive: { label: 'Inconclusive', tone: 'amber' },
}

export function FindingBadge({ value, prefix = 'Decided' }) {
  const f = FINDING[value]
  if (!f) return <span className="text-sm text-slate-400">No decision yet</span>
  return <Badge tone={f.tone}>{prefix ? `${prefix}: ` : ''}{f.label}</Badge>
}

export function Avatar({ name, role, size = 'h-9 w-9 text-sm' }) {
  const initials = (name || '?').split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()
  const tone = { admin: 'bg-indigo-100 text-indigo-800', client: 'bg-cyan-100 text-cyan-800' }[role] || 'bg-brand-100 text-brand-800'
  return <span className={`flex shrink-0 items-center justify-center rounded-full font-semibold ${size} ${tone}`}>{initials}</span>
}

const STAT_TILES = {
  brand: 'bg-brand-100 text-brand-700',
  amber: 'bg-warn-100 text-warn-700',
  green: 'bg-ok-100 text-ok-700',
  violet: 'bg-violet-100 text-violet-700',
  teal: 'bg-cyan-100 text-cyan-800',
  indigo: 'bg-indigo-100 text-indigo-800',
}

// A stat card. With `to` the whole card is a router link to the matching page.
export function Stat({ label, value, hint, icon: Icon, tone = 'brand', to, ariaLabel }) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-3 text-sm text-slate-500">
        {label}
        {Icon && (
          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${STAT_TILES[tone]}`}>
            <Icon className="h-5 w-5" />
          </span>
        )}
      </div>
      <div className="mt-2 text-3xl font-semibold tabular-nums text-slate-900">{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </>
  )
  const base = 'rounded-2xl border border-slate-200/70 bg-white p-5 shadow-soft'
  if (!to) return <div className={base}>{body}</div>
  return (
    <Link
      to={to}
      aria-label={ariaLabel || `${typeof label === 'string' ? label : 'Open'}: ${typeof value === 'string' || typeof value === 'number' ? value : ''}`.trim()}
      className={`group relative block cursor-pointer transition-all duration-150 hover:-translate-y-px hover:border-brand-200 hover:shadow-md focus-visible:-translate-y-px focus-visible:border-brand-500 focus-visible:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 ${base}`}
    >
      {body}
      <ChevronRight aria-hidden className="absolute right-2 top-2 h-4 w-4 text-brand-600 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100" />
    </Link>
  )
}

// A short explanation on hover or keyboard focus.
// Tapping the icon toggles it too, for touch screens without hover.
export function InfoTip({ label, children, align = 'left' }) {
  const [open, setOpen] = useState(false)
  return (
    <span className="group relative inline-flex align-middle">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o) }}
        onBlur={() => setOpen(false)}
        className="relative rounded-full text-slate-400 transition before:absolute before:-inset-3 before:content-[''] hover:text-brand-600 focus-visible:text-brand-600 active:text-brand-700 can-hover:before:hidden"
      >
        <Info className="h-3.5 w-3.5 touch:h-4 touch:w-4" />
      </button>
      <span
        role="tooltip"
        className={`pointer-events-none absolute bottom-full z-30 mb-2 w-[min(16rem,58vw)] rounded-xl bg-slate-900 px-3 py-2 text-left font-sans text-xs font-normal normal-case leading-relaxed tracking-normal text-white shadow-lg transition group-focus-within:visible group-focus-within:opacity-100 can-hover:group-hover:visible can-hover:group-hover:opacity-100 ${open ? 'visible opacity-100' : 'invisible opacity-0'} ${align === 'right' ? 'right-0' : 'left-0'}`}
      >
        {children}
      </span>
    </span>
  )
}

// What ForgeBlock's result means, for the public pages.
export function ScreeningNotice({ className = '' }) {
  return (
    <p className={className}>
      <b className="font-semibold">ForgeBlock screens signatures; a qualified examiner makes the final call.</b> Every result comes with a confidence score and is sealed in a tamper-evident ledger.
    </p>
  )
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-slate-200">
      {tabs.map((t) => (
        <button
          key={t.value}
          onClick={() => onChange(t.value)}
          className={`flex items-center gap-1.5 whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium transition ${
            value === t.value ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          {t.icon && <t.icon className="h-4 w-4" />}
          {t.label}
        </button>
      ))}
    </div>
  )
}

export function Segmented({ options, value, onChange }) {
  return (
    <div className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`rounded-lg px-3 py-1 text-xs font-medium transition ${
            value === o.value ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function PageHeader({ eyebrow = 'ForgeBlock', title, description, children }) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <div className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-brand-600">{eyebrow}</div>
        <h1 className="text-[1.75rem] font-semibold leading-tight tracking-[-0.01em] text-slate-900 sm:text-[2rem]">{title}</h1>
        {description && <p className="mt-1.5 max-w-3xl text-sm text-slate-600">{description}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  )
}

export function Empty({ children, icon: Icon = CircleAlert }) {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-slate-500">
      {Icon && <Icon className="h-6 w-6 text-slate-300" />}
      {children}
    </div>
  )
}

export function Spinner({ label = 'Loading…' }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500">
      <Loader2 className="h-4 w-4 animate-spin" /> {label}
    </div>
  )
}

export function Modal({ open, title, onClose, children, wide, centered }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e) => e.key === 'Escape' && onClose?.()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:p-10" onMouseDown={onClose}>
      <div
        className={`w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} ${centered ? 'my-auto' : ''} rounded-2xl bg-white shadow-xl`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h3 className="font-semibold">{title}</h3>
          <button onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}


// Styled replacement for window.confirm. onConfirm may be async: the dialog shows a spinner while it runs,
// closes when it resolves, and shows the error in place if it throws.
export function ConfirmDialog({ open, title, children, confirmLabel = 'Confirm', danger = false, icon: Icon = CircleAlert, onConfirm, onClose }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (open) setError('')
  }, [open])
  const run = async () => {
    setBusy(true)
    setError('')
    try {
      await onConfirm?.()
      onClose?.()
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal open={open} onClose={busy ? undefined : onClose} title={title} centered>
      <div className="flex gap-3">
        {Icon && (
          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${danger ? 'bg-bad-50 text-bad-600' : 'bg-brand-50 text-brand-600'}`}>
            <Icon className="h-5 w-5" />
          </span>
        )}
        <div className="self-center text-[15px] text-slate-700">{children}</div>
      </div>
      <Alert className="mt-4">{error}</Alert>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={busy} autoFocus className="touch:min-h-11 touch:px-5">Cancel</Button>
        <Button variant={danger ? 'danger' : 'primary'} loading={busy} onClick={run} className="touch:min-h-11 touch:px-5">{confirmLabel}</Button>
      </div>
    </Modal>
  )
}
export function Table({ head, children }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-100 bg-slate-50/70 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            {head.map((h, i) => (
              <th key={i} className={`px-4 py-3 font-medium ${h.right ? 'text-right' : ''}`}>
                {h.label ?? h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 [&>tr]:transition-colors">{children}</tbody>
      </table>
    </div>
  )
}

export const td = 'px-4 py-3 align-middle'

export function StrengthBadge({ strength }) {
  if (!strength) return null
  const tone = { strong: 'green', basic: 'blue', not_ready: 'amber', none: 'gray' }[strength.level]
  return <Badge tone={tone} className="cursor-help" title={strength.note}>{strength.label}</Badge>
}

export const fmtDate = (d) => (d ? new Date(d.endsWith?.('Z') ? d : `${d}Z`).toLocaleString() : '-')
export const fmtDay = (d) => (d ? new Date(d.endsWith?.('Z') ? d : `${d}Z`).toLocaleDateString() : '-')
export const fmtTime = (d) => (d ? new Date(d.endsWith?.('Z') ? d : `${d}Z`).toLocaleTimeString() : '')
export const shortHash = (h) => (h ? `${h.slice(0, 10)}…${h.slice(-6)}` : '-')
export const pct = (v, digits = 1) => (v === null || v === undefined ? '-' : `${(v * 100).toFixed(digits)}%`)
