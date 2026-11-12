import { KeyRound, Lock, Unlock, UserPlus, Users as UsersIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../../api'
import { useAuth } from '../../auth'
import { Alert, Badge, Button, Card, ConfirmDialog, Field, Input, Modal, PageHeader, Segmented, Select, Spinner, Table, fmtDate, td } from '../../components/ui'

function Credentials({ rows }) {
  return (
    <div>
      <Alert kind="warn" className="mb-3">Copy these temporary passwords now. They are shown only once; users must change them at first sign-in.</Alert>
      <div className="max-h-80 overflow-y-auto rounded-lg border border-slate-200">
        <table className="w-full text-sm">
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.email}>
                <td className="px-3 py-2 font-medium">{r.account_code}</td>
                <td className="px-3 py-2 text-slate-600">{r.email}</td>
                <td className="px-3 py-2 font-mono">{r.temporary_password}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function CreateUser({ onDone }) {
  const [clients, setClients] = useState([])
  const [form, setForm] = useState({ full_name: '', email: '', role: 'examiner', account_code: '', client_id: '' })
  const [created, setCreated] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    api.get('/api/clients').then(setClients)
  }, [])
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })
  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const u = await api.post('/api/admin/users', { ...form, account_code: form.account_code || null, client_id: form.client_id ? Number(form.client_id) : null })
      setCreated([u])
      onDone()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }
  if (created) return <Credentials rows={created} />
  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Full name"><Input value={form.full_name} onChange={set('full_name')} required /></Field>
      <Field label="Email"><Input type="email" value={form.email} onChange={set('email')} required /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Role" hint={form.role === 'admin' ? 'Only emails listed in RESEARCH_TEAM_EMAILS on the server can be administrators.' : undefined}>
          <Select value={form.role} onChange={set('role')}>
            <option value="examiner">Examiner</option>
            <option value="admin">Administrator</option>
            <option value="client">Client</option>
          </Select>
        </Field>
        <Field label="Account code (optional)" hint="Generated if left empty."><Input value={form.account_code} onChange={set('account_code')} placeholder="EX-004" /></Field>
      </div>
      {form.role === 'client' && (
        <Field label="Client record" hint="The client can see screenings made on documents in their name.">
          <Select value={form.client_id} onChange={set('client_id')} required>
            <option value="">Choose…</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.full_name} ({c.client_code})</option>)}
          </Select>
        </Field>
      )}
      <Alert>{error}</Alert>
      <Button loading={busy}>Create account</Button>
    </form>
  )
}

function BulkCreate({ onDone }) {
  const [form, setForm] = useState({ prefix: 'EVAL', start: 1, count: 50, email_domain: 'forgeblock.local' })
  const [res, setRes] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      setRes(await api.post('/api/admin/users/bulk', { ...form, start: Number(form.start), count: Number(form.count) }))
      onDone()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }
  if (res) return <>{res.skipped.length > 0 && <Alert kind="info" className="mb-3">Already existed: {res.skipped.join(', ')}</Alert>}<Credentials rows={res.created} /></>
  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-sm text-slate-600">Creates numbered test examiner accounts for evaluation respondents, for example EVAL-01 to EVAL-50.</p>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Prefix"><Input value={form.prefix} onChange={(e) => setForm({ ...form, prefix: e.target.value.toUpperCase() })} /></Field>
        <Field label="Start at"><Input type="number" min="1" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} /></Field>
        <Field label="How many"><Input type="number" min="1" max="100" value={form.count} onChange={(e) => setForm({ ...form, count: e.target.value })} /></Field>
      </div>
      <Field label="Email domain"><Input value={form.email_domain} onChange={(e) => setForm({ ...form, email_domain: e.target.value })} /></Field>
      <Alert>{error}</Alert>
      <Button loading={busy}>Create accounts</Button>
    </form>
  )
}

export default function Users() {
  const { user: me } = useAuth()
  const [users, setUsers] = useState(null)
  const [role, setRole] = useState('')
  const [q, setQ] = useState('')
  const [modal, setModal] = useState(null)
  const [reset, setReset] = useState(null)
  const [toReset, setToReset] = useState(null)
  const load = () => api.get(`/api/admin/users?${new URLSearchParams({ ...(role && { role }), ...(q && { q }) })}`).then(setUsers)
  useEffect(() => {
    const t = setTimeout(load, 150)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, q])
  const [patchError, setPatchError] = useState('')
  const patch = async (u, body) => {
    setPatchError('')
    try {
      await api.patch(`/api/admin/users/${u.id}`, body)
    } catch (err) {
      setPatchError(err.message)
    }
    load()
  }
  return (
    <>
      <PageHeader title="Users and roles" description="Create accounts, set roles, reset passwords and disable accounts. There is no self-registration. Client accounts are also created when a client is registered with an email. Examiners are assigned to a group on the Clients page.">
        {me.study_mode && <Button variant="secondary" onClick={() => setModal('bulk')}><UsersIcon className="h-4 w-4" /> Evaluation accounts</Button>}
        <Button onClick={() => setModal('one')}><UserPlus className="h-4 w-4" /> New account</Button>
      </PageHeader>
      <Card bodyClass="p-0">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-5 py-3">
          <Segmented value={role} onChange={setRole} options={[{ value: '', label: 'All' }, { value: 'admin', label: 'Admins' }, { value: 'examiner', label: 'Examiners' }, { value: 'client', label: 'Clients' }]} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email or code" className="ml-auto w-64 rounded-lg border border-slate-300 px-3 py-1.5 text-sm" />
        </div>
        {patchError && <Alert className="mx-5 my-3">{patchError}</Alert>}
        {!users ? <Spinner /> : (
          <Table head={['Account', 'Code', 'Role', 'Group', 'Status', 'Last sign-in', { label: '', right: true }]}>
            {users.map((u) => (
              <tr key={u.id}>
                <td className={td}><div className="font-medium">{u.full_name}</div><div className="text-xs text-slate-500">{u.email}{u.client_code ? ` · ${u.client_code}` : ''}</div></td>
                <td className={`${td} font-mono text-xs`}>{u.account_code}</td>
                <td className={td}>
                  <select value={u.role} disabled={u.id === me.id} onChange={(e) => patch(u, { role: e.target.value })} className="rounded-md border border-slate-300 px-2 py-1 text-xs">
                    <option value="admin" disabled={u.is_test_account}>Administrator</option>
                    <option value="examiner">Examiner</option>
                    <option value="client">Client</option>
                  </select>
                </td>
                <td className={`${td} text-sm`}>
                  {u.role === 'examiner' ? (u.group_name || <span className="text-warn-700">No group</span>)
                    : u.role === 'client' ? <span className="text-slate-500">{u.client_code || '-'}</span>
                      : <span className="text-slate-400">-</span>}
                </td>
                <td className={td}>
                  <div className="flex flex-wrap gap-1">
                    <Badge tone={u.status === 'active' ? 'green' : 'gray'}>{u.status}</Badge>
                    {u.locked && <Badge tone="red"><Lock className="h-3 w-3" /> locked</Badge>}
                    {u.must_change_password && <Badge tone="amber">temp password</Badge>}
                    {me.study_mode && u.is_test_account && <Badge tone="violet">evaluation</Badge>}
                    {me.study_mode && !u.must_change_password && !u.research_use_accepted && <Badge tone="gray">terms not accepted</Badge>}
                  </div>
                </td>
                <td className={`${td} text-xs text-slate-500`}>{fmtDate(u.last_login)}</td>
                <td className={`${td} text-right`}>
                  <div className="flex justify-end gap-1">
                    {u.locked && <Button size="sm" variant="ghost" onClick={async () => { await api.post(`/api/admin/users/${u.id}/unlock`); load() }}><Unlock className="h-3.5 w-3.5" /> Unlock</Button>}
                    <Button size="sm" variant="ghost" onClick={() => setToReset(u)}><KeyRound className="h-3.5 w-3.5" /> Reset</Button>
                    {u.id !== me.id && (
                      <Button size="sm" variant="ghost" onClick={() => patch(u, { status: u.status === 'active' ? 'disabled' : 'active' })}>
                        {u.status === 'active' ? 'Disable' : 'Enable'}
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <Modal open={modal === 'one'} onClose={() => setModal(null)} title="New account"><CreateUser onDone={load} /></Modal>
      <Modal open={modal === 'bulk'} onClose={() => setModal(null)} title="Create test examiner accounts" wide><BulkCreate onDone={load} /></Modal>
      <ConfirmDialog
        open={!!toReset}
        title="Reset password?"
        confirmLabel={<><KeyRound className="h-4 w-4" /> Reset password</>}
        icon={KeyRound}
        onConfirm={async () => { setReset(await api.post(`/api/admin/users/${toReset.id}/reset-password`)); load() }}
        onClose={() => setToReset(null)}
      >
        Reset the password of <b>{toReset?.full_name}</b>? They get a new temporary password and must change it at their next sign-in.
      </ConfirmDialog>
      <Modal open={!!reset} onClose={() => setReset(null)} title="Password reset">{reset && <Credentials rows={[reset]} />}</Modal>
    </>
  )
}
