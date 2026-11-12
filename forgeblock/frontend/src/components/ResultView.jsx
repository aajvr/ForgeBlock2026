import { ArrowRight, Check, ChevronDown, ChevronUp, Grid3x3, Info, Link2, ShieldAlert, ShieldCheck, X, ZoomIn } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { AuthImage, LimitedPenBadge, StrokePreview } from './shared'
import StrokeReplay, { ReplayControls } from './StrokeReplay'
import { Alert, Badge, FindingBadge, RESULT, StrengthBadge, fmtDate, fmtDay } from './ui'

const fmt = (v, d = 4) => (typeof v === 'number' ? v.toFixed(d) : '-')
// Count features (pieces, loops, pauses...) read better as whole numbers.
const COUNT_FEATURES = new Set(['pieces', 'loops', 'endpoints', 'pen_lifts', 'strokes', 'pauses'])
const digits = (i) => (COUNT_FEATURES.has(i.name) ? 0 : 2)

function HowCalculated({ r }) {
  return (
    <div className="space-y-2 text-sm leading-relaxed text-slate-700">
      <p>
        The {r.modality} model turns each signature into a list of numbers (an embedding). The questioned signature is compared with every reference on
        file using {r.modality === 'static' ? 'cosine similarity, Euclidean distance and Manhattan distance' : 'cosine similarity and Euclidean distance'}.
        Each measure is checked against its threshold ({r.decision_rule.toLowerCase()}).
      </p>
      {r.explain ? (
        <>
          <p>
            Passing a threshold is not enough on its own. ForgeBlock measures <b>how far past</b> the thresholds the signature is, counted in the
            client’s <b>own</b> natural variation (how much their references differ from each other), and turns that distance into the <b>chance that
            the signature is genuine</b>. This was calibrated on people the model never saw: signatures that only just pass are still often skilled
            forgeries, so a signature has to pass by a clear margin to count as Consistent.
          </p>
          <p>
            <b>Consistent</b> when that chance is at least {r.explain.band[1]}%, <b>Inconsistent</b> when it is {r.explain.band[0]}% or less, and{' '}
            <b>Inconclusive</b> in between, which goes to the examiner. The <b>confidence score</b> is how likely the shown result is (never above 99%).
          </p>
          <p className="rounded-lg bg-slate-50 px-3 py-2">
            <b>This screening:</b> {r.explain.why}
          </p>
        </>
      ) : (
        <p>
        The <b>confidence score</b> measures how far past the threshold the signature is, counted in the client’s <b>own</b> natural variation
        (how much their references differ from each other). Right on the threshold is 0%; one step of their usual variation past it is about 68%,
        two steps about 95%, and it never goes above 99%. On the Inconsistent side it is the same distance measured below the threshold.
        Borderline results are <b>Inconclusive</b>{' '}
        and go to the examiner. It is not a probability that the signature is genuine.
        </p>
      )}
      <p>
        {r.threshold_source === 'adaptive'
          ? `Personal thresholds were used: with ${r.reference_count} references on file, ForgeBlock compares the client’s references with each other and sets the threshold from how much their own signatures vary. They change whenever references are added or removed.`
          : 'Standard thresholds were used, because the client has fewer than 7 references. With 7 or more, personal thresholds are used.'}
      </p>
    </div>
  )
}

// The "How is this calculated?" explanation (staff only). `children` is the
// trigger's content: the info icon by the label, or the text link under the ring.
function HowPopover({ r, children, className = '', label = 'How is this calculated?' }) {
  const [open, setOpen] = useState(false)
  const box = useRef(null)
  useEffect(() => {
    if (!open) return
    const close = (e) => !box.current?.contains(e.target) && setOpen(false)
    const esc = (e) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', esc)
    }
  }, [open])
  return (
    <span ref={box} className="relative inline-flex">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="dialog" aria-label={typeof children === 'string' ? undefined : label} className={className}>
        {children}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-2 max-h-96 w-[min(30rem,calc(100vw-4rem))] overflow-y-auto rounded-[16px] border border-line bg-white p-4 text-left normal-case tracking-normal text-ink shadow-lift" role="dialog" aria-label="How is this calculated?">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="font-semibold">How is this calculated?</div>
            <button onClick={() => setOpen(false)} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Close">
              <X className="h-4 w-4" />
            </button>
          </div>
          <HowCalculated r={r} />
        </div>
      )}
    </span>
  )
}

// A ring gauge in the result colour with the confidence score inside.
function ConfidenceRing({ score, color, size = 92 }) {
  const pct = Math.max(0, Math.min(100, score))
  const R = 42
  const C = 2 * Math.PI * R
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={`Confidence score ${pct.toFixed(0)}%`}>
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
        <circle cx="50" cy="50" r={R} fill="none" stroke="#e3e9f1" strokeWidth="10" />
        <circle cx="50" cy="50" r={R} fill="none" stroke={color} strokeWidth="10" strokeLinecap="round" strokeDasharray={`${(C * pct) / 100} ${C}`} />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center" aria-hidden="true">
        <b className="text-[28px] font-bold leading-none tracking-[-0.02em] tabular-nums text-ink">{pct.toFixed(0)}</b>
        <small className="mt-2 text-[13px] text-muted">%</small>
      </div>
    </div>
  )
}

// One short sentence; the number itself is shown large next to it.
function shortCaption(r, whose) {
  const against = r.mode === 'compare' ? 'the other signature' : `${whose} signatures on file`
  if (r.screening_result === 'consistent') return `Matches ${against}.`
  if (r.screening_result === 'inconsistent') return `Does not match ${against}.`
  return 'Too close to call; an examiner should review it.'
}

// The result card (v3): a white card with a 5px top edge in the result colour.
// Left: the result pill, the short caption and why. Right: the confidence score
// panel with a ring. Footer: the receipt and, as children, the next action.
// `how` (staff only) adds "How is this calculated?"; `client` uses the
// client's plain-language line instead.
export function ResultHeader({ r, label = 'Screening result', whose = 'the client’s', how = false, client = false, children }) {
  const res = RESULT[r.screening_result]
  const score = r.confidence_score
  const first = r.client_name ? r.client_name.trim().split(/\s+/)[0] : null
  const against = r.mode === 'compare' ? 'the other signature' : first ? `${first}’s own signature variation` : 'the client’s own signature variation'
  return (
    <section className={`min-w-0 rounded-[16px] border border-t-[5px] border-line ${res.edge} bg-white px-5 pb-5 pt-6 shadow-raised sm:px-[26px]`} aria-label="Result">
      <div className="flex flex-col gap-5 md:flex-row md:items-stretch md:justify-between">
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-semibold uppercase tracking-[0.14em] text-muted">{label}</div>
          <div className={`mt-2.5 inline-flex items-center gap-2.5 rounded-[12px] px-4 py-2 text-[26px] font-bold leading-tight ${res.pill}`}>
            <res.Icon className="h-[26px] w-[26px]" aria-hidden="true" />
            {res.label}
          </div>
          <p className="mt-3 text-[16px] font-medium text-ink">{shortCaption(r, whose)}</p>
          {r.explain?.why && <p className="mt-1 max-w-[430px] text-[14px] leading-normal text-muted">{r.explain.why}</p>}
        </div>
        <div className="flex w-full flex-col rounded-[14px] border border-[#e8edf4] bg-[#f6f8fc] px-4 py-3.5 md:w-[300px] md:shrink-0">
          {/* One way in to the explanation: the "How is this calculated?" link under the ring. */}
          <div className="text-[12px] font-semibold uppercase tracking-[0.12em] text-muted">Confidence score</div>
          <div className="mt-2 flex items-center gap-3">
            <ConfidenceRing score={score} color={res.hex} />
            <p className="m-0 text-[12.5px] leading-[1.45] text-[#4b5a6e]">
              {client
                ? 'How sure the screening is about this result. Your examiner makes the final decision.'
                : <>How sure ForgeBlock is about <b className="font-semibold text-ink">this result</b>, measured against {against}. Never above 99%.</>}
            </p>
          </div>
          {how && (
            <HowPopover r={r} className="mt-2.5 inline-flex items-center gap-1.5 text-[13px] font-semibold text-brand-600 hover:text-brand-700 hover:underline">
              How is this calculated? <ArrowRight className="h-3.5 w-3.5" />
            </HowPopover>
          )}
        </div>
      </div>
      <div className="mt-[18px] flex flex-wrap items-center justify-between gap-3 border-t border-track pt-4 text-[13.5px]">
        <span className="flex items-center gap-2 text-muted">Receipt <span className="text-[13px] font-medium text-ink"><ReceiptValue r={r} /></span></span>
        {children}
      </div>
    </section>
  )
}

export function ReceiptValue({ r }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-mono">
      {r.integrity?.valid ? <ShieldCheck className="h-[15px] w-[15px] text-ok-600" /> : <ShieldAlert className="h-[15px] w-[15px] text-bad-600" />}
      {r.receipt_code}
    </span>
  )
}

// Key facts (v3): a card of rows, label left and value right, thin dividers.
export function KeyFacts({ facts, children, title = 'Key facts' }) {
  return (
    <section className="min-w-0 rounded-[16px] border border-line bg-white px-5 py-5 shadow-raised sm:px-[22px]" aria-label={title}>
      <h2 className="text-[17px] font-semibold text-ink">{title}</h2>
      <dl className="mt-3.5">
        {facts.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between gap-4 border-t border-track px-0.5 py-3">
            <dt className="shrink-0 text-[13.5px] text-muted">{k}</dt>
            <dd className="m-0 min-w-0 text-right text-[14.5px] font-semibold text-ink">{v}</dd>
          </div>
        ))}
      </dl>
      {children}
    </section>
  )
}

export function LedgerBlockValue({ r }) {
  if (!r.block) return '-'
  return (
    <span className="inline-flex items-center gap-1.5">
      {r.integrity?.valid ? <ShieldCheck className="h-4 w-4 text-ok-600" /> : <ShieldAlert className="h-4 w-4 text-bad-600" />}
      Block #{r.block.block_index}
    </span>
  )
}

// "Show details": collapsed by default, one tab at a time when open.
export function DetailsToggle({ tabs, children }) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState(tabs[0].value)
  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="inline-flex items-center gap-2 rounded-[10px] border border-line bg-white px-4 py-[9px] text-[14px] font-semibold text-ink shadow-soft transition hover:border-slate-300 hover:bg-slate-50"
      >
        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        {open ? 'Hide details' : 'Show details'}
        <span className="hidden font-normal text-muted sm:inline">{tabs.map((t) => t.label.toLowerCase()).join(', ')}</span>
      </button>
      {open && (
        <section className="mt-3 rounded-[16px] border border-line bg-white px-5 py-5 shadow-soft sm:px-[22px]" aria-label="Details">
          {tabs.length > 1 && (
            <div role="tablist" aria-label="Details" className="mb-[18px] inline-flex max-w-full flex-wrap gap-0.5 rounded-[12px] bg-track p-1">
              {tabs.map((t) => (
                <button
                  key={t.value}
                  role="tab"
                  aria-selected={tab === t.value}
                  onClick={() => setTab(t.value)}
                  className={`whitespace-nowrap rounded-[9px] px-3.5 py-1.5 text-[14px] transition ${
                    tab === t.value ? 'bg-white font-semibold text-brand-600 shadow-[0_1px_3px_rgb(0_0_0/0.1)]' : 'font-medium text-[#4b5a6e] hover:text-ink'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}
          <div role="tabpanel">{children(tab)}</div>
        </section>
      )}
    </div>
  )
}

// The reason and, for an earlier decision on the same signature, where it came from.
function DecisionNote({ d, prior }) {
  if (!d.reason && !prior) return null
  return (
    <div className="border-t border-track pt-3.5 text-sm">
      {prior && (
        <p className="text-slate-600">
          This exact signature was examined before{d.examiner_name ? ` by ${d.examiner_name}` : ''}{d.decided_at ? ` on ${fmtDay(d.decided_at)}` : ''}.
          {d.can_open && (
            <Link to={`/app/cases/${d.case_id}`} className="ml-1.5 inline-flex items-center gap-1 font-medium text-brand-700 hover:underline">
              Open case {d.case_code} <ArrowRight className="h-4 w-4" />
            </Link>
          )}
        </p>
      )}
      {d.reason && <p className={`rounded-xl bg-slate-50 px-3.5 py-2.5 text-[15px] text-slate-800 ${prior ? 'mt-2' : ''}`}>“{d.reason}”</p>}
    </div>
  )
}

function StaffFacts({ r }) {
  const decided = r.finding || r.prior_decision
  const prior = !r.finding && !!r.prior_decision
  const needsDecision = r.case && r.case.status === 'open'
  const decision = decided ? <FindingBadge value={decided.finding} prefix={prior ? 'Examined before' : 'Decided'} />
    : needsDecision ? <Badge tone="amber">Needs decision</Badge>
      : r.case ? `Case ${r.case.case_code} closed`
        : r.screening_result === 'consistent' ? 'Not needed' : 'Not reviewed'
  const caseLink = r.case && !needsDecision && r.case.can_open && (
    <Link to={`/app/cases/${r.case.id}`} className="block text-sm font-normal text-brand-700 hover:underline">Case {r.case.case_code}</Link>
  )
  return (
    <KeyFacts facts={[
      ['Client', <>{r.client_name || '-'} <span className="font-normal text-muted">{r.client_code}</span></>],
      ['Examiner’s decision', <>{decision}{caseLink}</>],
      ['Date', <>{fmtDate(r.created_at)}<span className="block text-[12.5px] font-normal text-muted">by {r.performed_by_name}</span></>],
      ['Ledger block', <LedgerBlockValue key="block" r={r} />],
    ]}>
      {decided && <DecisionNote d={decided} prior={prior} />}
      {!r.integrity.valid && <Alert className="mt-3">This record was changed after it was sealed in the ledger.</Alert>}
    </KeyFacts>
  )
}

// Faint ruled paper behind the signature tiles.
const RULED = { backgroundImage: 'repeating-linear-gradient(transparent 0 27px, #f1f4f8 27px 28px)' }

// A tag on a signature tile ("Questioned", "Closest reference · #4").
function TileTag({ children, tone = 'grey' }) {
  return (
    <span className={`pointer-events-none absolute left-3 top-3 z-10 rounded-[8px] px-2.5 py-1 text-[12.5px] font-semibold ${tone === 'blue' ? 'bg-brand-50 text-brand-800' : 'bg-track text-[#3b4a5e]'}`}>
      {children}
    </span>
  )
}

// Where a reference sits in the client's list, for its "#n" tag.
const refNumber = (r, id) => {
  const i = (r.reference_profile_ids || []).indexOf(id)
  return i >= 0 ? i + 1 : null
}

function Signatures({ r }) {
  const [tools, setTools] = useState(false)
  const isStatic = r.modality === 'static'
  const q = r.analysis?.quality
  return (
    <section className="rounded-[16px] border border-line bg-white px-5 py-5 shadow-soft sm:px-[22px]" aria-label="Signatures">
      <div className="mb-3.5 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[17px] font-semibold text-ink">Questioned signature and closest reference</h2>
          <p className="mt-[3px] text-[12.5px] text-muted">{r.reference_count} {r.modality} reference{r.reference_count === 1 ? '' : 's'} on file</p>
        </div>
        {isStatic && (
          <button
            type="button"
            onClick={() => setTools(!tools)}
            aria-pressed={tools}
            aria-label="Zoom, grid and other references"
            title="Zoom, grid and other references"
            className={`flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-[12px] border transition-colors ${tools ? 'border-brand-200 bg-brand-50 text-brand-700' : 'border-line bg-white text-[#3b4a5e] hover:bg-slate-50'}`}
          >
            <ZoomIn className="h-5 w-5" />
          </button>
        )}
      </div>
      {isStatic ? <StaticViewer r={r} measures={false} tools={tools} /> : <SideBySide r={r} />}
      {q && <p className="mt-3.5 text-[13px] text-muted">Input quality {q.score}/100{q.issues.length ? `: ${q.issues.join(' ')}` : '.'}</p>}
    </section>
  )
}

// The questioned signature next to its closest reference (dynamic; static uses StaticViewer).
function SideBySide({ r }) {
  const [test, setTest] = useState(null)
  const [ref, setRef] = useState(null)
  useEffect(() => {
    api.get(`/api/verifications/${r.id}/strokes`).then((d) => setTest(d.strokes)).catch(() => setTest([]))
    if (r.best_match_profile_id) api.get(`/api/references/${r.best_match_profile_id}/strokes`).then((d) => setRef(d.strokes)).catch(() => setRef([]))
  }, [r.id, r.best_match_profile_id])
  const box = 'relative flex h-48 items-center justify-center rounded-[12px] border border-line bg-white px-4 pb-4 pt-11'
  const n = refNumber(r, r.best_match_profile_id)
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <figure className={`m-0 ${box}`} style={RULED}>
        <TileTag tone="blue">Questioned</TileTag>
        {test ? <StrokePreview strokes={test} className="h-full w-full" /> : null}
      </figure>
      <figure className={`m-0 ${box} ${r.best_match_profile_id ? '' : 'text-sm text-slate-400'}`} style={RULED}>
        <TileTag>Closest reference{n ? ` · #${n}` : ''}</TileTag>
        {!r.best_match_profile_id ? 'Not available' : ref ? <StrokePreview strokes={ref} className="h-full w-full" /> : null}
      </figure>
    </div>
  )
}

function FeatureAnalysis({ r }) {
  const fa = r.analysis?.features
  if (!fa) return <p className="text-sm text-slate-500">No feature analysis for this record.</p>
  return (
    <div>
      <p className="mb-3 text-xs text-slate-500">
        How this signature differs from the client’s references; the result itself comes from the scores.
      </p>
      <ul className="mb-4 space-y-1.5">
        {fa.summary.map((s, i) => (
          <li key={i} className="flex gap-2 text-sm text-slate-800">
            <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${fa.flagged ? 'bg-warn-600' : 'bg-ok-600'}`} />
            {s}
          </li>
        ))}
      </ul>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="py-2 font-medium">Feature</th>
              <th className="py-2 text-right font-medium">This signature</th>
              <th className="py-2 text-right font-medium">Usual range</th>
              <th className="py-2 text-right font-medium" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {fa.items.map((i) => (
              <tr key={i.name}>
                <td className="py-2">{i.label}</td>
                <td className="py-2 text-right font-mono tabular-nums">
                  {fmt(i.value, digits(i))} <span className="text-slate-400">{i.unit}</span>
                </td>
                <td className="py-2 text-right font-mono tabular-nums text-slate-500">
                  {i.low === null ? '-' : `${fmt(i.low, digits(i))} – ${fmt(i.high, digits(i))}`}
                </td>
                <td className="py-2 text-right">{i.low !== null && (i.outside ? <Badge tone="amber">Outside</Badge> : <Badge tone="green">Within</Badge>)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function measures(r) {
  const items = r.analysis?.features?.items || []
  const pick = (n) => items.find((i) => i.name === n)
  return ['slant', 'aspect_ratio', 'pieces', 'duration', 'pen_lifts', 'speed'].map(pick).filter(Boolean)
}

// Static tiles on ruled paper. `tools` shows zoom, grid and the reference picker.
function StaticViewer({ r, measures = true, tools = true }) {
  const [zoom, setZoom] = useState(1)
  const [grid, setGrid] = useState(false)
  const [refId, setRefId] = useState(r.best_match_profile_id)
  const pane = (src, tag, tone) => (
    <figure className="relative m-0">
      <TileTag tone={tone}>{tag}</TileTag>
      <div className="relative h-56 overflow-auto rounded-[12px] border border-line bg-white" style={RULED}>
        <div style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }} className="relative px-4 pb-3 pt-11">
          <AuthImage src={src} className="h-full w-full object-contain mix-blend-multiply" />
          {grid && (
            <svg className="pointer-events-none absolute inset-0 h-full w-full" preserveAspectRatio="none" viewBox="0 0 100 100">
              {[10, 20, 30, 40, 50, 60, 70, 80, 90].map((v) => (
                <g key={v} stroke="#0f6cbd" strokeOpacity={v === 50 ? 0.5 : 0.18} strokeWidth="0.25">
                  <line x1={v} y1="0" x2={v} y2="100" />
                  <line x1="0" y1={v} x2="100" y2={v} />
                </g>
              ))}
            </svg>
          )}
        </div>
      </div>
    </figure>
  )
  const refs = r.reference_profile_ids || []
  const n = refNumber(r, refId)
  const refTag = `${refId === r.best_match_profile_id ? 'Closest reference' : 'Reference'}${n ? ` · #${n}` : ''}`
  return (
    <div>
      {tools && (
        <div className="mb-3.5 flex flex-wrap items-center gap-3 rounded-[12px] bg-[#f6f8fc] px-3 py-2 text-sm">
          <label className="flex items-center gap-2">
            <ZoomIn className="h-4 w-4 text-muted" />
            <span className="sr-only">Zoom</span>
            <input type="range" min="1" max="4" step="0.25" value={zoom} onChange={(e) => setZoom(Number(e.target.value))} />
            <span className="w-10 tabular-nums text-muted">{zoom}×</span>
          </label>
          <button onClick={() => setGrid(!grid)} aria-pressed={grid} className={`inline-flex items-center gap-1.5 rounded-[8px] border px-3 py-1 text-xs font-medium ${grid ? 'border-brand-300 bg-brand-50 text-brand-700' : 'border-line bg-white'}`}>
            <Grid3x3 className="h-3.5 w-3.5" /> Grid
          </button>
          {refs.length > 1 && (
            <select value={refId || ''} onChange={(e) => setRefId(Number(e.target.value))} aria-label="Reference to compare" className="rounded-[8px] border border-line bg-white px-2 py-1 text-xs">
              {refs.map((id, i) => (
                <option key={id} value={id}>
                  Reference {i + 1}
                  {id === r.best_match_profile_id ? ' (best match)' : ''}
                </option>
              ))}
            </select>
          )}
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {pane(`/api/verifications/${r.id}/image`, 'Questioned', 'blue')}
        {refId ? pane(`/api/references/${refId}/image`, refTag) : <div />}
      </div>
      {measures && <Measures r={r} />}
    </div>
  )
}

function Measures({ r }) {
  const m = measures(r)
  if (!m.length) return null
  return (
    <div className="mt-4 grid gap-3 sm:grid-cols-3">
      {m.map((i) => (
        <div key={i.name} className={`rounded-lg border p-3 ${i.outside ? 'border-warn-100 bg-warn-50' : 'border-slate-200'}`}>
          <div className="text-xs text-slate-500">{i.label}</div>
          <div className="mt-1 font-mono text-sm tabular-nums">
            {fmt(i.value, digits(i))}{i.unit === '°' ? '°' : ` ${i.unit}`}
          </div>
          <div className="text-[12.5px] text-slate-500">usual {i.low === null ? '-' : `${fmt(i.low, digits(i))} – ${fmt(i.high, digits(i))}`}</div>
        </div>
      ))}
    </div>
  )
}

function DynamicViewer({ r }) {
  const [test, setTest] = useState(null)
  const [ref, setRef] = useState(null)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [key, setKey] = useState(0)
  useEffect(() => {
    api.get(`/api/verifications/${r.id}/strokes`).then((d) => setTest(d.strokes)).catch(() => setTest([]))
    if (r.best_match_profile_id) api.get(`/api/references/${r.best_match_profile_id}/strokes`).then((d) => setRef(d.strokes)).catch(() => setRef([]))
  }, [r.id, r.best_match_profile_id])
  return (
    <div>
      <ReplayControls playing={playing} setPlaying={setPlaying} speed={speed} setSpeed={setSpeed} onRestart={() => { setPlaying(false); setKey((k) => k + 1) }} />
      <div className="mt-3 grid gap-4 md:grid-cols-2" key={key}>
        {test ? <StrokeReplay strokes={test} title="Questioned signature" playing={playing} speed={speed} onEnd={() => setPlaying(false)} /> : <div className="h-44 animate-pulse rounded-lg bg-slate-100" />}
        {r.best_match_profile_id && (ref ? <StrokeReplay strokes={ref} title="Best-matching reference" playing={playing} speed={speed} /> : <div className="h-44 animate-pulse rounded-lg bg-slate-100" />)}
      </div>
      <Measures r={r} />
    </div>
  )
}

function Overlay({ r }) {
  return (
    <div className="grid gap-5 md:grid-cols-[minmax(0,320px)_1fr]">
      <AuthImage src={`/api/verifications/${r.id}/overlay`} className="aspect-square w-full rounded-lg border border-slate-200" />
      <div className="space-y-2 text-sm text-slate-700">
        <p>The questioned signature laid over its closest reference.</p>
        <p className="flex items-center gap-2"><span className="h-3 w-3 rounded-sm bg-bad-600" /> Only in the questioned signature</p>
        <p className="flex items-center gap-2"><span className="h-3 w-3 rounded-sm bg-brand-500" /> Only in the reference</p>
        <p className="flex items-center gap-2"><span className="h-3 w-3 rounded-sm bg-slate-800" /> In both</p>
      </div>
    </div>
  )
}

function Scores({ r, quality = true }) {
  const per = r.analysis?.per_reference || []
  return (
    <div className="space-y-5">
      <div>
        <dl className="flex flex-wrap gap-x-8 gap-y-2 text-[15px]">
          <div>
            <dt className="text-sm text-slate-500">Compared with</dt>
            <dd className="font-medium">{r.reference_count} {r.modality} reference{r.reference_count === 1 ? '' : 's'}</dd>
          </div>
          <div>
            <dt className="text-sm text-slate-500">Thresholds</dt>
            <dd className="font-medium">{r.threshold_source === 'adaptive' ? 'Personal' : 'Standard'}{r.strength && <span className="ml-2"><StrengthBadge strength={r.strength} /></span>}</dd>
          </div>
        </dl>
      </div>
      <div className="overflow-x-auto">
      <table className="w-full text-[14px]">
        <thead>
          <tr className="border-b border-track text-left text-[12.5px] text-muted">
            <th className="px-3 py-2 font-semibold">Measure</th>
            <th className="px-3 py-2 font-semibold">Score</th>
            <th className="px-3 py-2 font-semibold">{r.threshold_source === 'adaptive' ? 'Personal threshold' : 'Standard threshold'}</th>
            <th className="px-3 py-2 font-semibold">Result</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#f3f5f9]">
          {Object.entries(r.votes).map(([k, vote]) => (
            <tr key={k}>
              <td className="px-3 py-[13px] text-ink">{r.metric_labels[k] || k}</td>
              <td className="px-3 py-[13px] font-mono text-[13px] tabular-nums text-ink">{fmt(r.metrics[k])}</td>
              <td className="px-3 py-[13px] font-mono text-[13px] tabular-nums text-ink">
                {k === 'cosine' ? '≥ ' : '≤ '}
                {fmt(r.thresholds[k])}
              </td>
              <td className="px-3 py-[13px]">
                {vote
                  ? <Badge tone="green"><Check className="h-3.5 w-3.5" aria-hidden="true" /> Passed</Badge>
                  : <Badge tone="red"><X className="h-3.5 w-3.5" aria-hidden="true" /> Not passed</Badge>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      <p className="text-xs text-slate-500">Decision rule: {r.decision_rule}. {r.reference_count > 1 && 'Values are averaged over all references.'}</p>
      {r.explain?.all_pass && r.screening_result !== 'consistent' && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          All metrics pass, but the result also depends on how far past the thresholds the signature is, compared with this client’s own
          signatures. Here the margin was small, so the chance it is genuine is about {r.explain.p_genuine}%.
        </p>
      )}
      {per.length > 0 && (
        <div>
          <div className="mb-2 text-sm font-medium">Similarity to each reference</div>
          <div className="space-y-1.5">
            {per.map((p, i) => (
              <div key={p.profile_id} className="flex items-center gap-3 text-xs">
                <span className="w-24 text-slate-500">
                  Reference {i + 1} {p.profile_id === r.best_match_profile_id && '★'}
                </span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full bg-brand-500" style={{ width: `${Math.max(0, p.cosine) * 100}%` }} />
                </div>
                <span className="w-14 text-right font-mono tabular-nums">{p.cosine.toFixed(3)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {quality && r.analysis?.quality && (
        <p className="text-xs text-slate-500">
          Input quality {r.analysis.quality.score}/100{r.analysis.quality.issues.length ? `: ${r.analysis.quality.issues.join(' ')}` : '.'}
        </p>
      )}
    </div>
  )
}

function LedgerProof({ r }) {
  if (!r.block) return <p className="text-sm text-slate-500">No ledger block.</p>
  const rows = [
    ['Block', `#${r.block.block_index}`],
    ['Record hash', r.block.record_hash],
    ['Previous block hash', r.block.previous_hash],
    ['Block hash', r.block.block_hash],
    ['Sealed at', fmtDate(r.block.timestamp)],
  ]
  return (
    <div>
      <div className={`mb-4 flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${r.integrity.valid ? 'bg-ok-50 text-ok-700' : 'bg-bad-50 text-bad-700'}`}>
        {r.integrity.valid ? <ShieldCheck className="h-4 w-4" /> : <ShieldAlert className="h-4 w-4" />}
        {r.integrity.valid ? 'The record matches its sealed hash and its block links to the chain.' : r.integrity.issues.join(' ')}
      </div>
      <dl className="space-y-2 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="grid gap-1 sm:grid-cols-[180px_1fr]">
            <dt className="text-slate-500">{k}</dt>
            <dd className="break-all font-mono text-xs leading-5 text-slate-800">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 flex items-center gap-1.5 text-xs text-slate-500">
        <Link2 className="h-3.5 w-3.5 shrink-0" /> Anyone with the receipt code can check this record on the ForgeBlock home page.
      </p>
    </div>
  )
}

export default function ResultView({ result: r }) {
  const staff = !!r.analysis
  const isStatic = r.modality === 'static'
  const stored = r.stored_sample
  const needsDecision = r.case && r.case.status === 'open'
  const decided = r.finding || r.prior_decision
  const exact = r.analysis?.exact_match
  const tabs = [
    { value: 'scores', label: 'Scores' },
    staff && { value: 'features', label: 'Handwriting features' },
    staff && stored && !isStatic && { value: 'viewer', label: 'Stroke replay' },
    staff && stored && isStatic && r.best_match_profile_id && { value: 'overlay', label: 'Overlay' },
    { value: 'ledger', label: 'Ledger proof' },
  ].filter(Boolean)

  const showSignatures = staff && stored
  return (
    <div className="space-y-5">
      {exact && (
        <Alert kind="info" icon={Info} raised>
          Same file as reference #{exact.position} on file. Use a new signature to test.
        </Alert>
      )}
      <PenDataNote r={r} />
      <div className="grid items-stretch gap-5 lg:grid-cols-[1.35fr_1fr]">
        <ResultHeader r={r} label={decided ? 'Model screening result' : 'Screening result'} how={staff}>
          {needsDecision && r.case.can_open && (
            <Link to={`/app/cases/${r.case.id}`} className="inline-flex items-center gap-2 rounded-[10px] bg-brand-600 px-[18px] py-2.5 text-[15px] font-semibold text-white shadow-[0_6px_16px_rgb(15_108_189/0.3)] transition hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600">
              Decide now: case {r.case.case_code} <ArrowRight className="h-4 w-4" />
            </Link>
          )}
        </ResultHeader>
        <StaffFacts r={r} />
      </div>
      {showSignatures && <Signatures r={r} />}
      <DetailsToggle tabs={tabs}>
        {(tab) => (
          <>
            {tab === 'scores' && <Scores r={r} quality={!showSignatures} />}
            {tab === 'features' && <FeatureAnalysis r={r} />}
            {tab === 'viewer' && <DynamicViewer r={r} />}
            {tab === 'overlay' && <Overlay r={r} />}
            {tab === 'ledger' && <LedgerProof r={r} />}
          </>
        )}
      </DetailsToggle>
      <p className="mx-0.5 text-[13px] text-muted">{r.disclaimer}</p>
    </div>
  )
}

// v8.11: dynamic screening that left out pen pressure and/or tilt.
export function PenDataNote({ r }) {
  if (r.modality !== 'dynamic') return null
  const note = r.pen_note
  if (!note && r.capture_device !== 'development') return null
  return (
    <Alert kind="warn" raised>
      <div className="mb-1 flex items-center gap-2">
        <LimitedPenBadge missing={note?.left_out || ['tilt']} />
      </div>
      {note?.message ||
        'The questioned signature has no pen tilt. The comparison used shape and timing without the pen tilt, so this result is less certain than an Apple Pencil screening.'}
    </Alert>
  )
}
