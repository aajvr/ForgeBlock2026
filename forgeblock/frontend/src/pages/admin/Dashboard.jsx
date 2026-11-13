import { ArrowUpRight, Briefcase, ChartColumn, ChartPie, CheckCircle2, CircleHelp, Image, Link2, PenLine, ScanSearch, ShieldAlert, ShieldCheck, TriangleAlert, Users, XCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../api'
import { HBars, RESULT_COLORS, StackedDays } from '../../components/charts'
import { Alert, Avatar, Card, PageHeader, Segmented, Spinner, Stat, fmtDate } from '../../components/ui'

const RESULT_ROWS = [
  { key: 'consistent', icon: CheckCircle2, tint: 'bg-brand-50 text-brand-600' },
  { key: 'inconclusive', icon: CircleHelp, tint: 'bg-warn-100 text-warn-600' },
  { key: 'inconsistent', icon: XCircle, tint: 'bg-bad-100 text-bad-600' },
]

export default function Dashboard() {
  const [days, setDays] = useState(14)
  const [d, setD] = useState(null)
  const [groups, setGroups] = useState([])
  useEffect(() => {
    api.get(`/api/admin/dashboard?days=${days}`).then(setD)
  }, [days])
  // Only used to show each examiner's group in the workload list.
  useEffect(() => {
    api.get('/api/groups').then((g) => setGroups(g.groups || [])).catch(() => setGroups([]))
  }, [])
  if (!d) return <Spinner />
  const t = d.totals
  const since = new Date(Date.now() - (days - 1) * 864e5).toISOString().slice(0, 10)
  const groupOf = (uid) => groups.find((g) => g.examiner?.id === uid)?.name
  // Share of ALL screenings in the period (the workload list is only the top 8 examiners).
  const workloadTotal = d.by_modality.static + d.by_modality.dynamic
  return (
    <>
      <PageHeader eyebrow="Administrator" title="Dashboard" description="Screening activity, workload and system health at a glance.">
        <Segmented value={days} onChange={setDays} options={[{ value: 7, label: '7 days' }, { value: 14, label: '14 days' }, { value: 30, label: '30 days' }]} />
      </PageHeader>
      {(t.open_cases > 0 || d.deletion_requests > 0) && (
        <Alert kind="warn" icon={TriangleAlert} raised className="mb-[18px]">
          Needs attention:{' '}
          {t.open_cases > 0 && <Link to="/app/cases?status=open" className="font-semibold text-warn-600 underline underline-offset-[3px] hover:text-warn-700">{t.open_cases} case(s) waiting for the examiner’s decision</Link>}
          {t.open_cases > 0 && d.deletion_requests > 0 && ' · '}
          {d.deletion_requests > 0 && <Link to="/app/admin/settings" className="font-semibold text-warn-600 underline underline-offset-[3px] hover:text-warn-700">{d.deletion_requests} deletion request(s)</Link>}
        </Alert>
      )}
      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4" data-tour="home-stats">
        <Stat label="Clients on file" value={t.clients} icon={Users} to="/app/clients" />
        <Stat label="Cases needing a decision" value={t.open_cases} icon={Briefcase} tone="amber" to="/app/cases?status=open" />
        <Stat label="Screenings (all time)" value={t.screenings} icon={ScanSearch} tone="sky" to="/app/records" hint={d.average_confidence !== null ? `Average confidence ${d.average_confidence}% in this period` : undefined} />
        <Stat label="Ledger blocks" value={t.chain_height} icon={Link2} tone="navy" to="/app/admin/ledger" hint={d.ledger ? (d.ledger.valid ? 'Last auto-check: intact' : 'Last auto-check: FAILED') : 'Not checked yet'} />
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card icon={ChartColumn} title="Screenings per day" subtitle={`Last ${days} days, by screening result`} data-tour="dash-activity">
          <StackedDays series={d.series} />
        </Card>
        <Card icon={ChartPie} title="Screening results" subtitle={`Last ${days} days`}>
          <HBars rows={RESULT_ROWS.map(({ key, icon, tint }) => ({
            label: key[0].toUpperCase() + key.slice(1), value: d.results[key], color: RESULT_COLORS[key], icon, tint,
            to: `/app/records?result=${key}&date_from=${since}`,
          }))} />
          <div className="my-3 border-t border-track" />
          <HBars rows={[
            { label: 'Static', value: d.by_modality.static, color: '#0f548c', icon: Image, tint: 'bg-brand-50 text-brand-800', to: `/app/records?modality=static&date_from=${since}` },
            { label: 'Dynamic', value: d.by_modality.dynamic, color: '#6d28d9', icon: PenLine, tint: 'bg-violet-100 text-violet-700', to: `/app/records?modality=dynamic&date_from=${since}` },
          ]} />
        </Card>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card icon={Users} title="Examiner workload" subtitle={`Screenings in the last ${days} days`} data-tour="dash-workload">
          {d.workload.length ? (
            <ul className="flex flex-col">
              {d.workload.map((w) => {
                const share = workloadTotal ? Math.round((w.count / workloadTotal) * 100) : 0
                const group = groupOf(w.user_id) || 'Without a group'
                const body = (
                  <>
                    <Avatar name={w.name} size="h-9 w-9 text-[12px]" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-3">
                        <span className="min-w-0 flex-1 truncate text-[14px]">
                          <span className={`font-semibold text-ink ${w.user_id ? 'group-hover:text-brand-700 group-hover:underline' : ''}`}>{w.name}</span>
                          <span className="text-muted"> · {group}</span>
                        </span>
                        <span className="shrink-0 text-[22px] font-bold leading-none tabular-nums text-ink">{w.count}</span>
                      </span>
                      <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-track" aria-hidden="true">
                        <span className="block h-full rounded-full bg-[var(--role-ink,#0f6cbd)]" style={{ width: `${share}%` }} />
                      </span>
                      <span className="mt-1 block text-[12px] text-muted">{share}% of screenings in this period</span>
                    </span>
                  </>
                )
                const row = 'flex items-center gap-3 py-3'
                return (
                  <li key={w.user_id ?? w.name} className="border-t border-track first:border-t-0">
                    {w.user_id ? (
                      <Link to={`/app/records?examiner=${w.user_id}&date_from=${since}`} className={`group -mx-2 rounded-[10px] px-2 transition-colors hover:bg-[#f5f8fc] focus-visible:outline-2 focus-visible:outline-brand-600 ${row}`} title={`${w.name}: ${w.count} (${share}%). Open these records`}>{body}</Link>
                    ) : (
                      <div className={row}>{body}</div>
                    )}
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="text-sm text-muted">No screenings in this period.</p>
          )}
        </Card>

        <Card bodyClass="flex h-full flex-col justify-center gap-0 px-[22px] py-6">
          <span className={`flex h-10 w-10 items-center justify-center rounded-[12px] ${!d.ledger ? 'bg-track text-muted' : d.ledger.valid ? 'bg-ok-100 text-ok-600' : 'bg-bad-100 text-bad-600'}`}>
            {d.ledger && !d.ledger.valid ? <ShieldAlert className="h-5 w-5" /> : <ShieldCheck className="h-5 w-5" />}
          </span>
          <h2 className="mt-4 text-[17px] font-semibold text-ink">Ledger health</h2>
          {d.ledger ? (
            <p className={`mt-[3px] text-[13px] font-medium ${d.ledger.valid ? 'text-ok-600' : 'text-bad-600'}`}>
              {d.ledger.valid ? 'Intact' : `${d.ledger.invalid_blocks.length} block(s) failed`} · checked {fmtDate(d.ledger.checked_at)}
            </p>
          ) : (
            <p className="mt-[3px] text-[13px] text-muted">The daily check has not run yet.</p>
          )}
          <Link to="/app/admin/ledger" className="mt-4 inline-flex w-fit items-center gap-1.5 rounded-[10px] border border-line px-3 py-1.5 text-[13px] font-medium text-[#3b4a5e] transition-colors hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700">
            Open the ledger <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </Card>
      </div>
    </>
  )
}
