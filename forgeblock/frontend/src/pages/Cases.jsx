import { Briefcase, Plus, Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../auth'
import { patchParams } from '../components/params'
import { Alert, Badge, Button, Card, Empty, Field, FindingBadge, Input, Modal, PageHeader, ScreeningBadge, Segmented, Select, Spinner, Table, Tabs, Textarea, fmtDay, td } from '../components/ui'

export const STATUS_TONE = { open: 'amber', awaiting_second_opinion: 'gray', closed: 'gray' }

export function NewCaseModal({ open, onClose, clientId }) {
  const navigate = useNavigate()
  const [clients, setClients] = useState([])
  const [form, setForm] = useState({ title: '', client_id: clientId || '', document_ref: '', notes: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (open) api.get('/api/clients').then(setClients).catch(() => {})
  }, [open])
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })
  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const c = await api.post('/api/cases', { ...form, client_id: Number(form.client_id), document_ref: form.document_ref || null, notes: form.notes || null })
      navigate(`/app/cases/${c.id}`)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal open={open} onClose={onClose} title="Open a case">
      <p className="mb-4 text-sm text-slate-600">
        Cases open by themselves when a screening is Inconclusive or Inconsistent. Open one by hand when a document comes in before you screen it.
      </p>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Questioned document" hint='For example "Loan application form" or "Deed of sale, page 2".'>
          <Input value={form.title} onChange={set('title')} required minLength={2} />
        </Field>
        <Field label="Client whose signature it claims to be">
          <Select value={form.client_id} onChange={set('client_id')} required>
            <option value="">Choose a client…</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.full_name} ({c.client_code})</option>
            ))}
          </Select>
        </Field>
        <Field label="Document reference (optional)">
          <Input value={form.document_ref} onChange={set('document_ref')} placeholder="e.g. LN-1023" />
        </Field>
        <Field label="Notes (optional)">
          <Textarea value={form.notes} onChange={set('notes')} />
        </Field>
        <Alert>{error}</Alert>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={busy}>Open case</Button>
        </div>
      </form>
    </Modal>
  )
}

function Handler({ c }) {
  const h = c.handled_by
  if (!h) return <span className="text-slate-400">-</span>
  return (
    <>
      <span className="block">{h.full_name}</span>
      <span className="block text-sm text-slate-500">{h.account_code}</span>
    </>
  )
}

export function CasesTable({ cases, compact = false, showExaminer = false }) {
  const navigate = useNavigate()
  const decision = (c) => (c.status === 'open' ? <Badge tone="amber">Needs decision</Badge> : <FindingBadge value={c.finding} />)
  const screening = (c) => (c.latest_screening ? <ScreeningBadge value={c.latest_screening} /> : <span className="text-sm text-slate-400">Not screened</span>)
  if (compact) {
    return (
      <Table head={['Case', 'Client', 'Screening', 'Decision']}>
        {cases.map((c) => (
          <tr key={c.id} className="cursor-pointer hover:bg-slate-50" onClick={() => navigate(`/app/cases/${c.id}`)}>
            <td className={td}>
              <span className="block whitespace-nowrap font-medium text-brand-700">{c.case_code}</span>
              <span className="block text-sm text-slate-500">{c.title}</span>
            </td>
            <td className={td}>{c.client_name}<span className="block text-sm text-slate-500">{c.client_code}</span></td>
            <td className={td}>{screening(c)}</td>
            <td className={`${td} whitespace-nowrap`}>{decision(c)}</td>
          </tr>
        ))}
      </Table>
    )
  }
  return (
    <Table head={['Case', 'Questioned signature', 'Client', ...(showExaminer ? ['Examiner'] : []), 'Screening', 'Decision', 'Opened']}>
      {cases.map((c) => (
        <tr key={c.id} className="cursor-pointer hover:bg-slate-50" onClick={() => navigate(`/app/cases/${c.id}`)}>
          <td className={`${td} whitespace-nowrap`}><span className="font-medium text-brand-700">{c.case_code}</span></td>
          <td className={td}>{c.title}</td>
          <td className={td}>{c.client_name} <span className="whitespace-nowrap text-sm text-slate-500">{c.client_code}</span></td>
          {showExaminer && <td className={td}><Handler c={c} /></td>}
          <td className={td}>{screening(c)}</td>
          <td className={`${td} whitespace-nowrap`}>{decision(c)}</td>
          <td className={`${td} whitespace-nowrap text-slate-500`}>{fmtDay(c.created_at)}</td>
        </tr>
      ))}
    </Table>
  )
}

export default function Cases() {
  const { user } = useAuth()
  const [params, setParams] = useSearchParams()
  const isAdmin = user.role === 'admin'
  const scope = isAdmin ? (params.get('scope') === 'mine' ? 'mine' : 'all') : 'mine'
  const status = params.has('status') ? (params.get('status') === 'all' ? '' : params.get('status')) : 'open'
  const setScope = (v) => patchParams(setParams, { scope: v === 'all' ? null : v })
  const setStatus = (v) => patchParams(setParams, { status: v === 'open' ? null : v || 'all' })
  const [q, setQ] = useState('')
  const [cases, setCases] = useState(null)
  const [error, setError] = useState('')
  const newOpen = params.get('new') === '1'

  useEffect(() => {
    const t = setTimeout(() => {
      const qs = new URLSearchParams({ scope, ...(status && { status }), ...(q && { q }) })
      api.get(`/api/cases?${qs}`).then(setCases).catch((e) => setError(e.message))
    }, 150)
    return () => clearTimeout(t)
  }, [scope, status, q])

  return (
    <>
      <PageHeader
        title="Cases"
        description="Screenings that were not clearly Consistent wait here for the examiner’s decision: Genuine or Forged, with notes."
      >
        <Button onClick={() => patchParams(setParams, { new: '1' }, false)} data-tour="new-case">
          <Plus className="h-4 w-4" /> Open a case
        </Button>
      </PageHeader>
      <Card bodyClass="p-0">
        <div className="px-5 pt-2">
          <Tabs
            value={status}
            onChange={setStatus}
            tabs={[{ value: 'open', label: 'Needs decision' }, { value: 'closed', label: 'Decided' }, { value: '', label: 'All' }]}
          />
        </div>
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-5 py-3">
          {isAdmin ? (
            <Segmented value={scope} onChange={setScope} options={[{ value: 'all', label: 'All examiners' }, { value: 'mine', label: 'Mine' }]} />
          ) : (
            <span className="text-sm text-slate-500">Your cases only.</span>
          )}
          <div className="relative ml-auto w-full max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search case, document or client" className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm outline-none focus:border-brand-600" />
          </div>
        </div>
        <Alert>{error}</Alert>
        {!cases ? (
          <Spinner />
        ) : cases.length === 0 ? (
          <Empty icon={Briefcase}>{status === 'open' ? 'Nothing waiting for a decision.' : 'No cases here yet.'}</Empty>
        ) : (
          <CasesTable cases={cases} showExaminer={isAdmin} />
        )}
      </Card>
      <NewCaseModal open={newOpen} onClose={() => patchParams(setParams, { new: null, client: null })} clientId={params.get('client') || ''} />
    </>
  )
}
