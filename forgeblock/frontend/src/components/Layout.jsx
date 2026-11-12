import {
  Activity,
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
import Logo from './Logo'
import NotificationBell from './NotificationBell'
import Tour from './Tour'
import { Avatar } from './ui'

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
  // Desktop starts as an icon rail that opens over the page; pinned, it stays open beside it.
  // Phones always get the full drawer.
  const floating = desktop && !pinned
  const expanded = !desktop || pinned || peek
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

  // Labels stay rendered and fade with a small slide; icons keep their place as the sidebar opens.
  const fade = `transition-[opacity,translate] motion-fb ${expanded ? 'translate-x-0 opacity-100' : '-translate-x-1 opacity-0'}`
  // Active: a rounded tile in the sidebar's own colour with a white pill. Hover: a lighter tile.
  const link = ({ isActive }) =>
    `group relative flex h-10 items-center rounded-xl transition-colors motion-fb ${
      isActive ? 'bg-white/15 font-semibold text-white' : 'text-white/85 hover:bg-white/[0.08] hover:text-white'
    }`
  const pill = (on) => (
    <span className={`absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-white transition-opacity motion-fb ${on ? 'opacity-100' : 'opacity-0'}`} aria-hidden="true" />
  )
  // The icon slot is as wide as the rail's inner width, so icons sit centred in the rail.
  const icon = (glyph) => {
    const Icon = glyph
    return (
      <span className="flex h-10 w-[3.75rem] shrink-0 items-center justify-center">
        <Icon className="h-6 w-6 transition-transform motion-fb group-hover:scale-[1.08]" />
      </span>
    )
  }
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
    <div className={`app-shell ${style.sidebar} min-h-screen lg:h-screen lg:overflow-hidden`}>
      <div className="app-blobs pointer-events-none fixed inset-0 overflow-hidden" aria-hidden="true">
        <div className="blob absolute -left-24 -top-24 h-96 w-96 rounded-full bg-brand-400 opacity-35 blur-3xl" />
        <div className="blob absolute -left-16 top-1/2 h-80 w-80 rounded-full bg-cyan-400 opacity-30 blur-3xl [animation-delay:-8s]" />
        <div className="blob absolute -bottom-24 left-1/3 h-96 w-96 rounded-full bg-indigo-400 opacity-30 blur-3xl [animation-delay:-14s]" />
      </div>
      <aside
        {...hoverProps}
        className={`${open ? 'translate-x-0' : '-translate-x-full max-lg:invisible'} ${style.sidebar} sidebar-glass ${!desktop || (floating && expanded) ? 'is-over' : ''} fixed inset-y-0 left-0 z-30 flex w-[19rem] max-w-[86vw] flex-col overflow-hidden px-3 py-5 text-white transition-[translate,width,visibility,box-shadow] motion-fb lg:max-w-none lg:translate-x-0 ${
          expanded ? 'lg:w-[19rem]' : 'lg:w-[5.25rem]'
        } ${floating && expanded ? 'is-lifted' : ''}`}
      >
        <div className="flex h-10 shrink-0 items-center">
          <span className="flex w-[3.75rem] shrink-0 justify-center"><Logo variant="white" showText={false} size={28} /></span>
          <span className={`whitespace-nowrap text-xl font-bold tracking-tight text-white ${fade}`} aria-hidden="true">ForgeBlock</span>
          <button className="ml-auto mr-1 lg:hidden" onClick={() => setOpen(false)} aria-label="Close menu">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className={`mb-3 mt-2 h-7 shrink-0 whitespace-nowrap pl-3 ${fade}`}>
          <span className="inline-flex rounded-lg bg-white/15 px-2.5 py-1 text-xs font-semibold text-white">{style.workspace}</span>
        </div>
        <nav className="nav-scroll flex-1 space-y-0.5 overflow-y-auto overflow-x-hidden pb-4 pt-1" aria-label="Main menu" onClick={() => setOpen(false)}>
          {items.map((n, i) =>
            n.section ? (
              <div key={`s${i}`} className={`relative flex items-end pb-1.5 ${i === 0 ? 'h-5' : 'h-7'}`}>
                <span className={`whitespace-nowrap pl-[1.125rem] text-[12.5px] font-semibold uppercase tracking-[0.12em] text-white/60 ${fade}`}>{n.section}</span>
                {i > 0 && (
                  <span className={`absolute top-1/2 flex w-[3.75rem] justify-center transition-opacity motion-fb ${rail ? 'opacity-100' : 'opacity-0'}`} aria-hidden="true">
                    <span className="h-px w-6 bg-white/30" />
                  </span>
                )}
              </div>
            ) : (
              <NavLink key={n.to} to={n.to} end={n.end} className={link} data-tour={n.tour} {...tipProps(n.label)}>
                {({ isActive }) => (
                  <>
                    {pill(isActive)}
                    {icon(n.icon)}
                    <span className={`whitespace-nowrap pr-3 text-base ${fade}`}>{n.label}</span>
                  </>
                )}
              </NavLink>
            ),
          )}
        </nav>
        {user.study_mode && (
          <div className="mt-2 shrink-0 border-t border-white/15 pt-2 text-white/80" tabIndex={rail ? 0 : -1} aria-label="Research use only" {...tipProps('Research use only')}>
            <div className="flex h-10 items-center">
              {icon(ShieldCheck)}
              <span className={`whitespace-nowrap text-sm font-medium text-white ${fade}`}>Research use only</span>
            </div>
            <p className={`w-[16rem] pl-[1.125rem] text-xs leading-relaxed text-white/70 [@media(max-height:960px)]:hidden ${fade}`}>
              For the approved ForgeBlock study activities. Not for actual legal, financial or official documents.
            </p>
          </div>
        )}
        <button
          onClick={control.onClick}
          aria-label={control.label}
          aria-pressed={rail ? undefined : pinned}
          className="group mt-2 hidden h-10 shrink-0 items-center rounded-xl text-sm font-medium text-white/85 transition-colors motion-fb hover:bg-white/[0.08] hover:text-white lg:flex"
          {...tipProps(control.label)}
        >
          {icon(control.Icon)}
          <span className={`whitespace-nowrap ${fade}`}>{control.label}</span>
        </button>
      </aside>
      {rail && tip && (
        <div role="tooltip" className="pointer-events-none fixed z-40 -translate-y-1/2 whitespace-nowrap rounded-lg bg-slate-900 px-2.5 py-1.5 text-sm font-medium text-white shadow-lg" style={{ top: tip.top, left: tip.left }}>
          {tip.label}
        </div>
      )}
      {open && <div className="fixed inset-0 z-20 bg-black/40 lg:hidden" onClick={() => setOpen(false)} />}
      <div className={`app-content transition-[padding-left] motion-fb lg:h-full ${pinned ? 'lg:pl-[calc(19rem-1px)]' : 'lg:pl-[calc(5.25rem-1px)]'}`}>
      <div className="app-panel relative min-h-screen min-w-0 bg-white lg:flex lg:h-full lg:min-h-0 lg:flex-col lg:overflow-hidden lg:bg-white/[0.92]">
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
            <NotificationBell />
            <UserMenu user={user} onSignOut={doSignOut} />
          </div>
        </header>
        <div className="app-scroll lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
          <main className="mx-auto max-w-[1240px] px-4 py-8 sm:px-8 lg:px-10">
            <Outlet />
          </main>
        </div>
        {(tourOpen || !user.tour_completed) && <Tour key={tourOpen || 'first'} kind={typeof tourOpen === 'string' ? tourOpen : 'full'} />}
      </div>
      </div>
    </div>
  )
}
