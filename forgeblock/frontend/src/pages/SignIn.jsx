import { ArrowLeft, Briefcase, CheckCircle2, KeyRound, Link2, Lock, ShieldAlert, ShieldCheck, ShieldHalf, Users } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { startClerkSignIn } from '../clerk'
import { useAuth } from '../auth'
import Brand from '../components/Brand'
import DriftingLines from '../components/DriftingLines'
import SignatureTrace from '../components/SignatureTrace'
import useOnScreen from '../components/useOnScreen'
import { Alert, Button, Field, Input, ScreeningBadge, ScreeningNotice, fmtDate } from '../components/ui'

export function homeFor(user) {
  if (user.must_change_password) return '/change-password'
  if (user.study_mode && !user.research_use_accepted) return '/research-use'
  if (user.role === 'admin') return '/app/admin'
  if (user.role === 'client') return '/app/me'
  return '/app/home'
}

export function ReceiptCheck({ compact }) {
  const [code, setCode] = useState('')
  const [res, setRes] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const check = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    setRes(null)
    try {
      setRes(await api.get(`/api/receipts/${encodeURIComponent(code.trim())}`))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div>
      <form onSubmit={check} className="flex gap-2">
        <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="FB-XXXX-XXXX" className="font-mono" required />
        <Button variant={compact ? 'secondary' : 'primary'} loading={busy}>Check</Button>
      </form>
      <Alert className="mt-3">{error}</Alert>
      {res && (
        <div className={`mt-3 rounded-lg border p-4 text-sm ${res.intact ? 'border-ok-100 bg-ok-50' : 'border-bad-100 bg-bad-50'}`}>
          <div className={`flex items-center gap-2 font-semibold ${res.intact ? 'text-ok-700' : 'text-bad-700'}`}>
            {res.intact ? <ShieldCheck className="h-4 w-4" /> : <ShieldAlert className="h-4 w-4" />}
            {res.intact ? 'Record is unchanged since it was sealed' : 'This record was changed after it was sealed'}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-y-1 text-slate-700">
            <span className="text-slate-500">Record</span>
            <span>{res.kind}, {res.modality}</span>
            <span className="text-slate-500">Screening result</span>
            <span><ScreeningBadge value={res.screening_result} /></span>
            <span className="text-slate-500">Date</span>
            <span>{fmtDate(res.created_at)}</span>
            <span className="text-slate-500">Ledger block</span>
            <span>#{res.block_index}</span>
          </div>
        </div>
      )}
    </div>
  )
}

function MicrosoftLogo() {
  return (
    <svg viewBox="0 0 21 21" className="h-5 w-5" aria-hidden="true">
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  )
}

function GoogleLogo() {
  return (
    <svg viewBox="0 0 48 48" className="h-5 w-5" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  )
}

const ROLE_HINTS = [
  { icon: Briefcase, role: 'Examiners', tile: 'bg-brand-100 text-brand-700', text: 'Use the email your administrator registered. You will land on My work.' },
  { icon: Users, role: 'Clients', tile: 'bg-cyan-100 text-cyan-800', text: 'Use the email your examiner’s office gave you to see your signatures on file.' },
  { icon: ShieldHalf, role: 'Administrators', tile: 'bg-indigo-100 text-indigo-800', text: 'Only approved administrator emails can open the admin workspace.' },
]

const glass = 'rounded-2xl border border-white/25 bg-white/10 shadow-xl shadow-black/10 backdrop-blur-md'

// Three floating cards that hint at what ForgeBlock does. Sample values only.
function FloatingCards() {
  return (
    <div className="relative h-52 w-full max-w-lg [@media(max-height:820px)]:hidden" aria-hidden="true">
      <div className="bob absolute left-0 top-4" style={{ '--delay': '-1.5s' }}>
        <div className={`${glass} -rotate-6 p-2.5`}>
          <div className="w-40 rounded-lg bg-white p-3 text-slate-400 shadow-sm">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Withdrawal slip</div>
            <div className="mt-2 space-y-1.5">
              <div className="h-1 w-full rounded bg-slate-200" />
              <div className="h-1 w-4/5 rounded bg-slate-200" />
              <div className="h-1 w-3/5 rounded bg-slate-200" />
            </div>
            <svg viewBox="0 0 100 30" className="mt-2 h-7 w-full" fill="none" stroke="#1e40af" strokeWidth="1.8" strokeLinecap="round">
              <path d="M4 22 C 12 4, 20 30, 30 14 S 44 6, 50 20 S 64 28, 72 12 C 78 4, 84 22, 96 16" />
            </svg>
            <div className="border-t border-slate-300 pt-0.5 text-[9px]">Signature</div>
          </div>
        </div>
      </div>
      <div className="bob absolute right-0 top-0 w-56" style={{ '--delay': '-4s' }}>
        <div className={`${glass} p-4`}>
          <div className="text-[11px] uppercase tracking-wider text-white/70">Screening result</div>
          <div className="mt-1 flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5 font-semibold text-emerald-300"><CheckCircle2 className="h-5 w-5" /> Consistent</span>
            <span className="text-2xl font-semibold tabular-nums">82%</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/20"><div className="h-full w-[82%] rounded-full bg-emerald-300" /></div>
        </div>
      </div>
      <div className="bob absolute bottom-3 left-[38%]" style={{ '--delay': '-2.6s' }}>
        <div className={`${glass} flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium`}>
          <Link2 className="h-4 w-4 text-white/80" /> Block #1249 sealed <CheckCircle2 className="h-4 w-4 text-emerald-300" />
        </div>
      </div>
    </div>
  )
}

export default function SignIn() {
  const { user, signIn, notice } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [providers, setProviders] = useState(null)
  const [oauthBusy, setOauthBusy] = useState('')
  const panel = useRef(null)
  const panelOnScreen = useOnScreen(panel)

  useEffect(() => {
    api.get('/api/auth/providers').then(setProviders).catch(() => setProviders(null))
  }, [])

  if (user) return <Navigate to={homeFor(user)} replace />

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const u = await signIn(email, password)
      navigate(homeFor(u))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }
  const oauth = providers?.enabled ? providers.providers : []
  const withProvider = async (p) => {
    setError('')
    setOauthBusy(p)
    try {
      await startClerkSignIn(providers, p) // leaves the page on success
    } catch (err) {
      setError(err?.errors?.[0]?.longMessage || err.message || 'Could not start the sign-in. Please try again.')
      setOauthBusy('')
    }
  }
  const oauthBtn = 'flex w-full items-center justify-center gap-3 rounded-xl border border-slate-300 bg-white px-4 py-2.5 font-medium text-slate-800 shadow-sm transition hover:-translate-y-px hover:border-brand-300 hover:bg-brand-50/50 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 active:translate-y-0 disabled:translate-y-0 disabled:opacity-60 disabled:shadow-sm'

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <div ref={panel} className={`sidebar-bg relative hidden flex-col justify-between gap-8 overflow-hidden p-12 text-white lg:flex ${panelOnScreen ? '' : 'motion-paused'}`}>
        <DriftingLines />
        <Link to="/" className="relative w-fit">
          <Brand light />
        </Link>
        <div className="relative space-y-8">
          <FloatingCards />
          <div className="max-w-lg">
            <SignatureTrace className="w-full max-w-sm text-white" strokeWidth={1.8} duration={3} />
            <h1 className="mt-6 text-4xl font-semibold leading-tight tracking-[-0.01em]">Screen signatures. Seal every decision.</h1>
            <p className="mt-4 text-lg text-white/80">
              Compare a questioned signature with the client’s signatures on file, let the examiner decide, and keep a tamper-evident record of both.
            </p>
          </div>
        </div>
        <div className="relative space-y-2 text-sm text-white/75">
          <ScreeningNotice />
          {providers?.study_mode && <p>A research prototype of De La Salle University–Dasmariñas, for the approved activities of the ForgeBlock study only. Not for actual legal, financial or official documents.</p>}
        </div>
      </div>

      <div className="relative flex flex-col justify-center overflow-hidden bg-gradient-to-br from-brand-50 via-slate-50 to-cyan-50 px-6 py-12 sm:px-12">
        <div className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-brand-200/40 blur-3xl" aria-hidden="true" />
        <div className="relative mx-auto w-full max-w-md">
          <Link to="/" className="mb-6 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
            <ArrowLeft className="h-4 w-4" /> Back to home
          </Link>
          <div className="mb-8 lg:hidden">
            <Brand variant="gradient" />
          </div>
          <div className="relative overflow-hidden rounded-3xl border border-slate-200/70 bg-white p-8 shadow-lift">
            <span className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-brand-600 via-brand-400 to-cyan-500" aria-hidden="true" />
            <h2 className="text-2xl font-semibold tracking-tight">Sign in to ForgeBlock</h2>
            <p className="mt-1 text-sm text-slate-500">One sign-in for everyone. ForgeBlock opens the workspace for your role.</p>
            {notice && <Alert kind="warn" className="mt-4">{notice}</Alert>}
            {oauth.length > 0 && (
              <div className="mt-6 space-y-3">
                {oauth.includes('microsoft') && (
                  <button type="button" disabled={!!oauthBusy} onClick={() => withProvider('microsoft')} className={oauthBtn}>
                    <MicrosoftLogo /> {oauthBusy === 'microsoft' ? 'Opening Microsoft…' : 'Sign in with Microsoft'}
                  </button>
                )}
                {oauth.includes('google') && (
                  <button type="button" disabled={!!oauthBusy} onClick={() => withProvider('google')} className={oauthBtn}>
                    <GoogleLogo /> {oauthBusy === 'google' ? 'Opening Google…' : 'Sign in with Google'}
                  </button>
                )}
                <div className="flex items-center gap-3 py-1 text-xs uppercase tracking-wide text-slate-400">
                  <span className="h-px flex-1 bg-slate-200" /> or with email <span className="h-px flex-1 bg-slate-200" />
                </div>
              </div>
            )}
            <form onSubmit={submit} className={`${oauth.length ? 'mt-3' : 'mt-6'} space-y-4`}>
              <Field label="Email">
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
              </Field>
              <Field label="Password">
                <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
              </Field>
              <Alert>{error}</Alert>
              <Button className="w-full" loading={busy}>
                <KeyRound className="h-4 w-4" /> Sign in
              </Button>
            </form>
            <p className="mt-4 flex items-start gap-1.5 text-xs text-slate-500">
              <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" /> No account? Accounts are created by your administrator. There is no public sign-up.
            </p>
          </div>

          <div className="mt-6 rounded-2xl border border-white bg-white/55 p-5 backdrop-blur">
            <h3 className="text-sm font-semibold">Which email do I use?</h3>
            <ul className="mt-3 space-y-3">
              {ROLE_HINTS.map((r) => (
                <li key={r.role} className="flex gap-3 text-sm">
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${r.tile}`}><r.icon className="h-4 w-4" /></span>
                  <p className="text-slate-600">
                    <span className="font-medium text-slate-800">{r.role}.</span> {r.text}
                  </p>
                </li>
              ))}
            </ul>
          </div>
          <div className="mt-6 space-y-2 text-sm text-slate-500 lg:hidden">
            <ScreeningNotice />
            {providers?.study_mode && <p>A research prototype of De La Salle University–Dasmariñas, for the approved activities of the ForgeBlock study only. Not for actual legal, financial or official documents.</p>}
          </div>
        </div>
      </div>
    </div>
  )
}
