import { Briefcase, FolderInput, FolderOpen, FolderPlus, Lock, MoreHorizontal, Pencil, Plus, ScanSearch, Share2, Trash2, UserPlus, Users } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../auth'
import ImagePicker from '../components/ImagePicker'
import SheetEnroll from '../components/SheetEnroll'
import SignaturePad from '../components/SignaturePad'
import { penMissing } from '../components/penData'
import { AuthImage, DevPenNotice, LimitedPenBadge, PenDataHint, StrokePreview } from '../components/shared'
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Empty,
  Field,
  Input,
  Modal,
  PageHeader,
  ScreeningBadge,
  Segmented,
  Select,
  Spinner,
  StrengthBadge,
  Table,
  Tabs,
  Textarea,
  fmtDate,
  fmtDay,
  td,
} from '../components/ui'

// A client account's sign-in details, shown once after it is created.
export function AccountCreated({ account }) {
  if (!account) return null
  return (
    <div className="rounded-xl border border-ok-100 bg-ok-50 p-4 text-sm">
      <div className="font-semibold text-ok-700">Client account created</div>
      <p className="mt-1 text-slate-700">Give these to the client. The temporary password is shown only once; they change it at first sign-in, or they can sign in with Microsoft or Google using this email.</p>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <dt className="text-slate-500">Email</dt><dd className="font-medium">{account.email}</dd>
        <dt className="text-slate-500">Account</dt><dd className="font-medium">{account.account_code}</dd>
        <dt className="text-slate-500">Temporary password</dt><dd className="font-mono font-medium">{account.temporary_password}</dd>
      </dl>
    </div>
  )
}

function NewClientModal({ open, onClose, groups, defaultGroup }) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const study = user.study_mode
  const isAdmin = user.role === 'admin'
  const blank = { full_name: '', email: '', is_practice: false, notes: '', group_id: '' }
  const [form, setForm] = useState(blank)
  const [ack, setAck] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState(null)
  useEffect(() => {
    if (open) {
      setForm({ ...blank, group_id: defaultGroup ? String(defaultGroup) : '' })
      setCreated(null)
      setError('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultGroup])
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })
  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const c = await api.post('/api/clients', {
        ...form,
        full_name: form.full_name || null,
        notes: form.notes || null,
        email: form.email.trim() || null,
        group_id: isAdmin && form.group_id ? Number(form.group_id) : null,
      })
      if (c.new_account) setCreated(c)
      else navigate(`/app/clients/${c.id}`)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }
  if (created) {
    return (
      <Modal open={open} onClose={onClose} title="Client registered">
        <AccountCreated account={created.new_account} />
        <div className="mt-5 flex justify-end">
          <Button onClick={() => navigate(`/app/clients/${created.id}`)}>Continue to the signature card</Button>
        </div>
      </Modal>
    )
  }
  const myGroup = user.group_name
  return (
    <Modal open={open} onClose={onClose} title="Register a client">
      <form onSubmit={submit} className="space-y-4">
        {study ? (
          <Field label="Label (optional)" hint="Use a code or a made-up name, never a real person's name. Left empty, the client code is used.">
            <Input value={form.full_name} onChange={set('full_name')} maxLength={120} />
          </Field>
        ) : (
          <Field label="Client name" hint="Left empty, the client code is used.">
            <Input value={form.full_name} onChange={set('full_name')} maxLength={120} />
          </Field>
        )}
        <Field label="Client email (optional)" hint="Creates the client's own account so they can see screenings on documents in their name.">
          <Input type="email" value={form.email} onChange={set('email')} placeholder="name@example.com" />
        </Field>
        {isAdmin ? (
          <Field label="Group" hint="The group's examiner is the only examiner who can see this client.">
            <Select value={form.group_id} onChange={set('group_id')}>
              <option value="">No group</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>{g.name}{g.examiner ? ` (${g.examiner.full_name})` : ' (no examiner yet)'}</option>
              ))}
            </Select>
          </Field>
        ) : (
          myGroup && <p className="text-sm text-slate-600">The client goes into your group, <b>{myGroup}</b>.</p>
        )}
        {study && (user.is_test_account ? (
          <Alert kind="info">Test accounts register practice clients only (PR- code).</Alert>
        ) : (
          <label className="flex items-start gap-2 rounded-lg border border-slate-200 p-3 text-sm">
            <input type="checkbox" className="mt-0.5" checked={form.is_practice} onChange={(e) => setForm({ ...form, is_practice: e.target.checked })} />
            <span>
              <span className="font-medium">Practice client</span>
              <span className="block text-slate-500">For testing with a made-up practice signature, not a real legal signature. Gets a PR- code.</span>
            </span>
          </label>
        ))}
        {study && (
          <label className="flex items-start gap-2 rounded-lg border border-warn-100 bg-warn-50 p-3 text-sm">
            <input type="checkbox" className="mt-0.5" checked={ack} onChange={(e) => setAck(e.target.checked)} required />
            <span>The signatures I add will be samples prepared by the researchers or made-up practice signatures, not my own or anyone else's legal signature.</span>
          </label>
        )}
        <Field label="Notes (optional)">
          <Textarea value={form.notes} onChange={set('notes')} />
        </Field>
        <Alert>{error}</Alert>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={busy} disabled={study && !ack}>Register client</Button>
        </div>
      </form>
    </Modal>
  )
}


export function DeleteClientModal({ client, onClose, onDeleted }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (!client) return null
  const refs = (client.static_count || 0) + (client.dynamic_count || 0)
  const confirm = async () => {
    setBusy(true)
    setError('')
    try {
      await api.del(`/api/clients/${client.id}`)
      onDeleted?.(client)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal open onClose={onClose} title="Delete this client?">
      <div className="flex gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-bad-50 text-bad-600"><Trash2 className="h-5 w-5" /></span>
        <div className="text-[15px] text-slate-700">
          <p>
            Are you sure you want to delete <b>{client.full_name}</b> ({client.client_code}) and their signatures?
          </p>
          <p className="mt-2 text-sm text-slate-500">
            This removes {refs} reference signature{refs === 1 ? '' : 's'} and every stored image. Screening records stay in the ledger as hashes, so
            the chain stays valid. This cannot be undone.
          </p>
        </div>
      </div>
      <Alert className="mt-4">{error}</Alert>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="danger" loading={busy} onClick={confirm}><Trash2 className="h-4 w-4" /> Delete client</Button>
      </div>
    </Modal>
  )
}

// Admin: create or edit a group (folder) and choose its one examiner.
function GroupModal({ group, open, onClose, onSaved, freeExaminers }) {
  const [form, setForm] = useState({ name: '', description: '', examiner_id: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (open) {
      setForm({ name: group?.name || '', description: group?.description || '', examiner_id: group?.examiner ? String(group.examiner.id) : '' })
      setError('')
    }
  }, [open, group])
  const choices = [...(group?.examiner ? [group.examiner] : []), ...freeExaminers]
  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const body = { name: form.name, description: form.description }
      if (form.examiner_id) body.examiner_id = Number(form.examiner_id)
      else if (group) body.unassign_examiner = true
      const g = group ? await api.patch(`/api/groups/${group.id}`, body) : await api.post('/api/groups', body)
      onSaved(g)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal open={open} onClose={onClose} title={group ? `Edit ${group.name}` : 'New group'}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Group name" hint='For example "Lawyers", "OSS" or "CCJE".'>
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required minLength={2} maxLength={80} />
        </Field>
        <Field label="Description (optional)">
          <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={200} />
        </Field>
        <Field label="Assigned examiner" hint="Each group has one examiner, and an examiner handles one group. Only this examiner sees the group's clients.">
          <Select value={form.examiner_id} onChange={(e) => setForm({ ...form, examiner_id: e.target.value })}>
            <option value="">No examiner yet</option>
            {choices.map((u) => <option key={u.id} value={u.id}>{u.full_name} ({u.account_code})</option>)}
          </Select>
        </Field>
        <Alert>{error}</Alert>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={busy}>{group ? 'Save' : 'Create group'}</Button>
        </div>
      </form>
    </Modal>
  )
}

// Admin: move a client to another group.
function MoveClientModal({ client, groups, onClose, onMoved }) {
  const [to, setTo] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => setTo(client?.group_id ? String(client.group_id) : ''), [client])
  if (!client) return null
  const target = groups.find((g) => String(g.id) === to)
  const move = async () => {
    setBusy(true)
    setError('')
    try {
      await api.patch(`/api/clients/${client.id}`, to ? { group_id: Number(to) } : { remove_from_group: true })
      onMoved(client, target)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal open onClose={onClose} title={`Move ${client.full_name}`}>
      <Field label="Group">
        <Select value={to} onChange={(e) => setTo(e.target.value)}>
          <option value="">No group</option>
          {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </Select>
      </Field>
      <p className="mt-3 text-sm text-slate-600">
        {target?.examiner
          ? `${target.examiner.full_name} will see this client and its screenings and cases. The current examiner will no longer see them.`
          : 'Only administrators will see this client until the group has an examiner.'}
      </p>
      <Alert className="mt-3">{error}</Alert>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button loading={busy} onClick={move}>Move client</Button>
      </div>
    </Modal>
  )
}

// Right-click (or the ⋯ button) on a client row.
function RowMenu({ menu, onClose, onDelete, onMove, isAdmin }) {
  const navigate = useNavigate()
  const ref = useRef(null)
  useEffect(() => {
    if (!menu) return
    const close = (e) => !ref.current?.contains(e.target) && onClose()
    const esc = (e) => e.key === 'Escape' && onClose()
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    window.addEventListener('scroll', onClose, true)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', esc)
      window.removeEventListener('scroll', onClose, true)
    }
  }, [menu, onClose])
  if (!menu) return null
  const c = menu.client
  const item = 'flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm hover:bg-slate-100'
  const go = (to) => {
    onClose()
    navigate(to)
  }
  return (
    <div
      ref={ref}
      className="fixed z-50 w-56 rounded-xl border border-slate-200 bg-white p-1 shadow-xl"
      style={{ top: Math.min(menu.y, window.innerHeight - 260), left: Math.min(menu.x, window.innerWidth - 240) }}
      role="menu"
    >
      <div className="truncate px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{c.client_code}</div>
      <button className={item} onClick={() => go(`/app/clients/${c.id}`)}><Users className="h-4 w-4 text-slate-500" /> Open signature card</button>
      <button className={item} onClick={() => go(`/app/screen?client=${c.id}`)}><ScanSearch className="h-4 w-4 text-slate-500" /> Screen a signature</button>
      <button className={item} onClick={() => go(`/app/cases?new=1&client=${c.id}`)}><Briefcase className="h-4 w-4 text-slate-500" /> Open a case</button>
      {isAdmin && (
        <>
          <button className={item} onClick={() => { onClose(); onMove(c) }}><FolderInput className="h-4 w-4 text-slate-500" /> Move to group</button>
          <div className="my-1 h-px bg-slate-100" />
          <button className={`${item} text-bad-700 hover:bg-bad-50`} onClick={() => { onClose(); onDelete(c) }}>
            <Trash2 className="h-4 w-4" /> Delete client
          </button>
        </>
      )}
    </div>
  )
}

// Groups have no stored colour, so each one keeps a fixed colour from its id.
const FOLDER_COLOURS = [
  ['#0f6cbd', '#0c4f8c'],
  ['#0f766e', '#0b4f4a'],
  ['#4338ca', '#312e81'],
  ['#7e22ce', '#581c87'],
  ['#0369a1', '#0c4a6e'],
  ['#a21caf', '#701a75'],
]
const GREY_FOLDER = ['#64748b', '#475569']
const folderStyle = (group) => {
  const [folder, deep] = group ? FOLDER_COLOURS[group.id % FOLDER_COLOURS.length] : GREY_FOLDER
  return { '--folder': folder, '--folder-deep': deep }
}

// The bar at the top of a folder: group name and its assigned examiner.
function FolderHeader({ group, isAdmin, onEdit, onDelete, mine }) {
  return (
    <div className="mb-5 flex flex-wrap items-center gap-4 rounded-2xl border border-slate-200/70 bg-white px-5 py-4 shadow-soft" style={folderStyle(group)}>
      <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-[linear-gradient(150deg,var(--folder),var(--folder-deep))] text-white shadow-sm"><FolderOpen className="h-6 w-6" /></span>
      <div className="min-w-0">
        <div className="text-xl font-semibold tracking-tight">{group ? group.name : 'Clients without a group'}</div>
        {group?.description && <div className="text-sm text-slate-600">{group.description}</div>}
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-3">
        {group && (
          <div className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2">
            {group.examiner ? (
              <>
                <Avatar name={group.examiner.full_name} size="h-8 w-8 text-xs" />
                <div className="leading-tight">
                  <div className="text-xs text-slate-500">Assigned examiner</div>
                  <div className="text-sm font-medium">{mine ? 'You' : group.examiner.full_name} <span className="text-slate-500">· {group.examiner.account_code}</span></div>
                </div>
              </>
            ) : (
              <span className="text-sm text-warn-700">No examiner assigned yet</span>
            )}
          </div>
        )}
        {isAdmin && group && (
          <>
            <Button variant="secondary" size="sm" onClick={onEdit}><Pencil className="h-3.5 w-3.5" /> Edit group</Button>
            {group.client_count === 0 && <Button variant="ghost" size="sm" onClick={onDelete}><Trash2 className="h-3.5 w-3.5" /> Delete</Button>}
          </>
        )}
      </div>
    </div>
  )
}

// Up to 3 overlapping initials bubbles, then "+N". Initials only: the study allows no photos.
function ClientBubbles({ clients, total }) {
  const shown = clients.slice(0, 3)
  const more = total - shown.length
  if (total === 0) return <div className="h-9 text-sm leading-9 text-white/75">No clients yet</div>
  return (
    <div className="flex items-center -space-x-1.5">
      {shown.map((c) => <Avatar key={c.id} name={c.full_name} role="client" size="h-9 w-9 text-[11.5px] ring-2 ring-white" />)}
      {more > 0 && <span className="flex h-9 min-w-9 items-center justify-center rounded-full bg-white px-1.5 text-xs font-semibold text-slate-700 ring-2 ring-white">+{more}</span>}
    </div>
  )
}

function FolderCard({ group, clients, count, onOpen, children }) {
  return (
    <button onClick={onOpen} style={folderStyle(group)} className="folder flex min-h-52 flex-col p-5 text-left text-white">
      <div className="flex w-full items-center justify-between gap-3">
        <ClientBubbles clients={clients} total={count} />
        <span className="shrink-0 rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-semibold">{count} client{count === 1 ? '' : 's'}</span>
      </div>
      <div className="mt-auto w-full pt-5">
        <div className="text-xl font-semibold tracking-tight">{group ? group.name : 'Without a group'}</div>
        {children}
      </div>
    </button>
  )
}

function FolderGrid({ data, clients, onOpen, onNew }) {
  return (
    <div className="grid gap-x-5 gap-y-6 sm:grid-cols-2 xl:grid-cols-3">
      {data.groups.map((g) => (
        <FolderCard key={g.id} group={g} clients={clients.filter((c) => c.group_id === g.id)} count={g.client_count} onOpen={() => onOpen(String(g.id))}>
          {g.description && <div className="truncate text-sm text-white/80">{g.description}</div>}
          <div className="mt-2 flex items-center gap-2 border-t border-white/20 pt-2.5 text-sm">
            {g.examiner ? (
              <>
                <Avatar name={g.examiner.full_name} size="h-7 w-7 text-[11px]" />
                <span className="min-w-0 truncate">{g.examiner.full_name} <span className="text-white/75">· {g.examiner.account_code}</span></span>
              </>
            ) : (
              <span className="font-medium text-white/90">No examiner assigned</span>
            )}
          </div>
        </FolderCard>
      ))}
      {data.ungrouped_count > 0 && (
        <FolderCard group={null} clients={clients.filter((c) => !c.group_id)} count={data.ungrouped_count} onOpen={() => onOpen('none')}>
          <div className="mt-2 border-t border-white/20 pt-2.5 text-sm text-white/90">Move them into a group.</div>
        </FolderCard>
      )}
      <button onClick={onNew} className="mt-[1.05rem] flex min-h-52 flex-col items-center justify-center gap-2 rounded-[1.25rem] border-2 border-dashed border-brand-300 bg-brand-50/40 p-5 text-brand-700 transition hover:border-brand-500 hover:bg-brand-50">
        <FolderPlus className="h-7 w-7" />
        <span className="font-medium">New group</span>
      </button>
    </div>
  )
}

function ClientsTable({ clients, user, onRowMenu }) {
  const navigate = useNavigate()
  return (
    <Table head={['Client', 'Code', 'Static references', 'Dynamic references', 'Account', 'Registered', '']}>
      {clients.map((c) => (
        <tr
          key={c.id}
          className="cursor-pointer hover:bg-brand-50/50"
          onClick={() => navigate(`/app/clients/${c.id}`)}
          onContextMenu={(e) => {
            e.preventDefault()
            onRowMenu({ client: c, x: e.clientX, y: e.clientY })
          }}
        >
          <td className={td}>
            <span className="font-medium text-slate-900">{c.full_name}</span>
            {user.study_mode && c.is_practice && <Badge tone="violet" className="ml-2">Practice</Badge>}
            {c.shared && <Badge tone="gray" className="ml-2">Shared with you</Badge>}
            {c.deletion_requested && <Badge tone="red" className="ml-2">Deletion requested</Badge>}
          </td>
          <td className={`${td} font-mono text-sm`}>{c.client_code}</td>
          <td className={td}><span className="mr-2 tabular-nums">{c.static_count}</span><StrengthBadge strength={c.static_strength} /></td>
          <td className={td}><span className="mr-2 tabular-nums">{c.dynamic_count}</span><StrengthBadge strength={c.dynamic_strength} /></td>
          <td className={td}>{c.account ? <Badge tone="green" title={c.account.email}>Has account</Badge> : <span className="text-sm text-slate-400">None</span>}</td>
          <td className={`${td} text-slate-500`}>{fmtDay(c.created_at)}</td>
          <td className={`${td} w-10 text-right`}>
            <button
              className="rounded-md p-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
              aria-label={`Actions for ${c.client_code}`}
              onClick={(e) => {
                e.stopPropagation()
                const r = e.currentTarget.getBoundingClientRect()
                onRowMenu({ client: c, x: r.right - 224, y: r.bottom + 4 })
              }}
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </td>
        </tr>
      ))}
    </Table>
  )
}

export default function Clients() {
  const { user } = useAuth()
  const [params, setParams] = useSearchParams()
  const isAdmin = user.role === 'admin'
  const [groups, setGroups] = useState(null)
  const [clients, setClients] = useState(null)
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [menu, setMenu] = useState(null)
  const [toDelete, setToDelete] = useState(null)
  const [toMove, setToMove] = useState(null)
  const [editGroup, setEditGroup] = useState(null) // null | 'new' | group
  const [msg, setMsg] = useState('')
  // Admins start at the folder list; an examiner is always inside their own folder.
  const folder = isAdmin ? params.get('group') : (user.group_id ? String(user.group_id) : 'none')
  const loadGroups = useCallback(() => api.get('/api/groups').then(setGroups), [])
  const loadClients = useCallback(() => api.get(`/api/clients${q ? `?q=${encodeURIComponent(q)}` : ''}`).then(setClients), [q])
  useEffect(() => { loadGroups() }, [loadGroups])
  useEffect(() => {
    const t = setTimeout(loadClients, 150)
    return () => clearTimeout(t)
  }, [loadClients])
  const reload = () => { loadGroups(); loadClients() }
  const closeMenu = useCallback(() => setMenu(null), [])
  if (!groups || !clients) return <Spinner />

  const group = !isAdmin ? groups.groups[0] || null
    : folder && folder !== 'none' ? groups.groups.find((g) => String(g.id) === folder) : null
  // Examiners see only their own clients anyway (the backend filters them).
  const inFolder = !isAdmin || !folder ? clients
    : folder === 'none' ? clients.filter((c) => !c.group_id)
      : clients.filter((c) => String(c.group_id) === folder)
  const showGrid = isAdmin && !folder && !q
  const open_ = (g) => setParams(g ? { group: g } : {})

  return (
    <>
      <PageHeader
        title="Clients"
        eyebrow={isAdmin && folder ? <button onClick={() => open_(null)} className="hover:underline">← All groups</button> : undefined}
        description={isAdmin
          ? 'Clients are kept in groups. Each group has one examiner, who is the only examiner that can see its clients. Right-click a client for quick actions.'
          : 'The clients of your group. At least 7 references per module, 20 recommended, up to 30. More signatures, from more than one sitting, make screening more reliable.'}
      >
        {isAdmin && !folder && <Button variant="secondary" onClick={() => setEditGroup('new')}><FolderPlus className="h-4 w-4" /> New group</Button>}
        <Button onClick={() => setOpen(true)} data-tour="new-client">
          <UserPlus className="h-4 w-4" /> Register client
        </Button>
      </PageHeader>
      <Alert kind="success" className="mb-4">{msg}</Alert>
      {!isAdmin && !user.group_id && (
        <Alert kind="info" className="mb-4">You are not assigned to a group yet. You see only the clients you registered. An administrator assigns you to a group.</Alert>
      )}
      {(folder || !isAdmin) && (group || folder === 'none' ? (
        <FolderHeader group={group} isAdmin={isAdmin} mine={!isAdmin}
          onEdit={() => setEditGroup(group)}
          onDelete={async () => { await api.del(`/api/groups/${group.id}`); open_(null); reload() }} />
      ) : null)}
      <div className="mb-4">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={showGrid || !folder ? 'Search all clients by name or code' : 'Search this group'} className="w-full max-w-sm rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-brand-600 focus:ring-2 focus:ring-brand-100" />
      </div>
      {showGrid ? (
        <FolderGrid data={groups} clients={clients} onOpen={open_} onNew={() => setEditGroup('new')} />
      ) : (
        <Card bodyClass="p-0">
          {inFolder.length === 0 ? (
            <Empty icon={Users}>{q ? 'No clients match.' : 'No clients in this group yet. Register a client and add their reference signatures.'}</Empty>
          ) : (
            <ClientsTable clients={inFolder} user={user} onRowMenu={setMenu} />
          )}
        </Card>
      )}
      <RowMenu menu={menu} onClose={closeMenu} onDelete={setToDelete} onMove={setToMove} isAdmin={isAdmin} />
      <DeleteClientModal
        client={toDelete}
        onClose={() => setToDelete(null)}
        onDeleted={(c) => {
          setToDelete(null)
          setMsg(`${c.full_name} (${c.client_code}) and their signatures were deleted.`)
          reload()
        }}
      />
      <MoveClientModal client={toMove} groups={groups.groups} onClose={() => setToMove(null)}
        onMoved={(c, g) => { setToMove(null); setMsg(`${c.full_name} moved to ${g ? g.name : 'no group'}.`); reload() }} />
      <GroupModal open={!!editGroup} group={editGroup === 'new' ? null : editGroup} freeExaminers={groups.unassigned_examiners}
        onClose={() => setEditGroup(null)}
        onSaved={(g) => { setEditGroup(null); setMsg(`Group ${g.name} saved.`); reload(); if (isAdmin) open_(String(g.id)) }} />
      <NewClientModal open={open} onClose={() => setOpen(false)} groups={groups.groups} defaultGroup={group?.id} />
    </>
  )
}


function StrengthMeter({ strength }) {
  const { count, minimum, recommended, maximum } = strength
  return (
    <div>
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium tabular-nums">{count} of {maximum}</span>
        <StrengthBadge strength={strength} />
      </div>
      <div className="relative mt-2 h-2 rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${count >= recommended ? 'bg-ok-600' : count >= minimum ? 'bg-brand-600' : 'bg-warn-600'}`} style={{ width: `${(count / maximum) * 100}%` }} />
        {[minimum, recommended].map((m) => (
          <span key={m} className="absolute top-[-3px] h-3.5 w-px bg-slate-400" style={{ left: `${(m / maximum) * 100}%` }} />
        ))}
      </div>
      <div className="relative mt-1 h-4 text-[11.5px] text-slate-500">
        <span className="absolute -translate-x-1/2" style={{ left: `${(minimum / maximum) * 100}%` }}>min {minimum}</span>
        <span className="absolute -translate-x-1/2" style={{ left: `${(recommended / maximum) * 100}%` }}>recommended {recommended}</span>
      </div>
      <p className="mt-1 text-xs text-slate-500">{strength.note}</p>
      {strength.sitting_tip && <p className="mt-1 text-xs text-amber-700">{strength.sitting_tip}</p>}
    </div>
  )
}

function RefTile({ p, modality, onRemove }) {
  const [strokes, setStrokes] = useState(null)
  useEffect(() => {
    if (modality === 'dynamic') api.get(`/api/references/${p.id}/strokes`).then((d) => setStrokes(d.strokes)).catch(() => {})
  }, [p.id, modality])
  return (
    <div className={`group relative rounded-lg border bg-white p-2 ${p.flagged ? 'border-warn-600' : 'border-slate-200'}`}>
      <div className="flex h-20 items-center justify-center">
        {modality === 'static' ? <AuthImage src={`/api/references/${p.id}/image?view=model`} className="h-20 w-full object-contain" /> : strokes && <StrokePreview strokes={strokes} className="h-16 w-full" />}
      </div>
      <div className="mt-1 flex items-center justify-between text-[12.5px] text-slate-500">
        <span>Quality {Math.round(p.quality)}</span>
        {p.consistency !== null && <span className={p.flagged ? 'font-medium text-warn-700' : ''}>Match {p.consistency.toFixed(2)}</span>}
      </div>
      {p.flagged && <div className="mt-1 text-[12.5px] font-medium text-warn-700">Looks different from the others</div>}
      {p.pen_label && <div className="mt-1"><LimitedPenBadge missing={p.pen_missing} /></div>}
      {onRemove && <button onClick={() => onRemove(p)} className="absolute right-1 top-1 hidden rounded-md bg-white/90 p-1 text-slate-500 shadow-sm hover:text-bad-600 group-hover:block" aria-label="Remove reference">
        <Trash2 className="h-3.5 w-3.5" />
      </button>}
    </div>
  )
}

function StaticEnroll({ client, onDone }) {
  const [mode, setMode] = useState('sheet')
  return (
    <div className="space-y-4">
      <Segmented
        value={mode}
        onChange={setMode}
        options={[
          { value: 'sheet', label: 'Enrollment sheet (phone)' },
          { value: 'images', label: 'Upload signature images' },
        ]}
      />
      {mode === 'sheet' ? <SheetEnroll client={client} onDone={onDone} /> : <ImageEnroll client={client} onDone={onDone} />}
    </div>
  )
}

function ImageEnroll({ client, onDone }) {
  const [files, setFiles] = useState([])
  const [res, setRes] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    setBusy(true)
    setError('')
    setRes(null)
    try {
      const fd = new FormData()
      files.forEach((f) => fd.append('files', f))
      const r = await api.upload(`/api/clients/${client.id}/static/enroll`, fd)
      setRes(r)
      setFiles([])
      onDone()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="space-y-3">
      <ImagePicker multiple files={files} onChange={setFiles} hint="One signature per image. Each one gets a quality check." />
      <Alert>{error}</Alert>
      {res && (
        <Alert kind={res.rejected.length ? 'warn' : 'success'}>
          Added {res.accepted.length} reference(s).
          {res.rejected.map((r) => (
            <div key={r.file}>Not added, {r.file}: {r.issues.join(' ')}</div>
          ))}
        </Alert>
      )}
      <Button onClick={submit} disabled={!files.length} loading={busy}>
        <Plus className="h-4 w-4" /> Add {files.length || ''} reference{files.length === 1 ? '' : 's'}
      </Button>
    </div>
  )
}

function DynamicEnroll({ client, onDone }) {
  const pad = useRef(null)
  const [samples, setSamples] = useState([])
  const [penOnly, setPenOnly] = useState(false)
  const [res, setRes] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [last, setLast] = useState(null)
  const add = () => {
    if (pad.current.isEmpty()) return setError('Please sign in the box first.')
    setError('')
    const s = pad.current.getStrokes()
    setSamples([...samples, s])
    setLast(s)
    pad.current.clear()
  }
  const save = async () => {
    setBusy(true)
    setError('')
    try {
      const r = await api.post(`/api/clients/${client.id}/dynamic/enroll`, { samples })
      setRes(r)
      setSamples([])
      onDone()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm text-slate-600">
        <input type="checkbox" checked={penOnly} onChange={(e) => setPenOnly(e.target.checked)} /> Pen-only mode (ignore finger and palm touches)
      </label>
      <DevPenNotice />
      <SignaturePad ref={pad} penOnly={penOnly} />
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={add}>Keep this signature</Button>
        <Button variant="ghost" onClick={() => pad.current.clear()}>Clear</Button>
        <Button className="ml-auto" onClick={save} disabled={!samples.length} loading={busy}>
          Save {samples.length} reference{samples.length === 1 ? '' : 's'}
        </Button>
      </div>
      {samples.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {samples.map((s, i) => (
            <div key={i} className="rounded-md border border-slate-200 bg-white p-1">
              <StrokePreview strokes={s} className="h-10 w-24" />
              {penMissing(s).length > 0 && <LimitedPenBadge missing={penMissing(s)} className="mt-1" />}
            </div>
          ))}
        </div>
      )}
      {samples.length > 0 && <PenDataHint strokes={last} />}
      <Alert>{error}</Alert>
      {res && (
        <Alert kind={res.rejected.length ? 'warn' : 'success'}>
          Added {res.accepted.length} reference(s).
          {res.rejected.map((r) => (
            <div key={r.file}>Not added, {r.file}: {r.issues.join(' ')}</div>
          ))}
        </Alert>
      )}
      {res?.limited_notice && <Alert kind="warn">{res.limited_notice}</Alert>}
    </div>
  )
}

export function ClientDetail() {
  const { id } = useParams()
  const { user } = useAuth()
  const navigate = useNavigate()
  const [c, setC] = useState(null)
  const [tab, setTab] = useState('static')
  const [error, setError] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [toRemove, setToRemove] = useState(null)
  const [removeError, setRemoveError] = useState('')
  const load = useCallback(() => api.get(`/api/clients/${id}`).then(setC).catch((e) => setError(e.message)), [id])
  useEffect(() => {
    load()
  }, [load])
  if (error) return <Alert>{error}</Alert>
  if (!c) return <Spinner />

  // Take the reference out of the list right away, then delete it on the server.
  // On failure, put the card back as it was and show the error.
  const remove = async (p) => {
    const before = c
    const listKey = `${tab}_references`
    const countKey = `${tab}_count`
    setRemoveError('')
    setC((cur) => ({ ...cur, [listKey]: cur[listKey].filter((r) => r.id !== p.id), [countKey]: Math.max(0, (cur[countKey] || 0) - 1) }))
    try {
      await api.del(`/api/references/${p.id}`)
      load() // refresh strength and similarity flags in the background
    } catch (err) {
      setC(before)
      setRemoveError(`Could not remove the reference: ${err.message}`)
    }
  }
  const refs = c[`${tab}_references`]
  const strength = c[`${tab}_strength`]

  return (
    <>
      <PageHeader eyebrow={`Signature card · ${c.client_code}`} title={c.full_name} description={c.notes || undefined}>
        {user.study_mode && c.is_practice && <Badge tone="violet">Practice client</Badge>}
        <Link to={`/app/cases?new=1&client=${c.id}`}>
          <Button variant="secondary"><Briefcase className="h-4 w-4" /> Open a case</Button>
        </Link>
        <Link to={`/app/screen?client=${c.id}`}>
          <Button>Screen a signature</Button>
        </Link>
      </PageHeader>
      {c.deletion_requested && <Alert kind="warn" className="mb-4">This client asked for their signature data to be deleted.</Alert>}

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <Card bodyClass="p-0">
          <div className="px-5 pt-2">
            <Tabs value={tab} onChange={setTab} tabs={[{ value: 'static', label: `Static (${c.static_count})` }, { value: 'dynamic', label: `Dynamic (${c.dynamic_count})` }]} />
          </div>
          <div className="space-y-6 p-5">
            <StrengthMeter strength={strength} />
            <Alert>{removeError}</Alert>
            {refs.length ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                {refs.map((p) => <RefTile key={p.id} p={p} modality={tab} onRemove={c.can_edit ? setToRemove : null} />)}
              </div>
            ) : (
              <Empty>No {tab} references yet.</Empty>
            )}
            {refs.some((p) => p.flagged) && (
              <Alert kind="warn">A highlighted reference is much less similar to the others. If it is the client's own signature and a clean capture, keep it: natural variation makes screening more reliable. Remove it only if the capture is bad (smudged, cut off, blurry) or it is not the client's signature.</Alert>
            )}
            <div className="border-t border-slate-100 pt-5">
              <h3 className="mb-3 font-semibold">Add {tab} references</h3>
              {!c.can_edit ? (
                <Alert kind="info">
                  <Lock className="mr-1 inline h-3.5 w-3.5" /> This client was shared with you. You can screen against it, but only its owner can change its references.
                </Alert>
              ) : c[`${tab}_count`] >= strength.maximum ? (
                <Alert kind="info">This card has the maximum of {strength.maximum} references.</Alert>
              ) : tab === 'static' ? (
                <StaticEnroll client={c} onDone={load} />
              ) : (
                <DynamicEnroll client={c} onDone={load} />
              )}
            </div>
          </div>
        </Card>

        <div className="space-y-6">
          <GroupAccountCard client={c} onDone={load} />
          <Card title="Cases">
            {c.cases.length === 0 ? (
              <p className="text-sm text-slate-500">No cases for this client.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {c.cases.map((k) => (
                  <li key={k.id} className="flex justify-between gap-2">
                    <Link to={`/app/cases/${k.id}`} className="truncate text-brand-700 hover:underline">{k.case_code} · {k.title}</Link>
                    <span className="shrink-0 text-xs text-slate-500">{k.status === 'open' ? 'Needs decision' : 'Decided'}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Screening history">
            {c.checks.length === 0 ? (
              <p className="text-sm text-slate-500">No screenings yet.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {c.checks.slice(0, 12).map((l) => (
                  <li key={l.id} className="flex items-center justify-between gap-2">
                    <Link to={`/app/records/${l.id}`} className="text-slate-700 hover:underline">
                      {l.modality} · <span className="text-xs text-slate-500">{fmtDate(l.created_at)}</span>
                    </Link>
                    <ScreeningBadge value={l.screening_result} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {user.role === 'admin' && user.study_mode && <AccessCard client={c} onDone={load} />}
          <Card title="Data">
            <p className="text-sm text-slate-600">
              Registered {fmtDay(c.created_at)}. {c.retention_until ? `Kept until ${fmtDay(c.retention_until)}, then deleted automatically.` : 'No retention limit.'}
            </p>
            {user.role === 'admin' && (
              <Button
                variant="danger"
                size="sm"
                className="mt-3"
                onClick={() => setDeleting(true)}
              >
                <Trash2 className="h-3.5 w-3.5" /> Delete client
              </Button>
            )}
          </Card>
          <ConfirmDialog
            open={!!toRemove}
            title="Remove this reference?"
            confirmLabel={<><Trash2 className="h-4 w-4" /> Remove</>}
            danger
            icon={Trash2}
            onConfirm={() => { remove(toRemove) }}
            onClose={() => setToRemove(null)}
          >
            This reference signature will be removed from the signature card.
          </ConfirmDialog>
          {deleting && <DeleteClientModal client={c} onClose={() => setDeleting(false)} onDeleted={() => navigate('/app/clients')} />}
        </div>
      </div>
    </>
  )
}

// Group, assigned examiner and the client's own sign-in account.
function GroupAccountCard({ client, onDone }) {
  const [email, setEmail] = useState('')
  const [created, setCreated] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const create = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      setCreated(await api.post(`/api/clients/${client.id}/account`, { email }))
      onDone()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }
  const ex = client.assigned_examiner
  return (
    <Card title="Group and account">
      <dl className="space-y-3 text-sm">
        <div>
          <dt className="text-slate-500">Group</dt>
          <dd className="font-medium">{client.group_name || 'No group'}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Assigned examiner</dt>
          <dd className="font-medium">{ex ? `${ex.full_name} (${ex.account_code})` : 'None yet'}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Client account</dt>
          <dd className="font-medium">{client.account ? `${client.account.email} (${client.account.account_code})` : 'No account yet'}</dd>
        </div>
      </dl>
      {created && <div className="mt-3"><AccountCreated account={created} /></div>}
      {!client.account && !created && client.can_edit && (
        <form onSubmit={create} className="mt-4 space-y-2">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Client's email" required />
          <Alert>{error}</Alert>
          <Button size="sm" variant="secondary" loading={busy}><UserPlus className="h-3.5 w-3.5" /> Create client account</Button>
        </form>
      )}
    </Card>
  )
}

// Admin: which examiner accounts can screen against this client (read-only).
function AccessCard({ client, onDone }) {
  const [busy, setBusy] = useState(false)
  const set = async (body) => {
    setBusy(true)
    try {
      await api.put(`/api/admin/clients/${client.id}/access`, body)
      onDone()
    } finally {
      setBusy(false)
    }
  }
  const access = client.access || []
  return (
    <Card title="Shared with" subtitle="Examiners see only the clients they registered and clients shared with them here (read-only).">
      {access.length === 0 ? (
        <p className="text-sm text-slate-500">Not shared. Only the account that registered it and admins can see it.</p>
      ) : (
        <p className="text-sm text-slate-600">
          {access.length} account{access.length === 1 ? '' : 's'}: {access.slice(0, 8).map((a) => a.account_code || a.full_name).join(', ')}
          {access.length > 8 ? ', …' : ''}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" loading={busy} onClick={() => set({ all_test_accounts: true })}>
          <Share2 className="h-3.5 w-3.5" /> Share with all evaluation accounts
        </Button>
        {access.length > 0 && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => set({ user_ids: [] })}>Stop sharing</Button>
        )}
      </div>
    </Card>
  )
}
