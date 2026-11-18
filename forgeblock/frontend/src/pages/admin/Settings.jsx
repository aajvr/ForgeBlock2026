import { CalendarClock, LockKeyhole, Ruler, Scale, ScanSearch, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../api'
import { Alert, Badge, Button, Card, ConfirmDialog, Field, Input, PageHeader, Spinner, fmtDay } from '../../components/ui'

export default function Settings() {
  const [s, setS] = useState(null)
  const [ret, setRet] = useState(null)
  const [days, setDays] = useState('')
  const [msg, setMsg] = useState('')
  const [toDelete, setToDelete] = useState(null)
  const load = () => {
    api.get('/api/admin/settings').then((d) => { setS(d); setDays(String(d.retention.days)) })
    api.get('/api/admin/retention').then(setRet)
  }
  useEffect(load, [])
  if (!s || !ret) return <Spinner />
  return (
    <>
      <PageHeader title="Policy and retention" description="How borderline results are handled, and how long client signature data is kept." />
      <Card icon={Scale} title="Screening policy" className="mb-6" data-tour="policy-settings">
        <p className="text-sm text-slate-700">
          Results that land close to the decision thresholds are shown as <b>Inconclusive</b> and open a case for the examiner, so the model never
          leans on a borderline result. The cut-off is set by the research team from the evaluation results and is not shown in the app.
        </p>
      </Card>

      <SizeMatchSetting value={s.screening?.size_mode || 'adaptive'} onSaved={load} />
      <GateSettings screening={s.screening || {}} onSaved={load} />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card icon={CalendarClock} title="Data retention" subtitle="New clients are kept this many days, then their signature data is deleted automatically (checked daily).">
          <div className="flex items-end gap-3">
            <Field label="Days (0 = keep until deleted)"><Input type="number" min="0" value={days} onChange={(e) => setDays(e.target.value)} /></Field>
            <Button variant="secondary" onClick={async () => { await api.put('/api/admin/settings/retention', { days: Number(days) }); setMsg('Saved.'); load() }}>Save</Button>
          </div>
          {msg && <Alert kind="success" className="mt-3">{msg}</Alert>}
          <p className="mt-4 text-sm text-slate-600">Deleting removes reference images, stroke files and embeddings. Screening records stay in the ledger as hashes and scores only, so the chain stays valid.</p>
          <div className="mt-4 flex items-center gap-3">
            <Button size="sm" variant="secondary" onClick={async () => { const r = await api.post('/api/admin/retention/run'); setMsg(r.deleted.length ? `Deleted data of ${r.deleted.join(', ')}.` : 'Nothing was due.'); load() }}>Run retention now</Button>
            <span className="text-xs text-slate-500">{ret.deleted_count} client(s) deleted so far</span>
          </div>
        </Card>
        <Card icon={Trash2} title="Deletion requests and due dates">
          {[['Requested by the client', ret.requested, 'red'], ['Past retention date', ret.due, 'red'], ['Due in the next 30 days', ret.due_soon, 'amber']].map(([title, list, tone]) => (
            <div key={title} className="mb-4">
              <div className="mb-1 text-sm font-medium">{title} <Badge tone={list.length ? tone : 'gray'}>{list.length}</Badge></div>
              {list.map((c) => (
                <div key={c.id} className="flex items-center justify-between border-b border-slate-100 py-1.5 text-sm">
                  <Link to={`/app/clients/${c.id}`} className="text-brand-700 hover:underline">{c.full_name} ({c.client_code})</Link>
                  <span className="flex items-center gap-2 text-xs text-slate-500">
                    {c.retention_until ? fmtDay(c.retention_until) : ''}
                    <button title="Delete signature data" className="text-slate-400 hover:text-bad-600" onClick={() => setToDelete(c)}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </span>
                </div>
              ))}
            </div>
          ))}
        </Card>
        <Card icon={LockKeyhole} title="Sign-in security">
          <ul className="space-y-1 text-sm text-slate-700">
            <li>Accounts lock after {s.security.max_failed_logins} wrong passwords, for {s.security.lockout_minutes} minutes.</li>
            <li>Users are signed out after {s.security.idle_timeout_minutes} minutes without activity.</li>
            <li>New accounts get a temporary password that must be changed at first sign-in.</li>
          </ul>
        </Card>
      </div>
      <ConfirmDialog
        open={!!toDelete}
        title="Delete signature data?"
        confirmLabel={<><Trash2 className="h-4 w-4" /> Delete</>}
        danger
        icon={Trash2}
        onConfirm={async () => { await api.del(`/api/clients/${toDelete.id}`); load() }}
        onClose={() => setToDelete(null)}
      >
        Delete all signature data of <b>{toDelete?.full_name}</b> ({toDelete?.client_code})? This cannot be undone.
      </ConfirmDialog>
    </>
  )
}

// v8.25: one system-wide setting for static size matching (adaptive by default).
const SIZE_MODES = [
  ['adaptive', 'Adaptive', 'Resize only when the questioned signature is more than 2× larger or smaller than the references (recommended).'],
  ['always', 'Always', 'Always resize the questioned signature to the width of the references.'],
  ['off', 'Off', 'Never resize.'],
]

// Checks that can move a model result (ml/screening.py). Both are on by default.
const GATES = [
  ['dynamic_gate', 'Dynamic: shape and handwriting check',
    'When an iPad signature clearly looks different from the client’s signatures, or most of its handwriting features are outside their usual range: an Inconclusive result that leans not genuine becomes Inconsistent, and a Consistent result goes to the examiner as Inconclusive.'],
  ['feature_gate', 'Static: handwriting feature check',
    'When more than one handwriting feature of a scanned signature is outside the client’s usual range, a Consistent result goes to the examiner as Inconclusive.'],
]

function GateSettings({ screening, onSaved }) {
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')
  const toggle = async (key, label, on) => {
    setBusy(key)
    try {
      await api.put('/api/admin/settings/screening', { [key]: on })
      setMsg(`${label} is ${on ? 'on' : 'off'} for new screenings.`)
      onSaved()
    } finally { setBusy('') }
  }
  return (
    <Card icon={ScanSearch} title="Extra screening checks" className="mb-6">
      <p className="max-w-3xl text-sm text-slate-700">
        These checks do not use the model. They can only send a result to the examiner or mark a clearly different signature
        Inconsistent; they never make a result Consistent. Changes apply to new screenings only and are written to the audit log.
      </p>
      <ul className="mt-4 space-y-3">
        {GATES.map(([key, label, note]) => {
          const on = screening[key] !== false
          return (
            <li key={key} className="flex items-start justify-between gap-4 rounded-[10px] border border-slate-200 px-3 py-2.5">
              <span className="min-w-0 text-sm">
                <span className="block font-medium">{label}</span>
                <span className="block text-xs text-slate-500">{note}</span>
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={on}
                aria-label={label}
                disabled={busy === key}
                onClick={() => toggle(key, label, !on)}
                className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition disabled:opacity-60 ${on ? 'bg-brand-600' : 'bg-slate-300'}`}
              >
                <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-5' : 'translate-x-0.5'}`} />
              </button>
            </li>
          )
        })}
      </ul>
      {msg && <Alert kind="success" className="mt-3">{msg}</Alert>}
    </Card>
  )
}

function SizeMatchSetting({ value, onSaved }) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const choose = async (mode) => {
    if (mode === value) return
    setBusy(true)
    try {
      await api.put('/api/admin/settings/screening', { size_mode: mode })
      setMsg(`Size matching is set to ${mode} for new screenings.`)
      onSaved()
    } finally { setBusy(false) }
  }
  return (
    <Card icon={Ruler} title="Static screening: size matching" className="mb-6">
      <div className="max-w-3xl text-sm text-slate-700">
        <p>
          A questioned signature photographed much closer or farther than the client’s references can score lower than it should.
          <b> Adaptive</b> resizes it only in that case, and the details also show the result without resizing, so the examiner can
          compare both. Normal uploads are never resized.
        </p>
        <p className="mt-2 text-slate-600">
          Every result records how it was sized. The change applies to new screenings only and is written to the audit log.
        </p>
      </div>
      <div role="radiogroup" aria-label="Size matching" className="mt-4 grid gap-2 sm:grid-cols-3">
        {SIZE_MODES.map(([mode, label, note]) => (
          <button key={mode} type="button" role="radio" aria-checked={value === mode} disabled={busy} onClick={() => choose(mode)}
            className={`rounded-[10px] border px-3 py-2 text-left text-sm transition disabled:opacity-60 ${value === mode ? 'border-brand-600 bg-brand-50 ring-1 ring-brand-600' : 'border-slate-200 hover:border-slate-300'}`}>
            <span className="block font-medium">{label}</span>
            <span className="block text-xs text-slate-500">{note}</span>
          </button>
        ))}
      </div>
      {msg && <Alert kind="success" className="mt-3">{msg}</Alert>}
    </Card>
  )
}
