import { ArrowLeft, CheckCircle2, Gavel, MessageSquare, PlusCircle, ScanSearch, ShieldCheck, Stamp, XCircle } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../auth'
import { AuthImage, StrokePreview } from '../components/shared'
import { Alert, Badge, Button, Card, Empty, FINDING, PageHeader, ScreeningBadge, Spinner, Textarea, fieldClass, fmtDate } from '../components/ui'
import { STATUS_TONE } from './Cases'

const EVENT_ICON = { opened: Stamp, screening: ScanSearch, note: MessageSquare, finding: Gavel, second_opinion: ShieldCheck, closed: Stamp, reopened: Stamp, reference_added: PlusCircle }

const CHOICES = [
  { value: 'genuine', label: 'Genuine', note: 'The client wrote this signature.', Icon: CheckCircle2, on: 'border-ok-600 bg-ok-50 text-ok-700' },
  { value: 'forged', label: 'Forged', note: 'Someone else wrote this signature.', Icon: XCircle, on: 'border-bad-600 bg-bad-50 text-bad-700' },
]

// The questioned signature next to the closest reference on file, so the examiner can
// compare them while deciding. The case lists screenings without the best match, so each
// pair asks for its screening's details.
function SignaturePair({ id }) {
  const [r, setR] = useState(null)
  const [strokes, setStrokes] = useState({})
  useEffect(() => {
    api.get(`/api/verifications/${id}`).then(setR).catch(() => setR(false))
  }, [id])
  const dynamic = r && r.modality === 'dynamic'
  useEffect(() => {
    if (!dynamic || !r.stored_sample) return
    api.get(`/api/verifications/${id}/strokes`).then((d) => setStrokes((s) => ({ ...s, test: d.strokes }))).catch(() => {})
    if (r.best_match_profile_id) api.get(`/api/references/${r.best_match_profile_id}/strokes`).then((d) => setStrokes((s) => ({ ...s, ref: d.strokes }))).catch(() => {})
  }, [dynamic, id, r])
  if (r === false || (r && !r.stored_sample)) return null
  const box = 'flex h-28 items-center justify-center overflow-hidden rounded-[12px] border border-line bg-white p-2'
  const pane = (label, content) => (
    <div className="min-w-0">
      <div className="mb-1 text-xs font-medium text-slate-500">{label}</div>
      <div className={box}>{content}</div>
    </div>
  )
  const img = (src) => <AuthImage src={src} className="h-full w-full object-contain" />
  const missing = <span className="text-xs text-slate-400">Not available</span>
  return (
    <div className="mt-3 grid w-full gap-3 sm:grid-cols-2">
      {pane('Questioned signature', !r ? null : dynamic ? (strokes.test ? <StrokePreview strokes={strokes.test} className="h-full w-full" /> : null) : img(`/api/verifications/${id}/image`))}
      {pane('Closest reference on file', !r ? null : !r.best_match_profile_id ? missing
        : dynamic ? (strokes.ref ? <StrokePreview strokes={strokes.ref} className="h-full w-full" /> : null) : img(`/api/references/${r.best_match_profile_id}/image`))}
    </div>
  )
}

function FindingForm({ c, onSaved }) {
  const [finding, setFinding] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      onSaved(await api.post(`/api/cases/${c.id}/finding`, { finding, reason }))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {CHOICES.map((o) => (
          <button
            type="button"
            key={o.value}
            onClick={() => setFinding(o.value)}
            className={`flex items-start gap-3 rounded-[12px] border-2 p-4 text-left transition ${finding === o.value ? o.on : 'border-line hover:border-slate-300 hover:bg-[#f7fafd]'}`}
          >
            <o.Icon className="mt-0.5 h-5 w-5 shrink-0" />
            <span>
              <span className="block text-base font-semibold">{o.label}</span>
              <span className="block text-sm opacity-80">{o.note}</span>
            </span>
          </button>
        ))}
      </div>
      <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Notes: what you compared and what you observed" required minLength={3} />
      <Alert>{error}</Alert>
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={!finding || reason.trim().length < 3} loading={busy}>
          <Gavel className="h-4 w-4" /> Save decision and close case
        </Button>
        <span className="text-sm text-slate-500">Your decision is sealed in the ledger with the screenings it refers to.</span>
      </div>
    </form>
  )
}

export default function CaseDetail() {
  const { id } = useParams()
  const { user } = useAuth()
  const [c, setC] = useState(null)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [reopen, setReopen] = useState('')
  const [actionError, setActionError] = useState('')

  const load = useCallback(() => api.get(`/api/cases/${id}`).then(setC).catch((e) => setError(e.message)), [id])
  useEffect(() => {
    load()
  }, [load])

  if (error) return <Alert>{error}</Alert>
  if (!c) return <Spinner />

  const latest = c.findings[c.findings.length - 1]
  const decidedGenuine = c.status !== 'open' && latest?.finding === 'genuine'
  const canEdit = user.role === 'admin' || c.examiner_id === user.id
  const addReference = async (logId) => {
    setActionError('')
    try {
      setC(await api.post(`/api/cases/${c.id}/add-reference`, { verification_log_id: logId }))
    } catch (err) {
      setActionError(err.message)
    }
  }

  const addNote = async (e) => {
    e.preventDefault()
    setC(await api.post(`/api/cases/${c.id}/notes`, { text: note }))
    setNote('')
  }

  return (
    <>
      <Link to="/app/cases" className="mb-2.5 inline-flex items-center gap-1.5 text-[13.5px] font-medium text-white/85 hover:text-white">
        <ArrowLeft className="h-4 w-4" /> Cases
      </Link>
      <PageHeader eyebrow={`Case ${c.case_code}`} title={c.title} description={c.document_ref ? `Document reference ${c.document_ref}` : undefined}>
        <Badge tone={STATUS_TONE[c.status]}>{c.status_label}</Badge>
        {c.status === 'open' && (
          <Link to={`/app/screen?client=${c.client_id}&case=${c.id}`}>
            <Button><ScanSearch className="h-4 w-4" /> Screen a signature</Button>
          </Link>
        )}
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <Card title="Questioned signatures" subtitle={`Screened against ${c.client_name} (${c.client_code})`}>
            {c.screenings.length === 0 ? (
              <Empty icon={ScanSearch}>No screenings yet. Screen the questioned signature against the client's references.</Empty>
            ) : (
              <ul className="divide-y divide-slate-100">
                {c.screenings.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div>
                      <Link to={`/app/records/${s.id}`} className="font-medium text-brand-700 hover:underline">
                        {s.modality === 'static' ? 'Static' : 'Dynamic'} screening · {s.receipt_code}
                      </Link>
                      <div className="text-xs text-slate-500">{fmtDate(s.created_at)} · {s.performed_by_name}</div>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="text-sm tabular-nums text-slate-600">{s.confidence_score.toFixed(1)}%</span>
                      <ScreeningBadge value={s.screening_result} />
                      {decidedGenuine && canEdit && (
                        c.added_references.includes(s.id) ? (
                          <Badge tone="green">Added as reference</Badge>
                        ) : (
                          <Button size="sm" variant="subtle" onClick={() => addReference(s.id)} title="Add this signature to the client's references so later screenings can match it">
                            <PlusCircle className="h-4 w-4" /> Add as reference
                          </Button>
                        )
                      )}
                    </div>
                    <SignaturePair id={s.id} />
                  </li>
                ))}
              </ul>
            )}
            {decidedGenuine && canEdit && (
              <p className="mt-3 rounded-[10px] bg-[#f6f8fc] p-3 text-sm text-slate-600">
                Decided Genuine. You can add the questioned signature to {c.client_code}’s references, so later screenings of this client can match it.
              </p>
            )}
            <Alert className="mt-3">{actionError}</Alert>
          </Card>

          {c.status === 'open' && (
            <Card title="Your decision" subtitle="The screening result is decision support. You decide whether the signature is genuine or forged.">
              {c.screenings.length === 0 ? (
                <p className="text-sm text-slate-500">Screen the questioned signature first.</p>
              ) : (
                <FindingForm c={c} onSaved={setC} />
              )}
            </Card>
          )}
          {c.findings.length > 0 && (
            <Card title="Decision">
              <ul className="space-y-4">
                {c.findings.map((f) => (
                  <li key={f.id} className="rounded-[12px] border border-line p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Badge tone={FINDING[f.finding].tone}>{f.finding_label}</Badge>
                      <span className="text-xs text-slate-500">
                        {f.examiner_name} · {fmtDate(f.created_at)} · block #{f.block_index}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-slate-700">{f.reason}</p>
                    {f.second_opinion_status && f.second_opinion_status !== 'pending' && (
                      <p className="mt-2 text-xs text-slate-500">
                        Second opinion: <b>{f.second_opinion_status}</b>
                        {f.second_examiner_name && ` by ${f.second_examiner_name}`}
                        {f.second_opinion_note && `: ${f.second_opinion_note}`}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {c.status === 'closed' && (
            <Card title="Reopen case">
              <div className="flex gap-2">
                <input value={reopen} onChange={(e) => setReopen(e.target.value)} placeholder="Reason for reopening" className={`${fieldClass} min-w-0 flex-1`} />
                <Button variant="secondary" disabled={reopen.length < 1} onClick={async () => setC(await api.post(`/api/cases/${c.id}/reopen`, { text: reopen }))}>Reopen</Button>
              </div>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card title="Client">
            <Link to={`/app/clients/${c.client_id}`} className="font-medium text-brand-700 hover:underline">{c.client_name}</Link>
            <div className="text-sm text-slate-500">{c.client_code}</div>
            <div className="mt-3 text-sm text-slate-600">Examiner: {c.examiner_name}</div>
            {c.notes && <p className="mt-3 rounded-[10px] bg-[#f6f8fc] p-3 text-sm text-slate-700">{c.notes}</p>}
          </Card>
          <Card title="Timeline">
            <form onSubmit={addNote} className="mb-4 flex gap-2">
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note" aria-label="Add a note" className={`${fieldClass} min-w-0 flex-1 py-1.5`} />
              <Button size="sm" disabled={!note.trim()}>Add</Button>
            </form>
            <ol className="relative space-y-4 border-l border-line pl-5">
              {c.timeline.slice().reverse().map((e) => {
                const Icon = EVENT_ICON[e.kind] || MessageSquare
                return (
                  <li key={e.id} className="relative">
                    <span className="absolute -left-[29px] flex h-6 w-6 items-center justify-center rounded-full border border-line bg-white">
                      <Icon className="h-3.5 w-3.5 text-brand-600" />
                    </span>
                    <div className="text-sm text-slate-800">
                      {e.verification_log_id ? <Link to={`/app/records/${e.verification_log_id}`} className="hover:underline">{e.text}</Link> : e.text}
                    </div>
                    <div className="text-xs text-slate-500">{e.user_name || "ForgeBlock"} · {fmtDate(e.created_at)}</div>
                  </li>
                )
              })}
            </ol>
          </Card>
        </div>
      </div>
    </>
  )
}
