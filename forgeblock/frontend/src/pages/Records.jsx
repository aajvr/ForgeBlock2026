import { ClipboardList, Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../auth'
import { LimitedPenBadge } from '../components/shared'
import { Badge, Card, Empty, FindingBadge, Input, PageHeader, ScreeningBadge, Select, Spinner, Table, fmtDate, td } from '../components/ui'

// Decision column: the examiner's finding, "Needs decision" while the case is
// open, or nothing when no case was needed (Consistent screenings).
export function DecisionCell({ row }) {
  if (row.finding) return <FindingBadge value={row.finding} />
  if (row.case_status === 'open') return <Badge tone="amber">Needs decision</Badge>
  if (row.screening_result === 'consistent') return <span className="text-sm text-slate-400">Not needed</span>
  return <span className="text-sm text-slate-400">No case</span>
}

export function RecordsTable({ rows, showExaminer = false }) {
  const navigate = useNavigate()
  const head = ['Receipt', 'Module', 'Client', ...(showExaminer ? ['Examiner'] : []), 'Result', { label: 'Confidence', right: true }, 'Decision', 'Case', 'Date']
  return (
    <Table head={head}>
      {rows.map((l) => (
        <tr key={l.id} className="cursor-pointer hover:bg-slate-50" onClick={() => navigate(`/app/records/${l.id}`)}>
          <td className={`${td} whitespace-nowrap`}><span className="font-mono text-sm font-medium text-brand-700">{l.receipt_code}</span></td>
          <td className={td}>
            <Badge tone={l.modality === 'static' ? 'blue' : 'violet'}>{l.modality === 'static' ? 'Static' : 'Dynamic'}</Badge>
            {l.pen_label && <LimitedPenBadge className="ml-1.5" />}
          </td>
          <td className={`${td} whitespace-nowrap`}>{l.client_code || <span className="text-slate-400">-</span>}</td>
          {showExaminer && (
            <td className={td}>
              <span className="block">{l.performed_by_name || '-'}</span>
              <span className="block text-sm text-slate-500">{[l.performed_by_code, l.group_name].filter(Boolean).join(' · ')}</span>
            </td>
          )}
          <td className={td}><ScreeningBadge value={l.screening_result} /></td>
          <td className={`${td} text-right tabular-nums`}>{l.confidence_score.toFixed(1)}%</td>
          <td className={td}><DecisionCell row={l} /></td>
          <td className={`${td} whitespace-nowrap`} onClick={(e) => e.stopPropagation()}>
            {l.case_code ? <Link to={`/app/cases/${l.case_id}`} className="text-brand-700 hover:underline">{l.case_code}</Link> : <span className="text-slate-400">-</span>}
          </td>
          <td className={`${td} whitespace-nowrap text-slate-500`}>{fmtDate(l.created_at)}</td>
        </tr>
      ))}
    </Table>
  )
}

function Summary({ s }) {
  const items = [
    ['Screenings', s.total, 'text-slate-900'],
    ['Consistent', s.consistent, 'text-ok-700'],
    ['Inconclusive', s.inconclusive, 'text-warn-700'],
    ['Inconsistent', s.inconsistent, 'text-bad-700'],
    ['Needs decision', s.awaiting_decision, 'text-warn-700'],
    ['Decided Genuine', s.genuine, 'text-ok-700'],
    ['Decided Forged', s.forged, 'text-bad-700'],
  ]
  return (
    <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
      {items.map(([label, value, cls]) => (
        <div key={label} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
          <div className="text-sm text-slate-500">{label}</div>
          <div className={`mt-1 text-2xl font-semibold tabular-nums ${cls}`}>{value}</div>
        </div>
      ))}
    </div>
  )
}

export default function Records() {
  const { user } = useAuth()
  const [filters, setFilters] = useState({ q: '', modality: '', result: '', decision: '', date_from: '', date_to: '' })
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString()
    const t = setTimeout(() => {
      api.get(`/api/records${qs ? `?${qs}` : ''}`).then((d) => {
        setData(d)
        setError('')
      }).catch((e) => setError(e.message))
    }, filters.q ? 250 : 0)
    return () => clearTimeout(t)
  }, [filters])

  const set = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }))
  return (
    <>
      <PageHeader
        title="Records"
        description={user.role === 'admin'
          ? 'Every screening in ForgeBlock, with its result, the examiner’s decision and its receipt code.'
          : 'Every screening you made, with its result, your decision and its receipt code.'}
      />
      {data && <Summary s={data.summary} />}
      <Card bodyClass="p-0">
        <div className="grid gap-3 border-b border-slate-100 p-4 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-8">
          <div className="relative lg:col-span-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input value={filters.q} onChange={set('q')} placeholder="Receipt, client or case" style={{ paddingLeft: '2.25rem' }} />
          </div>
          <Select value={filters.modality} onChange={set('modality')} aria-label="Module">
            <option value="">Both modules</option>
            <option value="static">Static</option>
            <option value="dynamic">Dynamic</option>
          </Select>
          <Select value={filters.result} onChange={set('result')} aria-label="Result">
            <option value="">Any result</option>
            <option value="consistent">Consistent</option>
            <option value="inconclusive">Inconclusive</option>
            <option value="inconsistent">Inconsistent</option>
          </Select>
          <Select value={filters.decision} onChange={set('decision')} aria-label="Decision">
            <option value="">Any decision</option>
            <option value="pending">Needs decision</option>
            <option value="genuine">Genuine</option>
            <option value="forged">Forged</option>
            <option value="none">No case</option>
          </Select>
          <div className="grid min-w-0 grid-cols-2 gap-2 sm:col-span-2 2xl:col-span-3">
            <Input type="date" value={filters.date_from} onChange={set('date_from')} aria-label="From" />
            <Input type="date" value={filters.date_to} onChange={set('date_to')} aria-label="To" />
          </div>
        </div>
        {error ? <div className="p-5 text-sm text-bad-700">{error}</div>
          : !data ? <Spinner />
            : data.records.length === 0 ? <Empty icon={ClipboardList}>No screenings match.</Empty>
              : <RecordsTable rows={data.records} showExaminer={user.role === 'admin'} />}
      </Card>
    </>
  )
}
