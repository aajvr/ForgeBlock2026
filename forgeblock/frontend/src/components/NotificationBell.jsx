import { Bell, BellOff, Briefcase, CheckCheck, FileSignature, FolderInput, Gavel, Info, ScanSearch, UserCog } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../auth'
import { bandButton } from './ui'

const POLL_MS = 30000
const PAGE = 15

const TYPES = {
  case_opened: { Icon: Briefcase, tone: 'bg-warn-50 text-warn-700' },
  decision: { Icon: Gavel, tone: 'bg-ok-50 text-ok-700' },
  screening: { Icon: ScanSearch, tone: 'bg-brand-50 text-brand-700' },
  enrollment: { Icon: FileSignature, tone: 'bg-violet-50 text-violet-700' },
  client_moved: { Icon: FolderInput, tone: 'bg-cyan-50 text-cyan-800' },
  role: { Icon: UserCog, tone: 'bg-indigo-50 text-indigo-700' },
  info: { Icon: Info, tone: 'bg-slate-100 text-slate-600' },
}

const asDate = (d) => new Date(d.endsWith?.('Z') ? d : `${d}Z`)
function relativeTime(d) {
  const s = Math.max(0, (Date.now() - asDate(d).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} d ago`
  return asDate(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// A client may only land on their portal or their own limited record view.
const CLIENT_SAFE = /^\/app\/(me|records\/\d+|profile|help)(\/|$|\?)/
const safeLink = (link, role) => {
  if (!link) return null
  if (role === 'client' && !CLIENT_SAFE.test(link)) return '/app/me'
  return link
}

// The bell in the top bar, for every role: unread badge, list, mark read.
export default function NotificationBell() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [data, setData] = useState({ unread: 0, items: [], has_more: false })
  const [open, setOpen] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const ref = useRef(null)

  const load = useCallback(() => {
    api.get(`/api/notifications?limit=${PAGE}`).then(setData).catch(() => {})
  }, [])

  // Poll every 30 s, and again when the window regains focus.
  useEffect(() => {
    load()
    const t = setInterval(() => document.visibilityState === 'visible' && load(), POLL_MS)
    const onFocus = () => load()
    window.addEventListener('focus', onFocus)
    return () => {
      clearInterval(t)
      window.removeEventListener('focus', onFocus)
    }
  }, [load])

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

  const toggle = () => {
    if (!open) load()
    setOpen((o) => !o)
  }

  const markAll = async () => {
    setData((d) => ({ ...d, unread: 0, items: d.items.map((n) => ({ ...n, read: true })) }))
    await api.post('/api/notifications/read-all').catch(load)
  }

  const openItem = async (n) => {
    setOpen(false)
    if (!n.read) {
      setData((d) => ({ ...d, unread: Math.max(0, d.unread - 1), items: d.items.map((x) => (x.id === n.id ? { ...x, read: true } : x)) }))
      api.post(`/api/notifications/${n.id}/read`).catch(() => {})
    }
    const to = safeLink(n.link, user.role)
    if (to) navigate(to)
  }

  const more = async () => {
    const last = data.items.at(-1)
    if (!last) return
    setLoadingMore(true)
    try {
      const page = await api.get(`/api/notifications?limit=${PAGE}&before=${last.id}`)
      setData((d) => ({ unread: page.unread, items: [...d.items, ...page.items], has_more: page.has_more }))
    } finally {
      setLoadingMore(false)
    }
  }

  const badge = data.unread > 99 ? '99+' : data.unread
  return (
    <div ref={ref} className="relative">
      <button
        onClick={toggle}
        className={bandButton}
        aria-label={data.unread ? `Notifications, ${data.unread} unread` : 'Notifications'}
        aria-expanded={open}
        aria-haspopup="dialog"
        data-tour="notifications"
      >
        <Bell className="h-[19px] w-[19px]" />
        {data.unread > 0 && (
          <span className="absolute -right-1.5 -top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-bad-500 px-1 text-[10.5px] font-semibold text-white ring-2 ring-[var(--role-top)]">
            {badge}
          </span>
        )}
      </button>
      {open && (
        <div role="dialog" aria-label="Notifications" className="absolute right-0 top-12 z-40 w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-[16px] border border-line bg-white text-ink shadow-xl">
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
            <div className="text-sm font-semibold text-slate-900">Notifications</div>
            {data.unread > 0 && (
              <button onClick={markAll} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50">
                <CheckCheck className="h-3.5 w-3.5" /> Mark all as read
              </button>
            )}
          </div>
          {data.items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-sm text-slate-500">
              <BellOff className="h-6 w-6 text-slate-300" />
              You're all caught up.
            </div>
          ) : (
            <ul className="max-h-[26rem] overflow-y-auto py-1">
              {data.items.map((n) => {
                const t = TYPES[n.type] || TYPES.info
                return (
                  <li key={n.id}>
                    <button onClick={() => openItem(n)} className={`flex w-full items-start gap-3 px-4 py-2.5 text-left transition-colors hover:bg-[#f7fafd] ${n.read ? '' : 'bg-brand-50/50'}`}>
                      <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${t.tone}`}><t.Icon className="h-4 w-4" /></span>
                      <span className="min-w-0 flex-1">
                        <span className={`block truncate text-sm ${n.read ? 'text-slate-700' : 'font-semibold text-slate-900'}`}>{n.title || n.text}</span>
                        {n.body && <span className="block truncate text-xs text-slate-500">{n.body}</span>}
                        <span className="mt-0.5 block text-[11.5px] text-slate-400">{relativeTime(n.created_at)}</span>
                      </span>
                      {!n.read && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-brand-600" aria-label="Unread" />}
                    </button>
                  </li>
                )
              })}
              {data.has_more && (
                <li className="px-4 py-2">
                  <button onClick={more} disabled={loadingMore} className="w-full rounded-md py-1.5 text-xs font-medium text-brand-700 hover:bg-brand-50 disabled:opacity-60">
                    {loadingMore ? 'Loading…' : 'Show older'}
                  </button>
                </li>
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
