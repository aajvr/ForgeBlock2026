import { ArrowRight, ChevronDown, ChevronUp, Grid3x3, Info, Link2, ShieldAlert, ShieldCheck, X, ZoomIn } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { AuthImage, StrokePreview } from './shared'
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
      <p>
        The <b>confidence score</b> measures how far past the threshold the signature is, counted in the client’s <b>own</b> natural variation
        (how much their references differ from each other). Right on the threshold is 0%; one step of their usual variation past it is about 68%,
        two steps about 95%, and it never goes above 99%. On the Inconsistent side it is the same distance measured below the threshold.
        Borderline results are <b>Inconclusive</b>{' '}
        and go to the examiner. It is not a probability that the signature is genuine.
      </p>
      <p>
        {r.threshold_source === 'adaptive'
          ? `Personal thresholds were used: with ${r.reference_count} references on file, ForgeBlock compares the client’s references with each other and sets the threshold from how much their own signatures vary. They change whenever references are added or removed.`
          : 'Standard thresholds were used, because the client has fewer than 5 references. With 5 or more, personal thresholds are used.'}
      </p>
    </div>
  )
}

// The "How is this calculated?" explanation, opened from an info button.
function HowPopover({ r }) {
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
    <div ref={box} className="relative">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label="How is this calculated?"
        title="How is this calculated?"
        className="flex rounded-full p-0.5 text-slate-400 transition hover:bg-white hover:text-brand-600"
      >
        <Info className="h-4 w-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-2 max-h-96 text-left text-slate-900 w-[min(30rem,calc(100vw-4rem))] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4 shadow-lift" role="dialog" aria-label="How is this calculated?">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="font-semibold">How is this calculated?</div>
            <button onClick={() => setOpen(false)} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Close">
              <X className="h-4 w-4" />
            </button>
          </div>
          <HowCalculated r={r} />
        </div>
      )}
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

// Header card: result, confidence, caption and receipt, tinted with the result colour.
export function ResultHeader({ r, label = 'Screening result', whose = 'the client’s', how, notice, children }) {
  const res = RESULT[r.screening_result]
  const score = r.confidence_score
  return (
    <section className={`rounded-2xl border p-5 shadow-soft sm:p-6 ${res.tint}`} aria-label="Result">
      {notice}
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div className="min-w-0">
          <div className="text-sm font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</div>
          <div className={`mt-2 inline-flex items-center gap-2.5 rounded-xl bg-white px-3.5 py-2 text-2xl font-semibold shadow-sm ${res.text}`}>
            <res.Icon className="h-7 w-7" />
            {res.label}
          </div>
          <p className="mt-2.5 text-base text-slate-700">{shortCaption(r, whose)}</p>
        </div>
        <div className="sm:text-right">
          <div className="flex items-center gap-1.5 text-sm text-slate-500 sm:justify-end">Confidence score {how}</div>
          <div className="text-5xl font-semibold tabular-nums text-slate-900">
            {score.toFixed(0)}<span className="text-2xl text-slate-400">%</span>
          </div>
        </div>
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/90" role="img" aria-label={`Confidence score ${score.toFixed(0)}%`}>
        <div className={`h-full rounded-full ${res.bar}`} style={{ width: `${Math.max(2, Math.min(100, score))}%` }} />
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
        <span className="flex items-center gap-2 text-slate-500">Receipt <span className="font-medium text-slate-900"><ReceiptValue r={r} /></span></span>
        {children}
      </div>
    </section>
  )
}

export function ReceiptValue({ r }) {
  return (
    <span className="flex items-center gap-1.5 font-mono">
      {r.integrity?.valid ? <ShieldCheck className="h-4 w-4 text-ok-600" /> : <ShieldAlert className="h-4 w-4 text-bad-600" />}
      {r.receipt_code}
    </span>
  )
}

export function KeyFacts({ facts, children }) {
  return (
    <section className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-soft sm:p-6" aria-label="Key facts">
      <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
        {facts.map(([k, v]) => (
          <div key={k} className="min-w-0">
            <dt className="text-sm text-slate-500">{k}</dt>
            <dd className="mt-0.5 font-medium">{v}</dd>
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
    <span className="flex items-center gap-1.5">
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
        className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 shadow-sm transition hover:bg-slate-50"
      >
        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        {open ? 'Hide details' : 'Show details'}
        <span className="hidden font-normal text-slate-500 sm:inline">{tabs.map((t) => t.label.toLowerCase()).join(', ')}</span>
      </button>
      {open && (
        <section className="mt-3 rounded-2xl border border-slate-200/70 bg-white p-5 shadow-soft sm:p-6" aria-label="Details">
          {tabs.length > 1 && (
            <div role="tablist" aria-label="Details" className="mb-5 inline-flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1">
              {tabs.map((t) => (
                <button
                  key={t.value}
                  role="tab"
                  aria-selected={tab === t.value}
                  onClick={() => setTab(t.value)}
                  className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                    tab === t.value ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-600 hover:bg-white/60 hover:text-slate-900'
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
    <div className="mt-5 border-t border-slate-100 pt-4 text-sm">
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
      ['Client', <>{r.client_name || '-'} <span className="font-normal text-slate-500">{r.client_code}</span></>],
      ['Examiner’s decision', <>{decision}{caseLink}</>],
      ['Date', <>{fmtDate(r.created_at)}<span className="block text-sm font-normal text-slate-500">by {r.performed_by_name}</span></>],
      ['Ledger block', <LedgerBlockValue key="block" r={r} />],
    ]}>
      {decided && <DecisionNote d={decided} prior={prior} />}
      {!r.integrity.valid && <Alert className="mt-4">This record was changed after it was sealed in the ledger.</Alert>}
    </KeyFacts>
  )
}

function Signatures({ r }) {
  return (
    <section className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-soft sm:p-6" aria-label="Signatures">
      <h2 className="mb-3 text-lg font-semibold">Questioned signature and closest reference</h2>
      {r.modality === 'static' ? <StaticViewer r={r} measures={false} /> : <SideBySide r={r} />}
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
  const box = 'flex h-48 items-center justify-center rounded-xl border border-slate-200 bg-white p-3'
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div>
        <div className="mb-1.5 text-sm font-medium text-slate-600">Questioned signature</div>
        <div className={box}>{test ? <StrokePreview strokes={test} className="h-full w-full" /> : null}</div>
      </div>
      <div>
        <div className="mb-1.5 text-sm font-medium text-slate-600">Closest reference on file</div>
        {!r.best_match_profile_id ? <div className={`${box} text-sm text-slate-400`}>Not available</div>
          : <div className={box}>{ref ? <StrokePreview strokes={ref} className="h-full w-full" /> : null}</div>}
      </div>
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

function StaticViewer({ r, measures = true }) {
  const [zoom, setZoom] = useState(1)
  const [grid, setGrid] = useState(false)
  const [refId, setRefId] = useState(r.best_match_profile_id)
  const pane = (src, label) => (
    <div>
      <div className="mb-1 text-xs font-medium text-slate-500">{label}</div>
      <div className="relative h-56 overflow-auto rounded-lg border border-slate-200 bg-white">
        <div style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }} className="relative">
          <AuthImage src={src} className="h-full w-full object-contain" />
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
    </div>
  )
  const refs = r.reference_profile_ids || []
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2">
          <ZoomIn className="h-4 w-4 text-slate-500" />
          <input type="range" min="1" max="4" step="0.25" value={zoom} onChange={(e) => setZoom(Number(e.target.value))} />
          <span className="w-10 tabular-nums text-slate-500">{zoom}×</span>
        </label>
        <button onClick={() => setGrid(!grid)} className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1 text-xs font-medium ${grid ? 'border-brand-300 bg-brand-50 text-brand-700' : 'border-slate-300'}`}>
          <Grid3x3 className="h-3.5 w-3.5" /> Grid
        </button>
        {refs.length > 1 && (
          <select value={refId || ''} onChange={(e) => setRefId(Number(e.target.value))} className="rounded-lg border border-slate-300 px-2 py-1 text-xs">
            {refs.map((id, i) => (
              <option key={id} value={id}>
                Reference {i + 1}
                {id === r.best_match_profile_id ? ' (best match)' : ''}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {pane(`/api/verifications/${r.id}/image`, 'Questioned signature')}
        {refId ? pane(`/api/references/${refId}/image`, refId === r.best_match_profile_id ? 'Best-matching reference' : 'Reference') : <div />}
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

function Scores({ r }) {
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
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
            <th className="py-2 font-medium">Metric</th>
            <th className="py-2 text-right font-medium">Value</th>
            <th className="py-2 text-right font-medium">Threshold</th>
            <th className="py-2 text-right font-medium">Passes</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {Object.entries(r.votes).map(([k, vote]) => (
            <tr key={k}>
              <td className="py-2">{r.metric_labels[k] || k}</td>
              <td className="py-2 text-right font-mono tabular-nums">{fmt(r.metrics[k])}</td>
              <td className="py-2 text-right font-mono tabular-nums text-slate-500">
                {k === 'cosine' ? '≥ ' : '≤ '}
                {fmt(r.thresholds[k])}
              </td>
              <td className="py-2 text-right">{vote ? <Badge tone="green">Yes</Badge> : <Badge tone="red">No</Badge>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      <p className="text-xs text-slate-500">Decision rule: {r.decision_rule}. {r.reference_count > 1 && 'Values are averaged over all references.'}</p>
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
      {r.analysis?.quality && (
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

  return (
    <div className="space-y-5">
      <ResultHeader
        r={r}
        label={decided ? 'Model screening result' : 'Screening result'}
        how={staff && <HowPopover r={r} />}
        notice={exact && (
          <p className="mb-4 flex items-center gap-2 text-sm text-brand-800">
            <Info className="h-4 w-4 shrink-0" /> Same file as reference #{exact.position} on file. Use a new signature to test.
          </p>
        )}
      >
        {needsDecision && r.case.can_open && (
          <Link to={`/app/cases/${r.case.id}`} className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-brand-700 hover:shadow-md">
            Decide now: case {r.case.case_code} <ArrowRight className="h-4 w-4" />
          </Link>
        )}
      </ResultHeader>
      {r.capture_device === 'development' && (
        <Alert kind="warn">
          Development device: signed with a pen that has no tilt (for example a Wacom One). This result is less accurate than with the Apple Pencil
          and is not counted in the evaluation figures.
        </Alert>
      )}
      {staff && stored && <Signatures r={r} />}
      <StaffFacts r={r} />
      <DetailsToggle tabs={tabs}>
        {(tab) => (
          <>
            {tab === 'scores' && <Scores r={r} />}
            {tab === 'features' && <FeatureAnalysis r={r} />}
            {tab === 'viewer' && <DynamicViewer r={r} />}
            {tab === 'overlay' && <Overlay r={r} />}
            {tab === 'ledger' && <LedgerProof r={r} />}
          </>
        )}
      </DetailsToggle>
      <p className="text-sm text-slate-500">{r.disclaimer}</p>
    </div>
  )
}
