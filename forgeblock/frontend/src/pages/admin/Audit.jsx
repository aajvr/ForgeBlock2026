import { Cpu, Users } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../../api'
import { Combobox, FilterChip } from '../../components/Combobox'
import { patchParams } from '../../components/params'
import { Avatar, Badge, Card, PageHeader, Spinner, Table, fieldClass, fmtDate, td } from '../../components/ui'

const TYPES = ['login', 'login_failed', 'lockout', 'password', 'account', 'client', 'enrollment', 'case', 'screening', 'compare', 'finding', 'ledger', 'tamper_demo', 'settings', 'model', 'retention', 'report', 'deletion']
const TONE = { lockout: 'red', login_failed: 'amber', tamper_demo: 'red', deletion: 'red', retention: 'amber', finding: 'violet', screening: 'blue' }
const ROLE = { admin: ['Admin', 'violet'], examiner: ['Examiner', 'blue'], client: ['Client', 'gray'] }
const SYSTEM = 'system'
// "Who" values: '' (anyone), a user id, 'system', or 'role:<role>' for everyone with that role.
const ROLE_TABS = [{ value: 'admin', label: 'Admins' }, { value: 'examiner', label: 'Examiners' }, { value: 'client', label: 'Clients' }]
const ROLE_ALL = { admin: 'All admins', examiner: 'All examiners', client: 'All clients' }

function RoleBadge({ role }) {
  const [label, tone] = ROLE[role] || [role, 'gray']
  return <Badge tone={tone}>{label}</Badge>
}

export default function Audit() {
  const [rows, setRows] = useState(null)
  const [actors, setActors] = useState({ users: [], has_system: false })
  // Filters live in the URL: ?who=<user id>|system&type=…&q=…
  const [params, setParams] = useSearchParams()
  const who = params.get('who') || ''
  const type = params.get('type') || ''
  const q = params.get('q') || ''
  useEffect(() => {
    api.get('/api/admin/audit/actors').then(setActors).catch(() => {})
  }, [])
  useEffect(() => {
    const qs = new URLSearchParams({
      ...(type && { activity_type: type }),
      ...(q && { q }),
      ...(who === SYSTEM ? { system: 'true' } : who.startsWith('role:') ? { role: who.slice(5) } : who ? { user_id: who } : {}),
    })
    const t = setTimeout(() => api.get(`/api/admin/audit?${qs}`).then(setRows), 150)
    return () => clearTimeout(t)
  }, [type, q, who])

  const options = useMemo(() => actors.users.map((u) => ({
    value: u.id,
    label: u.full_name,
    sub: [ROLE[u.role]?.[0] || u.role, u.account_code].filter(Boolean).join(' · '),
    keywords: u.role,
    group: u.role,
    prefix: <Avatar name={u.full_name} role={u.role} size="h-7 w-7 text-[11px]" />,
  })), [actors.users])
  const present = useMemo(() => new Set(actors.users.map((u) => u.role)), [actors.users])
  const tabs = useMemo(() => [
    ...ROLE_TABS.filter((t) => present.has(t.value)),
    ...(actors.has_system ? [{ value: SYSTEM, label: 'System' }] : []),
  ], [present, actors.has_system])
  // Under a role tab, the first entry filters the log to everyone with that role.
  const extra = useMemo(() => [
    ...ROLE_TABS.filter((t) => present.has(t.value)).map((t) => ({
      value: `role:${t.value}`,
      label: ROLE_ALL[t.value],
      sub: `Everyone with the ${ROLE[t.value][0]} role`,
      group: t.value,
      tabOnly: true,
      prefix: <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-slate-600"><Users className="h-3.5 w-3.5" /></span>,
    })),
    ...(actors.has_system ? [{
      value: SYSTEM,
      label: 'System',
      sub: 'Automatic jobs',
      group: SYSTEM,
      prefix: <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-slate-600"><Cpu className="h-3.5 w-3.5" /></span>,
    }] : []),
  ], [present, actors.has_system])
  const whoLabel = who === SYSTEM ? 'System'
    : who.startsWith('role:') ? ROLE_ALL[who.slice(5)] || who
      : actors.users.find((u) => String(u.id) === who)?.full_name || `#${who}`
  const roleOf = Object.fromEntries(actors.users.map((u) => [u.id, u.role]))
  const set = (k) => (v) => patchParams(setParams, { [k]: v || null })

  return (
    <>
      <PageHeader title="Audit log" description="Who did what and when: sign-ins, account changes, enrollments, screenings, findings, deletions and ledger actions." />
      <Card bodyClass="p-0">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-5 py-3">
          <Combobox label="Who" anyLabel="Anyone" placeholder="Search people" value={who} onChange={set('who')} options={options} extra={extra} tabs={tabs} className="w-64" />
          <select value={type} onChange={(e) => set('type')(e.target.value)} aria-label="Activity type" className={fieldClass}>
            <option value="">All activity</option>
            {TYPES.map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
          </select>
          <input value={q} onChange={(e) => set('q')(e.target.value)} placeholder="Search descriptions" aria-label="Search descriptions" className={`${fieldClass} w-full sm:ml-auto sm:w-64`} />
        </div>
        {(who || type) && (
          <div className="flex flex-wrap gap-2 border-b border-slate-100 px-5 py-2">
            {who && <FilterChip label={`Who: ${whoLabel}`} onRemove={() => set('who')('')} />}
            {type && <FilterChip label={`Type: ${type.replace('_', ' ')}`} onRemove={() => set('type')('')} />}
          </div>
        )}
        {!rows ? <Spinner /> : (
          <Table head={['When', 'Who', 'Type', 'What']}>
            {rows.map((a) => (
              <tr key={a.id}>
                <td className={`${td} whitespace-nowrap text-xs text-slate-500`}>{fmtDate(a.created_at)}</td>
                <td className={`${td} whitespace-nowrap`}>
                  <span className="flex items-center gap-2">
                    {a.user_id ? <Avatar name={a.user_name} role={roleOf[a.user_id]} size="h-6 w-6 text-[10px]" /> : null}
                    {a.user_name}
                    {a.user_id && roleOf[a.user_id] && <RoleBadge role={roleOf[a.user_id]} />}
                  </span>
                </td>
                <td className={td}><Badge tone={TONE[a.activity_type] || 'gray'}>{a.activity_type.replace('_', ' ')}</Badge></td>
                <td className={td}>{a.description}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  )
}
