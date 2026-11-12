import { ChevronDown, ClipboardList, Layers, Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../auth'
import { Combobox, FilterChip } from '../components/Combobox'
import DateRange, { rangeLabel } from '../components/DateRange'
import GroupTag from '../components/GroupTag'
import { LimitedPenBadge } from '../components/shared'
import { patchParams } from '../components/params'
import { useUsers } from '../components/useUsers'
import { Avatar, Badge, Card, Empty, FindingBadge, Input, PageHeader, RESULT, ScreeningBadge, Select, Spinner, Table, fmtDay, fmtTime, td } from '../components/ui'

// Decision column: the examiner's finding, "Needs decision" while the case is
// open, or nothing when no case was needed (Consistent screenings).
export function DecisionCell({ row }) {
  if (row.finding) return <FindingBadge value={row.finding} />
  if (row.case_status === 'open') return <Badge tone="amber">Needs decision</Badge>
  if (row.screening_result === 'consistent') return <span className="text-sm text-slate-400">Not needed</span>
  return <span className="text-sm text-slate-400">No case</span>
}

// showExaminer is the admin view: it adds the Examiner column and the group tag under the client.
export function RecordsTable({ rows, showExaminer = false, hideGroup = false }) {
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
          <td className={td}>
            <span className="block whitespace-nowrap">{l.client_code || <span className="text-slate-400">-</span>}</span>
            {showExaminer && !hideGroup && <GroupTag id={l.group_id} name={l.group_name} className="mt-1" />}
          </td>
          {showExaminer && (
            <td className={td}>
              <span className="block">{l.performed_by_name || '-'}</span>
              <span className="block text-sm text-slate-500">{l.performed_by_code}</span>
            </td>
          )}
          <td className={td}><ScreeningBadge value={l.screening_result} /></td>
          <td className={`${td} text-right tabular-nums`}>{l.confidence_score.toFixed(1)}%</td>
          <td className={td}><DecisionCell row={l} /></td>
          <td className={`${td} whitespace-nowrap`} onClick={(e) => e.stopPropagation()}>
            {l.case_code ? <Link to={`/app/cases/${l.case_id}`} className="text-brand-700 hover:underline">{l.case_code}</Link> : <span className="text-slate-400">-</span>}
          </td>
          <td className={`${td} whitespace-nowrap pr-6 text-slate-500`}>
            <span className="block">{fmtDay(l.created_at)}</span>
            <span className="block text-xs text-slate-400">{fmtTime(l.created_at)}</span>
          </td>
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

// "Group by group": one collapsible section per group, with its examiner and record count.
function GroupedRecords({ rows, groups }) {
  const [closed, setClosed] = useState({})
  const sections = useMemo(() => {
    const by = new Map()
    rows.forEach((r) => {
      const k = r.group_id || 0
      if (!by.has(k)) by.set(k, { id: r.group_id, name: r.group_name, rows: [] })
      by.get(k).rows.push(r)
    })
    // Named groups A-Z, then clients without a group.
    return [...by.values()].sort((a, b) => Number(!a.id) - Number(!b.id) || (a.name || '').localeCompare(b.name || ''))
  }, [rows])
  return (
    <div className="divide-y divide-slate-100">
      {sections.map((sec) => {
        const k = sec.id || 0
        const ex = groups.find((g) => g.id === sec.id)?.examiner
        const isOpen = !closed[k]
        return (
          <section key={k}>
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() => setClosed((c) => ({ ...c, [k]: isOpen }))}
              className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 bg-slate-50/70 px-5 py-2.5 text-left text-sm hover:bg-slate-100/70"
            >
              <ChevronDown className={`h-4 w-4 text-slate-400 transition ${isOpen ? '' : '-rotate-90'}`} />
              <GroupTag id={sec.id} name={sec.name || 'No group'} />
              {ex ? (
                <span className="flex items-center gap-1.5 text-slate-600"><Avatar name={ex.full_name} size="h-5 w-5 text-[9px]" /> {ex.full_name}</span>
              ) : (
                <span className="text-slate-400">{sec.id ? 'No examiner assigned' : 'Clients without a group'}</span>
              )}
              <span className="ml-auto text-xs font-medium text-slate-500">{sec.rows.length} record{sec.rows.length === 1 ? '' : 's'}</span>
            </button>
            {isOpen && <RecordsTable rows={sec.rows} showExaminer hideGroup />}
          </section>
        )
      })}
    </div>
  )
}

const FILTER_KEYS = ['q', 'modality', 'result', 'decision', 'date_from', 'date_to', 'examiner', 'group']
// URL key -> API query param, for the admin-only filters.
const API_KEY = { examiner: 'examiner_id', group: 'group_id' }

export default function Records() {
  const { user } = useAuth()
  const isAdmin = user.role === 'admin'
  // Filters live in the URL (?result=inconclusive&date_from=…) so the dashboard can link to them.
  const [params, setParams] = useSearchParams()
  const filters = Object.fromEntries(FILTER_KEYS.map((k) => [k, params.get(k) || '']))
  const filterKey = FILTER_KEYS.map((k) => filters[k]).join('|')
  const grouped = isAdmin && params.get('by') === 'group'
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [groups, setGroups] = useState([])
  const examiners = useUsers({ role: 'examiner', enabled: isAdmin })
  useEffect(() => {
    if (isAdmin) api.get('/api/groups').then((g) => setGroups(g.groups)).catch(() => {})
  }, [isAdmin])

  useEffect(() => {
    const qs = new URLSearchParams(
      Object.entries(filters)
        .filter(([k, v]) => v && (isAdmin || !API_KEY[k]))
        .map(([k, v]) => [API_KEY[k] || k, k === 'group' && v === 'none' ? '0' : v]),
    ).toString()
    const t = setTimeout(() => {
      api.get(`/api/records${qs ? `?${qs}` : ''}`).then((d) => {
        setData(d)
        setError('')
      }).catch((e) => setError(e.message))
    }, filters.q ? 250 : 0)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey, isAdmin])

  const setVal = (k, v) => patchParams(setParams, { [k]: v || null })
  const set = (k) => (e) => setVal(k, e.target.value)
  const anySet = FILTER_KEYS.some((k) => filters[k])
  const clearAll = () => patchParams(setParams, Object.fromEntries(FILTER_KEYS.map((k) => [k, null])))

  const examinerOptions = examiners.map((u) => ({ value: u.id, label: u.full_name, sub: [u.account_code, u.group_name || 'No group'].filter(Boolean).join(' · '), keywords: u.email }))
  const examinerName = examiners.find((u) => String(u.id) === filters.examiner)?.full_name
  const groupName = filters.group === 'none' ? 'No group' : groups.find((g) => String(g.id) === filters.group)?.name

  const search = (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <Input value={filters.q} onChange={set('q')} placeholder="Receipt, client or case" style={{ paddingLeft: '2.25rem' }} />
    </div>
  )
  const resultSelect = (
    <Select value={filters.result} onChange={set('result')} aria-label="Result">
      <option value="">Any result</option>
      {Object.entries(RESULT).map(([k, r]) => <option key={k} value={k}>{r.label}</option>)}
    </Select>
  )
  const modalitySelect = (
    <Select value={filters.modality} onChange={set('modality')} aria-label="Module">
      <option value="">Both modules</option>
      <option value="static">Static</option>
      <option value="dynamic">Dynamic</option>
    </Select>
  )
  const decisionSelect = (
    <Select value={filters.decision} onChange={set('decision')} aria-label="Decision">
      <option value="">Any decision</option>
      <option value="pending">Needs decision</option>
      <option value="genuine">Genuine</option>
      <option value="forged">Forged</option>
      <option value="none">No case</option>
    </Select>
  )

  return (
    <>
      <PageHeader
        title="Records"
        description={isAdmin
          ? 'Every screening in ForgeBlock, with its result, the examiner’s decision and its receipt code.'
          : 'Every screening you made, with its result, your decision and its receipt code.'}
      />
      {data && <Summary s={data.summary} />}
      <Card bodyClass="p-0" data-tour="records-list">
        {isAdmin ? (
          <div className="border-b border-slate-100 p-4">
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="w-full sm:w-56">{search}</div>
              <Combobox label="Examiner" anyLabel="Any examiner" placeholder="Search examiners" value={filters.examiner} onChange={(v) => setVal('examiner', v)} options={examinerOptions} className="w-full sm:w-56" />
              <div className="w-full sm:w-44">
                <Select value={filters.group} onChange={set('group')} aria-label="Group">
                  <option value="">Any group</option>
                  {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                  <option value="none">No group</option>
                </Select>
              </div>
              <DateRange from={filters.date_from} to={filters.date_to} onChange={(f, t) => patchParams(setParams, { date_from: f || null, date_to: t || null })} className="w-full sm:w-56" />
              <div className="w-[calc(50%-0.35rem)] sm:w-36">{resultSelect}</div>
              <div className="w-[calc(50%-0.35rem)] sm:w-36">{modalitySelect}</div>
              <div className="w-full sm:w-40">{decisionSelect}</div>
              {anySet && <button type="button" onClick={clearAll} className="text-sm font-medium text-brand-700 hover:underline">Clear filters</button>}
              <label className="ml-auto flex cursor-pointer items-center gap-2 whitespace-nowrap text-sm text-slate-700">
                <input type="checkbox" checked={grouped} onChange={(e) => patchParams(setParams, { by: e.target.checked ? 'group' : null })} className="h-4 w-4 accent-brand-600" />
                <Layers className="h-4 w-4 text-slate-400" /> Group by group
              </label>
            </div>
            {(filters.examiner || filters.group || filters.date_from || filters.date_to) && (
              <div className="mt-3 flex flex-wrap gap-2">
                {filters.examiner && <FilterChip label={`Examiner: ${examinerName || `#${filters.examiner}`}`} onRemove={() => setVal('examiner', '')} />}
                {filters.group && <FilterChip label={`Group: ${groupName || `#${filters.group}`}`} onRemove={() => setVal('group', '')} />}
                {(filters.date_from || filters.date_to) && <FilterChip label={rangeLabel(filters.date_from, filters.date_to)} onRemove={() => patchParams(setParams, { date_from: null, date_to: null })} />}
              </div>
            )}
          </div>
        ) : (
          <div className="grid gap-3 border-b border-slate-100 p-4 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-8">
            <div className="lg:col-span-2">{search}</div>
            {modalitySelect}
            {resultSelect}
            {decisionSelect}
            <div className="grid min-w-0 grid-cols-2 gap-2 sm:col-span-2 2xl:col-span-3">
              <Input type="date" value={filters.date_from} onChange={set('date_from')} aria-label="From" />
              <Input type="date" value={filters.date_to} onChange={set('date_to')} aria-label="To" />
            </div>
          </div>
        )}
        {error ? <div className="p-5 text-sm text-bad-700">{error}</div>
          : !data ? <Spinner />
            : data.records.length === 0 ? <Empty icon={ClipboardList}>No screenings match.</Empty>
              : grouped ? <GroupedRecords rows={data.records} groups={groups} />
                : <RecordsTable rows={data.records} showExaminer={isAdmin} />}
      </Card>
    </>
  )
}
