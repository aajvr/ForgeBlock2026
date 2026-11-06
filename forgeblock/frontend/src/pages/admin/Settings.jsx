import { CheckCircle2, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../api'
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Spinner, fmtDay } from '../../components/ui'

export default function Settings() {
  const [s, setS] = useState(null)
  const [ret, setRet] = useState(null)
  const [days, setDays] = useState('')
  const [msg, setMsg] = useState('')
  const [access, setAccess] = useState(null)
  const load = () => {
    api.get('/api/admin/access-policy').then(setAccess).catch(() => {})
    api.get('/api/admin/settings').then((d) => { setS(d); setDays(String(d.retention.days)) })
    api.get('/api/admin/retention').then(setRet)
  }
  useEffect(load, [])
  if (!s || !ret) return <Spinner />
  return (
    <>
      <PageHeader title="Policy and retention" description="How borderline results are handled, and how long client signature data is kept." />
      <Card title="Screening policy" className="mb-6">
        <p className="text-sm text-slate-700">
          Results that land close to the decision thresholds are shown as <b>Inconclusive</b> and open a case for the examiner, so the model never
          leans on a borderline result. The cut-off is set by the research team from the evaluation results and is not shown in the app.
        </p>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Data retention" subtitle="New clients are kept this many days, then their signature data is deleted automatically (checked daily).">
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
        <Card title="Deletion requests and due dates">
          {[['Requested by the client', ret.requested, 'red'], ['Past retention date', ret.due, 'red'], ['Due in the next 30 days', ret.due_soon, 'amber']].map(([title, list, tone]) => (
            <div key={title} className="mb-4">
              <div className="mb-1 text-sm font-medium">{title} <Badge tone={list.length ? tone : 'gray'}>{list.length}</Badge></div>
              {list.map((c) => (
                <div key={c.id} className="flex items-center justify-between border-b border-slate-100 py-1.5 text-sm">
                  <Link to={`/app/clients/${c.id}`} className="text-brand-700 hover:underline">{c.full_name} ({c.client_code})</Link>
                  <span className="flex items-center gap-2 text-xs text-slate-500">
                    {c.retention_until ? fmtDay(c.retention_until) : ''}
                    <button title="Delete signature data" className="text-slate-400 hover:text-bad-600" onClick={async () => { if (window.confirm(`Delete all signature data of ${c.client_code}?`)) { await api.del(`/api/clients/${c.id}`); load() } }}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </span>
                </div>
              ))}
            </div>
          ))}
        </Card>
        {access?.study_mode && <AccessControlCard a={access} />}
        <Card title="Sign-in security">
          <ul className="space-y-1 text-sm text-slate-700">
            <li>Accounts lock after {s.security.max_failed_logins} wrong passwords, for {s.security.lockout_minutes} minutes.</li>
            <li>Users are signed out after {s.security.idle_timeout_minutes} minutes without activity.</li>
            <li>New accounts get a temporary password that must be changed at first sign-in.</li>
          </ul>
          <p className="mt-2 text-xs text-slate-500">Change these in the backend .env file (MAX_FAILED_LOGINS, LOCKOUT_MINUTES, IDLE_TIMEOUT_MINUTES).</p>
        </Card>
      </div>
    </>
  )
}

// Chapter 3, Section 3.8: System Access Control and Ethical Use, as applied.
function AccessControlCard({ a }) {
  const rows = [
    ['Accounts are created only by the research team', !a.self_registration, 'No sign-up page or endpoint.'],
    ['Administrator access is limited to the research team', a.admins.every((x) => x.in_research_team),
      `${a.admins.length} admin account(s); allowed emails come from RESEARCH_TEAM_EMAILS.`],
    ['Users see only their own signatures and activity', true, 'Enforced by the backend for every request.'],
    ['Evaluation respondents use test accounts', a.test_accounts > 0, `${a.test_accounts} test account(s). Share prepared test clients from each client's page.`],
    ['No download or export of signature images', !a.image_export, 'Images are view-only inside the app.'],
    ['Research use only', a.accounts_without_research_terms === 0,
      a.accounts_without_research_terms ? `${a.accounts_without_research_terms} active account(s) have not accepted the research-use terms yet.` : 'Every active account accepted the research-use terms.'],
  ]
  return (
    <Card title="Access control and ethical use" subtitle="Chapter 3, Section 3.8, as ForgeBlock applies it.">
      <ul className="space-y-2 text-sm">
        {rows.map(([label, ok, note]) => (
          <li key={label} className="flex items-start gap-2">
            <CheckCircle2 className={`mt-0.5 h-4 w-4 shrink-0 ${ok ? 'text-ok-600' : 'text-slate-300'}`} />
            <span>
              <span className="font-medium">{label}</span>
              <span className="block text-xs text-slate-500">{note}</span>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  )
}
