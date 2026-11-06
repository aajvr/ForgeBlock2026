import { Briefcase, Inbox, Link2, ScanSearch, ShieldAlert, ShieldCheck, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../api'
import { HBars, RESULT_COLORS, StackedDays } from '../../components/charts'
import { Alert, Card, PageHeader, Segmented, Spinner, Stat, fmtDate } from '../../components/ui'

export default function Dashboard() {
  const [days, setDays] = useState(14)
  const [d, setD] = useState(null)
  useEffect(() => {
    api.get(`/api/admin/dashboard?days=${days}`).then(setD)
  }, [days])
  if (!d) return <Spinner />
  const t = d.totals
  return (
    <>
      <PageHeader eyebrow="Administrator" title="Dashboard" description="Screening activity, workload and system health at a glance.">
        <Segmented value={days} onChange={setDays} options={[{ value: 7, label: '7 days' }, { value: 14, label: '14 days' }, { value: 30, label: '30 days' }]} />
      </PageHeader>
      {(t.open_cases > 0 || d.deletion_requests > 0) && (
        <Alert kind="warn" className="mb-6">
          Needs attention:{' '}
          {t.open_cases > 0 && <Link to="/app/cases" className="font-medium underline">{t.open_cases} case(s) waiting for the examiner’s decision</Link>}
          {t.open_cases > 0 && d.deletion_requests > 0 && ' · '}
          {d.deletion_requests > 0 && <Link to="/app/admin/settings" className="font-medium underline">{d.deletion_requests} deletion request(s)</Link>}
        </Alert>
      )}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Clients on file" value={t.clients} icon={Users} tone="indigo" />
        <Stat label="Cases needing a decision" value={t.open_cases} icon={Briefcase} tone="amber" />
        <Stat label="Screenings (all time)" value={t.screenings} icon={ScanSearch} hint={d.average_confidence !== null ? `Average confidence ${d.average_confidence}% in this period` : undefined} />
        <Stat label="Ledger blocks" value={t.chain_height} icon={Link2} tone="green" hint={d.ledger ? (d.ledger.valid ? 'Last auto-check: intact' : 'Last auto-check: FAILED') : 'Not checked yet'} />
      </div>
      <div className="grid items-start gap-6 lg:grid-cols-[1fr_340px]">
        <Card title="Screenings per day" subtitle={`Last ${days} days, by screening result`}>
          <StackedDays series={d.series} />
        </Card>
        <div className="space-y-6">
          <Card title="Screening results" subtitle={`Last ${days} days`}>
            <HBars rows={['consistent', 'inconclusive', 'inconsistent'].map((k) => ({ label: k[0].toUpperCase() + k.slice(1), value: d.results[k], color: RESULT_COLORS[k] }))} />
            <div className="mt-4 border-t border-slate-100 pt-4">
              <HBars rows={[{ label: 'Static', value: d.by_modality.static }, { label: 'Dynamic', value: d.by_modality.dynamic, color: '#6d28d9' }]} />
            </div>
          </Card>
          <Card title="Examiner workload" subtitle={`Screenings in the last ${days} days`}>
            {d.workload.length ? <HBars rows={d.workload.map((w) => ({ label: w.name, value: w.count }))} /> : <p className="text-sm text-slate-500">No screenings in this period.</p>}
          </Card>
          <Card title="Ledger health">
            {d.ledger ? (
              <div className={`flex items-center gap-2 text-sm ${d.ledger.valid ? 'text-ok-700' : 'text-bad-700'}`}>
                {d.ledger.valid ? <ShieldCheck className="h-4 w-4" /> : <ShieldAlert className="h-4 w-4" />}
                {d.ledger.valid ? 'Intact' : `${d.ledger.invalid_blocks.length} block(s) failed`} · checked {fmtDate(d.ledger.checked_at)}
              </div>
            ) : (
              <p className="text-sm text-slate-500">The daily check has not run yet.</p>
            )}
            <Link to="/app/admin/ledger" className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline"><Inbox className="h-4 w-4" /> Open the ledger</Link>
          </Card>
        </div>
      </div>
    </>
  )
}
