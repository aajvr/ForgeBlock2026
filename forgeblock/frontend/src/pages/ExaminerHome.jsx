import { ArrowRight, Briefcase, CheckCircle2, ClipboardList, ScanSearch, UserPlus, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../auth'
import { Card, Empty, PageHeader, ScreeningBadge, Spinner, Stat, fmtDate } from '../components/ui'
import { CasesTable } from './Cases'
import { DecisionCell } from './Records'

function Action({ to, icon, title, text }) {
  const Icon = icon
  return (
    <Link to={to} className="lift group flex items-start gap-3 rounded-2xl border border-slate-200/70 bg-white p-4 shadow-soft hover:border-brand-300">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-100 text-brand-700"><Icon className="h-5 w-5" /></span>
      <span className="min-w-0">
        <span className="flex items-center gap-1 font-semibold">{title} <ArrowRight className="h-4 w-4 opacity-0 transition group-hover:opacity-100" /></span>
        <span className="block text-sm text-slate-600">{text}</span>
      </span>
    </Link>
  )
}

// The examiner's start page: what needs a decision, recent work, shortcuts.
export default function ExaminerHome() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [d, setD] = useState(null)
  useEffect(() => {
    if (user.role === 'examiner') api.get('/api/home/examiner').then(setD)
  }, [user.role])
  if (user.role === 'admin') return <Navigate to="/app/admin" replace />
  if (!d) return <Spinner />
  const c = d.counts
  const weekAgo = new Date(Date.now() - 6 * 864e5).toISOString().slice(0, 10)
  return (
    <>
      <PageHeader eyebrow="Examiner" title={`Good day, ${user.full_name.split(' ')[0]}`} description="What needs your decision, and your latest screenings." />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Needs your decision" value={c.open_cases} icon={Briefcase} tone="amber" to="/app/cases?status=open" />
        <Stat label="Screenings this week" value={c.screenings_week} icon={ScanSearch} to={`/app/records?date_from=${weekAgo}`} />
        <Stat label="Decisions made" value={c.decided} icon={CheckCircle2} tone="green" to="/app/cases?status=closed" />
        <Stat label="Clients you can screen" value={c.clients} icon={Users} tone="violet" to="/app/clients" />
      </div>
      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <Action to="/app/screen" icon={ScanSearch} title="Screen a signature" text="Compare a questioned signature with a client on file." />
        <Action to="/app/clients" icon={UserPlus} title="Register a client" text="Add a client and enroll their signatures." />
        <Action to="/app/records" icon={ClipboardList} title="See all records" text="Every screening you made, with receipt codes." />
      </div>
      <div className="grid items-start gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card title="Needs your decision" subtitle="Screenings that were not clearly Consistent" bodyClass="p-0"
          actions={<Link to="/app/cases" className="text-sm font-medium text-brand-700 hover:underline">All cases</Link>}>
          {d.open_cases.length === 0 ? <Empty icon={CheckCircle2}>Nothing is waiting for you.</Empty> : <CasesTable cases={d.open_cases} compact />}
        </Card>
        <Card title="Latest screenings" bodyClass="p-0"
          actions={<Link to="/app/records" className="text-sm font-medium text-brand-700 hover:underline">Records</Link>}>
          {d.recent.length === 0 ? (
            <Empty icon={ScanSearch}>No screenings yet.</Empty>
          ) : (
            <ul className="divide-y divide-slate-100">
              {d.recent.map((l) => (
                <li key={l.id}>
                  <button onClick={() => navigate(`/app/records/${l.id}`)} className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left hover:bg-slate-50">
                    <span className="min-w-0">
                      <span className="block font-medium">{l.client_name} <span className="text-sm font-normal text-slate-500">{l.client_code}</span></span>
                      <span className="block text-sm text-slate-500">{l.modality === 'static' ? 'Static' : 'Dynamic'} · {fmtDate(l.created_at)}</span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <ScreeningBadge value={l.screening_result} />
                      <DecisionCell row={l} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  )
}
