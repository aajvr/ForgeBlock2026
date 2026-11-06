import {
  Activity,
  Bell,
  BookOpen,
  Briefcase,
  ChevronDown,
  ChevronsRight,
  ClipboardList,
  Gauge,
  Home,
  Link2,
  LogOut,
  Menu,
  Pin,
  PinOff,
  ScanSearch,
  Search,
  Settings2,
  ShieldCheck,
  ShieldHalf,
  User,
  Users,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../auth'
import { BrandMark } from './Brand'
import Tour from './Tour'
import { Avatar, fmtDate } from './ui'

const EXAMINER_NAV = [
  { section: 'Workspace' },
  { to: '/app/home', label: 'My work', icon: Home, end: true, tour: 'nav-home' },
  { to: '/app/cases', label: 'Cases', icon: Briefcase, tour: 'nav-cases' },
  { to: '/app/clients', label: 'Clients', icon: Users, tour: 'nav-clients' },
  { to: '/app/screen', label: 'Screen a signature', icon: ScanSearch, tour: 'nav-screen' },
  { to: '/app/records', label: 'Records', icon: ClipboardList, tour: 'nav-records' },
]

const ADMIN_NAV = [
  { section: 'Overview' },
  { to: '/app/admin', label: 'Dashboard', icon: Gauge, end: true, tour: 'nav-home' },
  { section: 'Casework' },
  { to: '/app/cases', label: 'Cases', icon: Briefcase, tour: 'nav-cases' },
  { to: '/app/clients', label: 'Clients', icon: Users, tour: 'nav-clients' },
  { to: '/app/screen', label: 'Screen a signature', icon: ScanSearch, tour: 'nav-screen' },
  { to: '/app/records', label: 'Records', icon: ClipboardList, tour: 'nav-records' },
  { section: 'Integrity' },
  { to: '/app/admin/ledger', label: 'Ledger', icon: Link2, tour: 'nav-ledger' },
  { to: '/app/admin/audit', label: 'Audit log', icon: ShieldCheck },
  { section: 'Administration' },
  { to: '/app/admin/users', label: 'Users and roles', icon: ShieldHalf, tour: 'nav-users' },
  { to: '/app/admin/settings', label: 'Policy and retention', icon: Settings2, tour: 'nav-policy' },
  { to: '/app/admin/system', label: 'System', icon: Activity },
]

const CLIENT_NAV = [
  { section: 'My signatures' },
  { to: '/app/me', label: 'Home', icon: Home, end: true, tour: 'nav-home' },
]

const COMMON = [
  { section: 'Account' },
  { to: '/app/profile', label: 'Profile', icon: User, tour: 'nav-profile' },
  { to: '/app/help', label: 'Help Center', icon: BookOpen, tour: 'nav-help' },
]

// Each role has its own sidebar shade and badge, so it is clear at a glance
// which workspace is open.
export const ROLE_STYLE = {
  admin: { sidebar: 'sidebar-admin', active: 'text-indigo-800', badge: 'bg-indigo-100 text-indigo-800 ring-indigo-200', workspace: 'Administrator workspace' },
  examiner: { sidebar: 'sidebar-examiner', active: 'text-brand-700', badge: 'bg-brand-100 text-brand-800 ring-brand-200', workspace: 'Examiner workspace' },
  client: { sidebar: 'sidebar-client', active: 'text-cyan-800', badge: 'bg-cyan-100 text-cyan-800 ring-cyan-200', workspace: 'Client portal' },
}

export function navFor(role) {
  const main = role === 'admin' ? ADMIN_NAV : role === 'client' ? CLIENT_NAV : EXAMINER_NAV
  return [...main, ...COMMON]
}

function crumb(pathname, items) {
  const match = items
    .filter((n) => n.to && (pathname === n.to || pathname.startsWith(`${n.to}/`)))
    .sort((a, b) => b.to.length - a.to.length)[0]
  if (match) return match.label
  if (pathname.startsWith('/app/records/')) return 'Screening record'
  return 'ForgeBlock'
}

const PINNED_KEY = 'forgeblock_sidebar_pinned'
const DESKTOP = '(min-width: 64rem)' // Tailwind's lg

function readPinned() {
  try {
    return localStorage.getItem(PINNED_KEY) === '1'
  } catch {
    return false
  }
}

function useDesktop() {
  const [desktop, setDesktop] = useState(() => window.matchMedia(DESKTOP).matches)
  useEffect(() => {
    const media = window.matchMedia(DESKTOP)
    const onChange = (e) => setDesktop(e.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])
  return desktop
}

function GlobalSearch() {
  const [q, setQ] = useState('')
  const [res, setRes] = useState(null)
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const box = useRef(null)

  useEffect(() => {
    if (q.trim().length < 2) {
      setRes(null)
      return
    }
    const t = setTimeout(() => api.get(`/api/search?q=${encodeURIComponent(q.trim())}`).then(setRes).catch(() => setRes(null)), 200)
    return () => clearTimeout(t)
  }, [q])

  useEffect(() => {
    const close = (e) => box.current && !box.current.contains(e.target) && setOpen(false)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  const go = (to) => {
    setOpen(false)
    setQ('')
    navigate(to)
  }
  const total = res ? res.clients.length + res.cases.length + res.receipts.length : 0

  return (
    <div ref={box} className="relative hidden w-full max-w-sm md:block">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        placeholder="Search clients, cases, receipt codes"
        className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm outline-none focus:border-brand-600 focus:bg-white focus:ring-2 focus:ring-brand-100"
      />
      {open && res && (
        <div className="absolute left-0 right-0 top-11 z-40 max-h-96 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
          {total === 0 && <div className="px-3 py-4 text-center text-sm text-slate-500">Nothing found.</div>}
          {res.clients.length > 0 && <div className="px-2 pb-1 pt-2 text-xs font-semibold uppercase text-slate-400">Clients</div>}
          {res.clients.map((c) => (
            <button key={`c${c.id}`} onClick={() => go(`/app/clients/${c.id}`)} className="block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-slate-50">
              <span className="font-medium">{c.full_name}</span> <span className="text-slate-500">{c.client_code}</span>
            </button>
          ))}
          {res.cases.length > 0 && <div className="px-2 pb-1 pt-2 text-xs font-semibold uppercase text-slate-400">Cases</div>}
          {res.cases.map((c) => (
            <button key={`k${c.id}`} onClick={() => go(`/app/cases/${c.id}`)} className="block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-slate-50">
              <span className="font-medium">{c.case_code}</span> <span className="text-slate-500">{c.title}</span>
            </button>
          ))}
          {res.receipts.length > 0 && <div className="px-2 pb-1 pt-2 text-xs font-semibold uppercase text-slate-400">Receipts</div>}
          {res.receipts.map((r) => (
            <button key={`r${r.id}`} onClick={() => go(`/app/records/${r.id}`)} className="block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-slate-50">
              <span className="font-mono">{r.receipt_code}</span> <span className="text-slate-500">{r.modality}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function Notifications() {
  const [data, setData] = useState({ unread: 0, items: [] })
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    const load = () => api.get('/api/notifications').then(setData).catch(() => {})
    load()
    const t = setInterval(load, 60000)
    return () => clearInterval(t)
  }, [location.pathname])

  const toggle = () => {
    setOpen((o) => !o)
    if (!open && data.unread) api.post('/api/notifications/read').then(() => setData((d) => ({ ...d, unread: 0 })))
  }

  return (
    <div className="relative">
      <button onClick={toggle} className="relative rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Notifications">
        <Bell className="h-5 w-5" />
        {data.unread > 0 && (
          <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-bad-600 px-1 text-[11.5px] font-semibold text-white">
            {data.unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-11 z-40 w-80 rounded-xl border border-slate-200 bg-white p-2 shadow-lg" onMouseLeave={() => setOpen(false)}>
          <div className="px-2 py-1.5 text-sm font-semibold">Notifications</div>
          {data.items.length === 0 && <div className="px-3 py-6 text-center text-sm text-slate-500">You're all caught up.</div>}
          <div className="max-h-80 overflow-y-auto">
            {data.items.map((n) => (
              <button
                key={n.id}
                onClick={() => {
                  setOpen(false)
                  if (n.link) navigate(n.link)
                }}
                className="block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-slate-50"
              >
                <div className={n.read ? 'text-slate-600' : 'font-medium text-slate-900'}>{n.text}</div>
                <div className="mt-0.5 text-xs text-slate-400">{fmtDate(n.created_at)}</div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function UserMenu({ user, onSignOut }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-3 rounded-lg px-2 py-1 hover:bg-slate-100">
        <Avatar name={user.full_name} role={user.role} />
        <span className="hidden text-left sm:block">
          <span className="block text-sm font-semibold leading-tight">{user.full_name}</span>
          <span className="block text-xs text-slate-500">
            {user.role_label}
            {user.account_code ? ` · ${user.account_code}` : ''}
          </span>
        </span>
        <ChevronDown className="hidden h-4 w-4 text-slate-400 sm:block" />
      </button>
      {open && (
        <div className="absolute right-0 top-12 z-40 w-48 rounded-xl border border-slate-200 bg-white p-1 shadow-lg" onMouseLeave={() => setOpen(false)}>
          <Link to="/app/profile" onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-slate-50">
            <User className="h-4 w-4" /> Profile
          </Link>
          <button onClick={onSignOut} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-bad-600 hover:bg-bad-50">
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      )}
    </div>
  )
}

export default function Layout() {
  const { user, signOut, tourOpen } = useAuth()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [open, setOpen] = useState(false)
  const [pinned, setPinned] = useState(readPinned)
  const [peek, setPeek] = useState(false)
  const [tip, setTip] = useState(null)
  const timer = useRef(null)
  const desktop = useDesktop()
  const items = navFor(user.role)
  const staff = user.role !== 'client'
  const style = ROLE_STYLE[user.role] || ROLE_STYLE.examiner
  const touring = tourOpen || !user.tour_completed
  // Desktop starts as an icon rail that opens over the page; pinned, it stays open beside it.
  // Phones always get the full drawer. The tour opens it so its labels can be pointed at.
  const floating = desktop && !pinned
  const expanded = !desktop || pinned || peek || touring
  const rail = desktop && !expanded
  useEffect(() => () => clearTimeout(timer.current), [])

  const later = (fn, ms) => {
    clearTimeout(timer.current)
    timer.current = setTimeout(fn, ms)
  }
  // A short pause before opening, so moving the mouse across the rail does not open it.
  const hoverProps = floating
    ? {
        onMouseEnter: () => later(() => setPeek(true), 450),
        onMouseLeave: () => later(() => setPeek(false), 200),
        onFocus: () => {
          clearTimeout(timer.current)
          setPeek(true)
        },
        onBlur: (e) => !e.currentTarget.contains(e.relatedTarget) && setPeek(false),
        onKeyDown: (e) => e.key === 'Escape' && setPeek(false),
      }
    : {}

  const togglePinned = () => {
    const next = !pinned
    setPinned(next)
    setPeek(false)
    setTip(null)
    try {
      localStorage.setItem(PINNED_KEY, next ? '1' : '0')
    } catch { /* the choice just is not remembered */ }
  }

  // Tooltips are fixed to the viewport so the scrolling menu does not clip them.
  const showTip = (e, label) => {
    const r = e.currentTarget.getBoundingClientRect()
    setTip({ label, top: r.top + r.height / 2, left: r.right + 12 })
  }
  const tipProps = (label) => (rail
    ? {
        onMouseEnter: (e) => showTip(e, label),
        onMouseLeave: () => setTip(null),
        onFocus: (e) => showTip(e, label),
        onBlur: () => setTip(null),
      }
    : {})

  // Labels fade rather than jump, and the icons keep their place as the sidebar opens.
  const fade = `whitespace-nowrap transition-opacity duration-200 ${expanded ? 'opacity-100' : 'opacity-0'}`
  const link = ({ isActive }) =>
    `group relative flex items-center gap-3 rounded-xl py-0.5 pl-1 pr-3 text-base transition lg:rounded-l-2xl ${
      isActive
        ? `nav-connected bg-white font-semibold ${style.active} shadow-sm lg:rounded-r-none lg:shadow-none`
        : `text-white/90 hover:text-white lg:mr-3 lg:rounded-r-2xl ${expanded ? 'hover:bg-white/15' : ''}`
    }`
  // The hover tile fades in behind the icon, and the icon grows slightly.
  const icon = (Icon, active) => (
    <span className="relative flex h-9 w-9 shrink-0 items-center justify-center">
      {!active && <span className="absolute inset-0 rounded-lg bg-white/20 opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100" />}
      <Icon className="relative h-6 w-6 transition-transform duration-200 group-hover:scale-[1.08]" />
    </span>
  )
  const control = rail
    ? { label: 'Expand the menu', Icon: ChevronsRight, onClick: () => setPeek(true) }
    : pinned
      ? { label: 'Unpin the menu', Icon: PinOff, onClick: togglePinned }
      : { label: 'Pin the menu open', Icon: Pin, onClick: togglePinned }

  const doSignOut = () => {
    signOut()
    navigate('/signin')
  }

  return (
    <div className={`app-shell ${style.sidebar} min-h-screen lg:flex lg:h-screen lg:overflow-hidden`}>
      <div className="app-blobs pointer-events-none fixed inset-0 overflow-hidden" aria-hidden="true">
        <div className="blob absolute -left-24 -top-24 h-96 w-96 rounded-full bg-brand-400 opacity-35 blur-3xl" />
        <div className="blob absolute -left-16 top-1/2 h-80 w-80 rounded-full bg-cyan-400 opacity-30 blur-3xl [animation-delay:-8s]" />
        <div className="blob absolute -bottom-24 left-1/3 h-96 w-96 rounded-full bg-indigo-400 opacity-30 blur-3xl [animation-delay:-14s]" />
      </div>
      <div className={`hidden shrink-0 transition-[width] duration-200 lg:block ${pinned ? 'w-[19rem]' : 'w-[5.25rem]'}`} aria-hidden="true" />
      <aside
        {...hoverProps}
        className={`${open ? 'translate-x-0' : '-translate-x-full max-lg:invisible'} ${style.sidebar} sidebar-glass ${!desktop || (floating && expanded) ? 'is-over' : ''} fixed inset-y-0 left-0 z-30 flex w-[19rem] max-w-[86vw] flex-col overflow-x-hidden pb-4 pl-[1.125rem] pr-4 pt-6 text-white transition-[transform,width,visibility,box-shadow] duration-200 lg:max-w-none lg:translate-x-0 lg:pr-0 ${
          expanded ? 'lg:w-[19rem]' : 'lg:w-[5.25rem]'
        } ${floating && expanded ? 'lg:shadow-[10px_0_30px_-12px_rgb(0_0_0/0.45)]' : ''}`}
      >
        <div className="flex h-10 items-center justify-between pl-1 lg:pr-4">
          <div className="flex min-w-0 items-center gap-2.5">
            <BrandMark light className="h-9 w-9 shrink-0" />
            <span className={`text-xl font-semibold tracking-tight ${fade}`}>ForgeBlock</span>
          </div>
          <button className="lg:hidden" onClick={() => setOpen(false)} aria-label="Close menu">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className={`mb-4 mt-2.5 h-7 pl-1 ${fade}`}>
          <span className="inline-flex rounded-lg bg-white/15 px-2.5 py-1 text-xs font-semibold text-white">{style.workspace}</span>
        </div>
        <nav className="nav-scroll flex-1 space-y-0.5 overflow-y-auto overflow-x-hidden pb-5 pt-1" aria-label="Main menu" onClick={() => setOpen(false)}>
          {items.map((n, i) =>
            n.section ? (
              <div key={`s${i}`} className="relative flex h-7 items-end pb-1 pl-2 first:h-6">
                <span className={`text-[12.5px] font-semibold uppercase tracking-[0.12em] text-white/60 ${fade}`}>{n.section}</span>
                <span className={`absolute bottom-2.5 left-2 h-px w-8 bg-white/30 transition-opacity duration-200 ${rail ? 'opacity-100' : 'opacity-0'}`} aria-hidden="true" />
              </div>
            ) : (
              <NavLink key={n.to} to={n.to} end={n.end} className={link} data-tour={n.tour} {...tipProps(n.label)}>
                {({ isActive }) => (
                  <>
                    {icon(n.icon, isActive)}
                    <span className={fade}>{n.label}</span>
                  </>
                )}
              </NavLink>
            ),
          )}
        </nav>
        {user.study_mode && (
          rail ? (
            <div className="mr-3 mt-2 flex justify-center rounded-lg p-2 text-white/80" tabIndex={0} aria-label="Research use only" {...tipProps('Research use only')}>
              <ShieldCheck className="h-5 w-5" />
            </div>
          ) : (
            <div className="mt-2 w-[16.5rem] border-t border-white/15 px-2 pt-4 text-xs text-white/70 [@media(max-height:960px)]:hidden">
              <div className="flex items-center gap-2 text-sm font-medium text-white">
                <ShieldCheck className="h-4 w-4" /> Research use only
              </div>
              <p className="mt-1 leading-relaxed">For the approved ForgeBlock study activities. Not for actual legal, financial or official documents.</p>
            </div>
          )
        )}
        <button
          onClick={control.onClick}
          aria-label={control.label}
          aria-pressed={rail ? undefined : pinned}
          className="group mt-2 hidden items-center gap-3 rounded-xl py-0.5 pl-1 pr-3 text-sm font-medium text-white/80 transition hover:text-white lg:mr-3 lg:flex"
          {...tipProps(control.label)}
        >
          {icon(control.Icon, false)}
          <span className={fade}>{control.label}</span>
        </button>
      </aside>
      {rail && tip && (
        <div role="tooltip" className="pointer-events-none fixed z-40 -translate-y-1/2 whitespace-nowrap rounded-lg bg-slate-900 px-2.5 py-1.5 text-sm font-medium text-white shadow-lg" style={{ top: tip.top, left: tip.left }}>
          {tip.label}
        </div>
      )}
      {open && <div className="fixed inset-0 z-20 bg-black/40 lg:hidden" onClick={() => setOpen(false)} />}
      <div className="app-panel relative min-h-screen min-w-0 flex-1 bg-white lg:my-3 lg:bg-white/[0.92] lg:mr-3 lg:flex lg:min-h-0 lg:flex-col lg:overflow-hidden lg:rounded-[2rem] lg:shadow-2xl">
        <header className="topbar sticky top-0 z-10 flex h-[4.5rem] shrink-0 items-center gap-4 border-b border-slate-100 bg-white/95 px-4 backdrop-blur sm:px-8 lg:static lg:px-10">
          <button className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100 lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </button>
          <div className="hidden min-w-0 items-center gap-2 text-sm sm:flex">
            <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${style.badge}`}>{user.role_label}</span>
            <span className="text-slate-300">/</span>
            <span className="truncate font-medium text-slate-800">{crumb(pathname, items)}</span>
          </div>
          <div className="ml-auto flex flex-1 items-center justify-end gap-2">
            {staff && <GlobalSearch />}
            <Notifications />
            <UserMenu user={user} onSignOut={doSignOut} />
          </div>
        </header>
        <div className="app-scroll lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
          <main className="mx-auto max-w-[1240px] px-4 py-8 sm:px-8 lg:px-10">
            <Outlet />
          </main>
        </div>
        {(tourOpen || !user.tour_completed) && <Tour />}
      </div>
    </div>
  )
}
