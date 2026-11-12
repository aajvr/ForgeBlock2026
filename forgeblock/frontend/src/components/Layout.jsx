import {
  Activity,
  BookOpen,
  Briefcase,
  ChevronDown,
  ChevronsRight,
  CircleHelp,
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
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../auth'
import Logo from './Logo'
import NotificationBell from './NotificationBell'
import Tour from './Tour'
import { bandButton } from './ui'

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
  { to: '/app/admin/audit', label: 'Audit log', icon: ShieldCheck, tour: 'nav-audit' },
  { section: 'Administration' },
  { to: '/app/admin/users', label: 'Users and roles', icon: ShieldHalf, tour: 'nav-users' },
  { to: '/app/admin/settings', label: 'Policy and retention', icon: Settings2, tour: 'nav-policy' },
  { to: '/app/admin/system', label: 'System', icon: Activity, tour: 'nav-system' },
]

const CLIENT_NAV = [
  { section: 'My signatures' },
  { to: '/app/me', label: 'Home', icon: Home, end: true, tour: 'nav-home' },
]

// Help and Profile sit at the bottom of the rail, under a thin divider.
const COMMON = [
  { to: '/app/help', label: 'Help Center', icon: BookOpen, tour: 'nav-help' },
  { to: '/app/profile', label: 'Profile', icon: User, tour: 'nav-profile' },
]

// Each role keeps its own colour (Examiner blue, Admin indigo, Client teal). The
// colours themselves are CSS variables chosen by data-role (see index.css).
export const ROLE_STYLE = {
  admin: { workspace: 'Administrator workspace' },
  examiner: { workspace: 'Examiner workspace' },
  client: { workspace: 'Client portal' },
}

export function navFor(role) {
  const main = role === 'admin' ? ADMIN_NAV : role === 'client' ? CLIENT_NAV : EXAMINER_NAV
  return [...main, ...COMMON]
}

const STUDY_NOTE = 'For the approved ForgeBlock study activities. Not for actual legal, financial or official documents.'

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

// Only picks the shortcut label (Ctrl K or ⌘ K); nothing else depends on it.
const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgentData?.platform || navigator.platform || '')

function GlobalSearch() {
  const [q, setQ] = useState('')
  const [res, setRes] = useState(null)
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const box = useRef(null)
  const input = useRef(null)

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
    // Ctrl K (⌘K on a Mac) jumps to the search box.
    const key = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        input.current?.focus()
        input.current?.select()
      }
    }
    document.addEventListener('mousedown', close)
    window.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', key)
    }
  }, [])

  const go = (to) => {
    setOpen(false)
    setQ('')
    navigate(to)
  }
  const total = res ? res.clients.length + res.cases.length + res.receipts.length : 0

  return (
    <div ref={box} className="relative mx-auto hidden w-full max-w-[520px] flex-1 md:block" data-tour="global-search">
      <Search className="pointer-events-none absolute left-3.5 top-1/2 z-10 h-[18px] w-[18px] -translate-y-1/2 text-white/80" />
      <input
        ref={input}
        value={q}
        onChange={(e) => {
          setQ(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => e.key === 'Escape' && (setOpen(false), e.currentTarget.blur())}
        placeholder="Search clients, cases, receipt codes"
        aria-label="Search clients, cases, receipt codes"
        aria-keyshortcuts={IS_MAC ? 'Meta+K' : 'Control+K'}
        className="w-full rounded-[12px] border border-white/22 bg-white/12 py-2.5 pl-10 pr-16 text-sm text-white outline-none backdrop-blur-sm transition placeholder:text-white/75 hover:bg-white/16 focus:border-white/50 focus:bg-white/20 focus:ring-2 focus:ring-white/25"
      />
      <kbd className="pointer-events-none absolute right-3 top-1/2 z-10 -translate-y-1/2 rounded-[6px] bg-white/15 px-1.5 py-0.5 font-sans text-[11px] text-white">
        {IS_MAC ? '⌘ K' : 'Ctrl K'}
      </kbd>
      {open && res && (
        <div className="absolute left-0 right-0 top-12 z-40 max-h-96 overflow-y-auto rounded-[12px] border border-line bg-white p-2 text-ink shadow-xl">
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

function initialsOf(name) {
  return (name || '?').split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()
}

// Initials avatar on the band: a white circle with initials in the role colour. No photos.
function UserMenu({ user, onSignOut }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const close = (e) => !ref.current?.contains(e.target) && setOpen(false)
    const esc = (e) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', esc)
    }
  }, [open])
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-2.5 rounded-[12px] py-1 pl-1 pr-1.5 text-white transition-colors hover:bg-white/12 focus-visible:outline-2 focus-visible:outline-white"
      >
        <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full bg-white text-[12px] font-bold text-[var(--role-active)]">
          {initialsOf(user.full_name)}
        </span>
        <span className="hidden text-left sm:block">
          <span className="block max-w-[11rem] truncate text-[13px] font-semibold leading-tight">{user.full_name}</span>
          <span className="block max-w-[11rem] truncate text-[11px] leading-tight text-white/80">
            {user.role_label}
            {user.account_code ? ` · ${user.account_code}` : ''}
          </span>
        </span>
        <ChevronDown className="hidden h-4 w-4 text-white/70 sm:block" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-12 z-40 w-48 rounded-[12px] border border-line bg-white p-1 text-ink shadow-xl">
          <Link role="menuitem" to="/app/profile" onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-slate-50">
            <User className="h-4 w-4" /> Profile
          </Link>
          <button role="menuitem" onClick={onSignOut} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-bad-600 hover:bg-bad-50">
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      )}
    </div>
  )
}

// Pill geometry (px). The rail is 80px wide (44px tiles + 17px padding + 1px
// border each side) and 16px from the screen edges; content starts 24px after it.
const RAIL_W = 80
const OPEN_W = 272
const GAP = 16
const CONTENT_GAP = 24

export default function Layout() {
  const { user, signOut, tourOpen } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [pinned, setPinned] = useState(readPinned)
  const [peek, setPeek] = useState(false)
  const [tip, setTip] = useState(null)
  const timer = useRef(null)
  const desktop = useDesktop()
  const role = ROLE_STYLE[user.role] ? user.role : 'examiner'
  const items = navFor(role)
  const mainItems = items.filter((n) => !COMMON.includes(n))
  const staff = user.role !== 'client'
  const style = ROLE_STYLE[role]
  // Desktop starts as an icon rail that opens over the page; pinned, it stays open beside it.
  // Phones always get the full drawer.
  const floating = desktop && !pinned
  const expanded = !desktop || pinned || peek
  const rail = desktop && !expanded
  useEffect(() => () => clearTimeout(timer.current), [])

  // Esc closes the phone drawer.
  useEffect(() => {
    if (!open) return
    const esc = (e) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [open])

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
    setTip({ label, top: r.top + r.height / 2, left: r.right + 14 })
  }
  const tipProps = (label) => (rail
    ? {
        onMouseEnter: (e) => showTip(e, label),
        onMouseLeave: () => setTip(null),
        onFocus: (e) => showTip(e, label),
        onBlur: () => setTip(null),
      }
    : {})

  // Labels stay rendered and fade with a small slide; icons keep their place as the pill widens.
  const fade = `transition-[opacity,translate] motion-fb ${expanded ? 'translate-x-0 opacity-100' : '-translate-x-1 opacity-0'}`
  // 44px rounded-12 tiles. Active: solid role colour, white icon, soft shadow.
  const link = ({ isActive }) =>
    `rail-tile group relative flex h-[44px] shrink-0 items-center rounded-[12px] transition-colors motion-fb focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 ${
      isActive
        ? 'bg-[var(--role-active)] font-semibold text-white shadow-[0_6px_14px_rgb(12_40_70/0.3)]'
        : 'text-muted hover:bg-[#eef4fb] hover:text-ink'
    }`
  const icon = (glyph) => {
    const Icon = glyph
    return (
      <span className="flex h-full w-[44px] shrink-0 items-center justify-center">
        <Icon className="h-5 w-5 transition-transform motion-fb group-hover:scale-[1.06]" />
      </span>
    )
  }
  const navLink = (n) => (
    <NavLink key={n.to} to={n.to} end={n.end} className={link} data-tour={n.tour} aria-label={rail ? n.label : undefined} {...tipProps(n.label)}>
      {icon(n.icon)}
      <span className={`whitespace-nowrap pl-1 pr-3 text-[15px] ${fade}`}>{n.label}</span>
    </NavLink>
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

  const pillW = expanded ? OPEN_W : RAIL_W
  const contentPad = GAP + (pinned ? OPEN_W : RAIL_W) + CONTENT_GAP

  return (
    <div data-role={role} className="app-shell relative min-h-screen overflow-x-clip bg-page">
      {/* The role's colour band, behind everything (sidebar included); it scrolls with the page and fades into it. */}
      <div className="app-band pointer-events-none absolute inset-x-0 top-0 h-[440px]" aria-hidden="true" />

      <aside
        {...hoverProps}
        style={desktop ? { width: pillW } : undefined}
        className={`pill-rail ${(!desktop && open) || (floating && expanded) ? 'is-lifted' : ''} ${
          open ? 'translate-x-0' : '-translate-x-[calc(100%+2rem)] max-lg:invisible'
        } fixed bottom-3 left-3 top-3 z-30 flex w-[272px] max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-[40px] border border-line bg-white px-[17px] py-4 transition-[translate,width,visibility,box-shadow] motion-fb lg:bottom-4 lg:left-4 lg:top-4 lg:max-w-none lg:translate-x-0`}
      >
        {/* Logo mark at the top */}
        <div className="mb-2 flex h-[44px] shrink-0 items-center">
          <span className="flex w-[44px] shrink-0 justify-center">
            <Logo variant="blue" showText={false} size={38} />
          </span>
          <span className={`whitespace-nowrap pl-2 text-xl font-bold tracking-tight text-brand-800 ${fade}`} aria-hidden="true">ForgeBlock</span>
          <button className="ml-auto flex h-9 w-9 items-center justify-center rounded-full text-muted hover:bg-track lg:hidden" onClick={() => setOpen(false)} aria-label="Close menu">
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="rail-stack nav-scroll -mx-[17px] flex flex-1 flex-col gap-[6px] overflow-y-auto overflow-x-hidden px-[17px] pb-3" aria-label="Main menu" onClick={() => setOpen(false)}>
          {mainItems.map((n, i) =>
            n.section ? (
              // Section names show only when the pill is open; in the rail they are a small gap.
              <div key={`s${i}`} className={`flex shrink-0 items-end ${i === 0 ? 'h-[14px]' : 'h-[22px]'}`} aria-hidden={rail}>
                <span className={`whitespace-nowrap pl-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400 ${fade}`}>{n.section}</span>
              </div>
            ) : (
              navLink(n)
            ),
          )}
        </nav>

        {/* Thin divider, then Help, Profile and the menu control */}
        <div className="rail-stack flex shrink-0 flex-col gap-[6px] border-t border-line pt-3" onClick={(e) => e.target.closest('a') && setOpen(false)}>
          {COMMON.map(navLink)}
          <button
            onClick={control.onClick}
            aria-label={control.label}
            aria-pressed={rail ? undefined : pinned}
            className="rail-tile group hidden h-[44px] shrink-0 items-center rounded-[12px] text-sm font-medium text-muted transition-colors motion-fb hover:bg-[#eef4fb] hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 lg:flex"
            {...tipProps(control.label)}
          >
            {icon(control.Icon)}
            <span className={`whitespace-nowrap pl-1 ${fade}`}>{control.label}</span>
          </button>
        </div>
      </aside>

      {rail && tip && (
        <div role="tooltip" className="pointer-events-none fixed z-40 -translate-y-1/2 whitespace-nowrap rounded-[8px] bg-ink px-2.5 py-1.5 text-sm font-medium text-white shadow-lg" style={{ top: tip.top, left: tip.left }}>
          {tip.label}
        </div>
      )}
      {open && <div className="fixed inset-0 z-20 bg-slate-900/40 lg:hidden" onClick={() => setOpen(false)} />}

      <div className="app-content relative transition-[padding-left] motion-fb" style={desktop ? { paddingLeft: contentPad } : undefined}>
        <div className="mx-auto max-w-[1320px] px-4 pb-10 pt-[18px] sm:px-6 lg:pl-0 lg:pr-9">
          {/* Top bar on the band: workspace, search, help, notifications, the user */}
          <header className="topbar relative z-20 flex items-center gap-3 sm:gap-4">
            <button className={`${bandButton} lg:hidden`} onClick={() => setOpen(true)} aria-label="Open menu">
              <Menu className="h-5 w-5" />
            </button>
            <div className="min-w-0 shrink lg:w-[220px] lg:shrink-0">
              <div className="truncate text-[13.5px] font-medium text-white/80">{style.workspace}</div>
              {/* Study mode: the research-use notice, always in view. */}
              {user.study_mode && (
                <div className="mt-0.5 flex items-center gap-1 text-[11.5px] font-medium text-white/75" title={STUDY_NOTE}>
                  <ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span className="truncate">Research use only</span>
                  <span className="sr-only">. {STUDY_NOTE}</span>
                </div>
              )}
            </div>
            {staff ? <GlobalSearch /> : <div className="flex-1" />}
            <div className="ml-auto flex shrink-0 items-center justify-end gap-2.5 lg:min-w-[220px]">
              <Link to="/app/help" className={bandButton} aria-label="Help Center">
                <CircleHelp className="h-[19px] w-[19px]" />
              </Link>
              <NotificationBell />
              <UserMenu user={user} onSignOut={doSignOut} />
            </div>
          </header>
          <main className="app-main relative mt-[30px]">
            <Outlet />
          </main>
        </div>
      </div>
      {(tourOpen || !user.tour_completed) && <Tour key={tourOpen || 'first'} kind={typeof tourOpen === 'string' ? tourOpen : 'full'} />}
    </div>
  )
}
