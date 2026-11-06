import { useEffect, useState } from 'react'
import { api } from '../../api'
import { Badge, Card, PageHeader, Spinner, Table, fmtDate, td } from '../../components/ui'

const TYPES = ['login', 'login_failed', 'lockout', 'password', 'account', 'client', 'enrollment', 'case', 'screening', 'compare', 'finding', 'ledger', 'tamper_demo', 'settings', 'model', 'retention', 'report', 'deletion']
const TONE = { lockout: 'red', login_failed: 'amber', tamper_demo: 'red', deletion: 'red', retention: 'amber', finding: 'violet', screening: 'blue' }

export default function Audit() {
  const [rows, setRows] = useState(null)
  const [type, setType] = useState('')
  const [q, setQ] = useState('')
  useEffect(() => {
    const t = setTimeout(() => api.get(`/api/admin/audit?${new URLSearchParams({ ...(type && { activity_type: type }), ...(q && { q }) })}`).then(setRows), 150)
    return () => clearTimeout(t)
  }, [type, q])
  return (
    <>
      <PageHeader title="Audit log" description="Who did what and when: sign-ins, account changes, enrollments, screenings, findings, deletions and ledger actions." />
      <Card bodyClass="p-0">
        <div className="flex flex-wrap gap-3 border-b border-slate-100 px-5 py-3">
          <select value={type} onChange={(e) => setType(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm">
            <option value="">All activity</option>
            {TYPES.map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
          </select>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search descriptions" className="ml-auto w-64 rounded-lg border border-slate-300 px-3 py-1.5 text-sm" />
        </div>
        {!rows ? <Spinner /> : (
          <Table head={['When', 'Who', 'Type', 'What']}>
            {rows.map((a) => (
              <tr key={a.id}>
                <td className={`${td} whitespace-nowrap text-xs text-slate-500`}>{fmtDate(a.created_at)}</td>
                <td className={`${td} whitespace-nowrap`}>{a.user_name}</td>
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
