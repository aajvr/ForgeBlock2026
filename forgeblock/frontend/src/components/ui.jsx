import { ArrowUpRight, CheckCircle2, CircleAlert, CircleHelp, Info, Loader2, X, XCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

// A white card (v3.1): 16px radius, a faint navy edge and the card shadow.
// `icon` (a lucide icon) sits in a role-tinted bubble left of the title.
// `raised` is kept for callers; every card now uses the same shadow.
export function Card({ title, subtitle, actions, icon: Icon, children, className = '', bodyClass, ...props }) {
  const { raised: _raised, ...rest } = props // `raised` no longer changes the look; keep it off the DOM
  const head = title || actions
  return (
    <section className={`min-w-0 rounded-[16px] border border-edge bg-white shadow-card ${className}`} {...rest}>
      {head && (
        <header className="flex flex-wrap items-start justify-between gap-3 px-[22px] pb-3.5 pt-5">
          <div className="flex min-w-0 items-start gap-3">
            {Icon && (
              <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] bg-[var(--role-soft,#cfe4fa)] text-[var(--role-ink,#0f6cbd)]">
                <Icon className="h-[18px] w-[18px]" />
              </span>
            )}
            <div className={`min-w-0 ${Icon ? (subtitle ? '' : 'self-center') : ''}`}>
              <h2 className="text-[17px] font-semibold leading-snug text-ink">{title}</h2>
              {subtitle && <p className="mt-[3px] text-[12.5px] leading-snug text-muted">{subtitle}</p>}
            </div>
          </div>
          {actions}
        </header>
      )}
      <div className={bodyClass ?? (head ? 'px-[22px] pb-5' : 'px-[22px] py-5')}>{children}</div>
    </section>
  )
}

// Primary stays brand blue for every role. On the band (page header) the
// secondary, ghost and subtle buttons turn translucent white, and the primary
// turns white with brand-blue text so it still stands out on the blue.
const ON_BAND_QUIET = 'band:border band:border-white/25 band:bg-white/12 band:text-white band:shadow-none band:backdrop-blur-sm band:hover:border-white/40 band:hover:bg-white/20 band:disabled:text-white/60'
const BUTTON_STYLES = {
  primary: 'bg-brand-600 text-white shadow-[0_4px_12px_rgb(15_108_189/0.22)] hover:bg-brand-700 hover:shadow-[0_6px_16px_rgb(15_108_189/0.3)] disabled:bg-brand-300 disabled:shadow-none band:bg-white band:text-brand-700 band:shadow-[0_6px_16px_rgb(12_30_60/0.18)] band:hover:bg-brand-50 band:disabled:bg-white/70',
  secondary: `border border-line bg-white text-[#3b4a5e] shadow-soft hover:border-slate-300 hover:bg-slate-50 disabled:text-slate-400 ${ON_BAND_QUIET}`,
  danger: 'bg-bad-600 text-white shadow-sm hover:bg-bad-700 hover:shadow-md disabled:opacity-50',
  ghost: `text-slate-600 hover:bg-track ${ON_BAND_QUIET} band:border-transparent band:bg-transparent`,
  subtle: `bg-brand-50 text-brand-700 hover:bg-brand-100 ${ON_BAND_QUIET}`,
}

export function Button({ variant = 'primary', size = 'md', className = '', loading, children, ...props }) {
  const sz = size === 'sm' ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-sm'
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-[10px] font-semibold transition active:scale-[0.98] disabled:cursor-not-allowed disabled:active:scale-100 ${sz} ${BUTTON_STYLES[variant]} ${className}`}
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

// Form fields (v3): 10px radius, 1px #DDE3EC border, brand focus ring.
// fieldClass has no width, for search boxes and filter dropdowns that set their own;
// compactFieldClass is the small version used inside table rows.
export const fieldClass =
  'rounded-[10px] border border-[#dde3ec] bg-white px-3 py-2 text-sm text-ink outline-none transition placeholder:text-slate-400 hover:border-slate-300 focus:border-brand-600 focus:ring-2 focus:ring-brand-100 disabled:bg-slate-50 disabled:text-slate-500'
export const compactFieldClass =
  'rounded-[8px] border border-[#dde3ec] bg-white px-2 py-1 text-xs text-ink outline-none transition hover:border-slate-300 focus:border-brand-600 focus:ring-2 focus:ring-brand-100 disabled:bg-slate-50 disabled:text-slate-500'
export const inputClass = `w-full min-w-0 ${fieldClass}`

// A translucent round-square icon button on the band (top bar: menu, help, notifications).
export const bandButton =
  'relative flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[10px] border border-white/22 bg-white/12 text-white backdrop-blur-sm transition-colors hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white'

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

// v3: white, with a 4px coloured edge on the left. `icon` adds a leading icon in
// the alert's colour; `raised` gives the stronger shadow for alerts on the band.
export function Alert({ kind = 'error', children, className = '', icon: Icon, raised = false }) {
  if (!children) return null
  const styles = {
    error: 'border-bad-100 border-l-bad-600 text-bad-700',
    info: 'border-brand-100 border-l-brand-600 text-brand-800',
    success: 'border-ok-100 border-l-ok-600 text-ok-700',
    warn: 'border-[#f4d49c] border-l-warn-500 text-[#6b3f00]',
  }
  const iconColor = { error: 'text-bad-600', info: 'text-brand-600', success: 'text-ok-600', warn: 'text-warn-500' }
  const box = `rounded-[12px] border border-l-4 bg-white px-4 py-3 text-sm ${raised ? 'shadow-[0_6px_20px_rgb(12_59_94/0.12)]' : 'shadow-soft'} ${styles[kind]} ${className}`
  if (!Icon) return <div className={box}>{children}</div>
  return (
    <div className={`flex items-start gap-2.5 ${box}`}>
      <Icon className={`mt-0.5 h-[18px] w-[18px] shrink-0 ${iconColor[kind]}`} aria-hidden="true" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

export function Badge({ children, tone = 'gray', className = '', title }) {
  // v3 tags: 8px radius, a soft tint and dark text.
  const tones = {
    gray: 'bg-track text-[#3b4a5e]',
    blue: 'bg-brand-50 text-brand-800',
    green: 'bg-ok-100 text-ok-700',
    amber: 'bg-warn-100 text-warn-700',
    red: 'bg-bad-100 text-bad-700',
    violet: 'bg-violet-50 text-violet-700',
  }
  return (
    <span title={title} className={`inline-flex items-center gap-1 rounded-[8px] px-2 py-0.5 text-xs font-semibold ${tones[tone]} ${className}`}>
      {children}
    </span>
  )
}

// Result colours, the same for every role. hex: chart bars and the confidence ring;
// edge: the result card's top border; pill: the tinted result pill.
export const RESULT = {
  consistent: { label: 'Consistent', long: 'Consistent with references', tone: 'blue', Icon: CheckCircle2, text: 'text-brand-600', bar: 'bg-brand-600', tint: 'border-brand-100 bg-gradient-to-br from-brand-100/80 via-brand-50 to-white', hex: '#0f6cbd', edge: 'border-t-brand-600', pill: 'bg-brand-50 text-brand-700' },
  inconclusive: { label: 'Inconclusive', long: 'Inconclusive, examiner review needed', tone: 'amber', Icon: CircleHelp, text: 'text-warn-600', bar: 'bg-warn-500', tint: 'border-warn-100 bg-gradient-to-br from-warn-100/80 via-warn-50 to-white', hex: '#e8950c', edge: 'border-t-warn-500', pill: 'bg-warn-100 text-warn-600' },
  inconsistent: { label: 'Inconsistent', long: 'Inconsistent, refer for examination', tone: 'red', Icon: XCircle, text: 'text-bad-600', bar: 'bg-bad-500', tint: 'border-bad-100 bg-gradient-to-br from-bad-100/80 via-bad-50 to-white', hex: '#d13438', edge: 'border-t-bad-500', pill: 'bg-bad-100 text-bad-600' },
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
  // The person's own role colour (soft tint, dark initials). Initials only, never photos.
  const tone = { admin: 'bg-[#d5dbf4] text-[#172f73]', client: 'bg-[#cde9f1] text-[#083f52]' }[role] || 'bg-brand-100 text-brand-800'
  return <span className={`flex shrink-0 items-center justify-center rounded-full font-bold ${size} ${tone}`}>{initials}</span>
}

// Stat icon chips: a gradient tile. The default (brand) uses the role colour.
const STAT_CHIPS = {
  brand: 'var(--role-chip)',
  amber: 'linear-gradient(135deg, #f5a623, #c46e00)',
  green: 'linear-gradient(135deg, #2fa063, #0b6a37)',
  violet: 'linear-gradient(135deg, #8b6cf0, #5b3fc4)',
  teal: 'linear-gradient(135deg, #1c9cc2, #0a5e7a)',
  indigo: 'linear-gradient(135deg, #4f67d0, #1f3a93)',
  sky: 'linear-gradient(135deg, #479ef5, #115ea3)',
  navy: 'linear-gradient(135deg, #1f3a93, #101f4d)',
}

// Stat accent line colours, one per tone (the chip's main colour).
const STAT_ACCENTS = {
  brand: 'var(--role-ink, #0f6cbd)',
  amber: '#e8950c',
  green: '#2fa063',
  violet: '#8b6cf0',
  teal: '#1c9cc2',
  indigo: '#4f67d0',
  sky: '#479ef5',
  navy: '#1f3a93',
}

// A stat card (v3.1): icon chip, big number, label, hint, a 3px accent line in
// the tone's colour along the bottom and a faint gradient towards it. With `to` the whole
// card is a router link to the matching page, with a small arrow tile.
export function Stat({ label, value, hint, icon: Icon, tone = 'brand', to, ariaLabel }) {
  const body = (
    <>
      {(Icon || to) && (
        <div className="mb-3.5 flex items-start justify-between gap-3">
          {Icon ? (
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] text-white" style={{ background: STAT_CHIPS[tone] || STAT_CHIPS.brand }}>
              <Icon className="h-[19px] w-[19px]" />
            </span>
          ) : <span />}
          {to && (
            <span aria-hidden className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[9px] bg-brand-50 text-brand-800 transition-colors duration-150 group-hover:bg-brand-100">
              <ArrowUpRight className="h-[15px] w-[15px]" />
            </span>
          )}
        </div>
      )}
      <div className="text-[36px] font-bold leading-none tracking-[-0.02em] tabular-nums text-ink">{value}</div>
      <div className="mt-1.5 text-[14px] font-semibold leading-snug text-ink">{label}</div>
      {hint && <div className="mt-[3px] text-[12.5px] leading-snug text-muted">{hint}</div>}
      <span aria-hidden="true" className="absolute inset-x-[18px] bottom-0 h-[3px] rounded-full" style={{ background: STAT_ACCENTS[tone] || STAT_ACCENTS.brand }} />
    </>
  )
  const base = 'relative rounded-[16px] border border-edge bg-white bg-gradient-to-b from-white from-55% to-[#f3f5fc] px-[18px] pb-[18px] pt-4 shadow-card'
  if (!to) return <div className={base}>{body}</div>
  return (
    <Link
      to={to}
      aria-label={ariaLabel || `${typeof label === 'string' ? label : 'Open'}: ${typeof value === 'string' || typeof value === 'number' ? value : ''}`.trim()}
      className={`group relative block cursor-pointer transition-[transform,border-color,box-shadow] duration-200 hover:-translate-y-0.5 hover:border-brand-200 focus-visible:-translate-y-0.5 focus-visible:border-brand-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 ${base}`}
    >
      {body}
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
    // v3: a grey track with the selected tab in white and brand-blue text.
    <div className="mt-2 inline-flex max-w-full gap-0.5 overflow-x-auto rounded-[12px] bg-track p-1" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          role="tab"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={`flex items-center gap-1.5 whitespace-nowrap rounded-[9px] px-3.5 py-1.5 text-sm transition ${
            value === t.value ? 'bg-white font-semibold text-brand-600 shadow-[0_1px_3px_rgb(0_0_0/0.1)]' : 'font-medium text-[#4b5a6e] hover:text-ink'
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
    // In a card: grey track, white selected option with brand text.
    // On the band (page header): translucent track, white selected option in the role colour.
    <div className="inline-flex gap-0.5 rounded-[12px] bg-track p-1 band:border band:border-white/22 band:bg-white/12 band:backdrop-blur-sm">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-[9px] px-3.5 py-1.5 text-[13px] transition ${
            value === o.value
              ? 'bg-white font-semibold text-brand-600 shadow-[0_1px_3px_rgb(0_0_0/0.1)] band:text-[var(--role-active)] band:shadow-none'
              : 'font-medium text-[#4b5a6e] hover:text-ink band:text-white/85 band:hover:text-white'
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
    // Sits on the role's coloured band: white text, translucent actions (see the band: variant).
    <div className="on-band mb-[22px] flex flex-wrap items-end justify-between gap-4 text-white">
      <div className="min-w-0">
        {eyebrow && <div className="text-[12px] font-semibold uppercase tracking-[0.14em] text-white/85">{eyebrow}</div>}
        <h1 className="mt-1.5 text-[32px] font-bold leading-[1.08] tracking-[-0.02em] text-white sm:text-[40px] sm:leading-[1.05]">{title}</h1>
        {description && <p className="mt-1.5 max-w-3xl text-[15px] leading-relaxed text-white/92">{description}</p>}
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
    <div className="fb-spinner flex items-center justify-center gap-2 py-10 text-sm text-slate-500">
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
        className={`w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} ${centered ? 'my-auto' : ''} rounded-[16px] bg-white shadow-xl`}
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
          <tr className="border-b border-track text-left text-[12.5px] font-semibold text-muted">
            {head.map((h, i) => (
              <th key={i} className={`px-4 py-3 font-semibold ${h.right ? 'text-right' : ''}`}>
                {h.label ?? h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[#f3f5f9] [&>tr]:transition-colors [&>tr:hover]:bg-[#f7fafd]">{children}</tbody>
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
