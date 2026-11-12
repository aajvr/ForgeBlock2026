import { ArrowUpRight, Briefcase, CheckCircle2, ClipboardList, ScanSearch, UserPlus, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../auth'
import { Card, Empty, PageHeader, ScreeningBadge, Spinner, Stat, fmtDate } from '../components/ui'
import { CasesTable } from './Cases'
import { DecisionCell } from './Records'

// A shortcut card (v3): icon bubble in the role tint, title, one line, arrow tile.
function Action({ to, icon, title, text }) {
  const Icon = icon
  return (
    <Link to={to} className="group flex items-start gap-3 rounded-[16px] border border-line bg-white px-[18px] py-4 shadow-soft transition-[transform,border-color] duration-200 hover:-translate-y-0.5 hover:border-brand-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] bg-[var(--role-soft)] text-[var(--role-active)]"><Icon className="h-5 w-5" /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold text-ink">{title}</span>
        <span className="mt-0.5 block text-[13px] leading-snug text-muted">{text}</span>
      </span>
      <span aria-hidden className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[9px] bg-brand-50 text-brand-800 transition-colors group-hover:bg-brand-100">
        <ArrowUpRight className="h-[15px] w-[15px]" />
      </span>
    </Link>
  )
}

// A small outlined link for a card header ("All cases", "Records").
const headerLink = 'rounded-[10px] border border-line px-3 py-1.5 text-[13px] font-medium text-[#3b4a5e] transition-colors hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700'

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
      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4" data-tour="home-stats">
        <Stat label="Needs your decision" value={c.open_cases} icon={Briefcase} tone="amber" to="/app/cases?status=open" />
        <Stat label="Screenings this week" value={c.screenings_week} icon={ScanSearch} to={`/app/records?date_from=${weekAgo}`} />
        <Stat label="Decisions made" value={c.decided} icon={CheckCircle2} tone="green" to="/app/cases?status=closed" />
        <Stat label="Clients you can screen" value={c.clients} icon={Users} tone="violet" to="/app/clients" />
      </div>
      <div className="mb-5 grid gap-4 md:grid-cols-3" data-tour="home-actions">
        <Action to="/app/screen" icon={ScanSearch} title="Screen a signature" text="Compare a questioned signature with a client on file." />
        <Action to="/app/clients" icon={UserPlus} title="Register a client" text="Add a client and enroll their signatures." />
        <Action to="/app/records" icon={ClipboardList} title="See all records" text="Every screening you made, with receipt codes." />
      </div>
      <div className="grid items-start gap-5 lg:grid-cols-[1.4fr_1fr]">
        <Card title="Needs your decision" subtitle="Screenings that were not clearly Consistent" bodyClass="p-0" data-tour="home-decisions"
          actions={<Link to="/app/cases" className={headerLink}>All cases</Link>}>
          {d.open_cases.length === 0 ? <Empty icon={CheckCircle2}>Nothing is waiting for you.</Empty> : <CasesTable cases={d.open_cases} compact />}
        </Card>
        <Card title="Latest screenings" bodyClass="p-0"
          actions={<Link to="/app/records" className={headerLink}>Records</Link>}>
          {d.recent.length === 0 ? (
            <Empty icon={ScanSearch}>No screenings yet.</Empty>
          ) : (
            <ul className="divide-y divide-track border-t border-track">
              {d.recent.map((l) => (
                <li key={l.id}>
                  <button onClick={() => navigate(`/app/records/${l.id}`)} className="flex w-full items-center justify-between gap-3 px-[22px] py-3 text-left transition-colors hover:bg-[#f7fafd] focus-visible:bg-brand-50 focus-visible:outline-none">
                    <span className="min-w-0">
                      <span className="block text-[14px] font-semibold text-ink">{l.client_name} <span className="font-normal text-muted">{l.client_code}</span></span>
                      <span className="block text-[12.5px] text-muted">{l.modality === 'static' ? 'Static' : 'Dynamic'} · {fmtDate(l.created_at)}</span>
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
