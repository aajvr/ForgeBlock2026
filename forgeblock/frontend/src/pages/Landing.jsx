import {
  ArrowDown,
  ArrowRight,
  Briefcase,
  CheckCircle2,
  ClipboardList,
  EyeOff,
  Fingerprint,
  Gauge,
  Home,
  KeyRound,
  LayoutDashboard,
  Link2,
  Lock,
  PenTool,
  Play,
  ScanLine,
  ScanSearch,
  ShieldCheck,
  ShieldHalf,
  Upload,
  UserCheck,
  UserPlus,
  Users,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../auth'
import Brand, { BrandMark } from '../components/Brand'
import SignatureTrace from '../components/SignatureTrace'
import { SIGNATURE_PATHS } from '../components/signaturePaths'
import useOnScreen from '../components/useOnScreen'
import { ScreeningNotice } from '../components/ui'
import { homeFor, ReceiptCheck } from './SignIn'

const DEMO_VIDEO = `${import.meta.env.BASE_URL}forgeblock-demo.mp4`

const STEPS = [
  { icon: Upload, title: 'Enroll references', text: 'An examiner keeps 5 to 20 genuine signatures of each client on file.' },
  { icon: ScanSearch, title: 'Screen the questioned signature', text: 'ForgeBlock gives Consistent, Inconclusive or Inconsistent, with a confidence score.' },
  { icon: UserCheck, title: 'The examiner decides', text: 'Anything not clearly Consistent opens a case for a Genuine or Forged finding.' },
  { icon: Link2, title: 'Every result is sealed', text: 'Screenings and findings are sealed in a hash-linked ledger.' },
]

const ROLES = [
  {
    key: 'examiner',
    icon: Briefcase,
    title: 'Examiner',
    tile: 'bg-brand-100 text-brand-700',
    dot: 'bg-brand-600',
    accent: 'border-t-brand-600',
    bullets: ['Register clients and enroll their references', 'Screen questioned signatures', 'Give the final finding on each case'],
  },
  {
    key: 'admin',
    icon: ShieldHalf,
    title: 'Administrator',
    tile: 'bg-indigo-100 text-indigo-800',
    dot: 'bg-indigo-800',
    accent: 'border-t-indigo-800',
    bullets: ['Create accounts and group folders', 'Set the policy and data retention', 'Watch over the ledger and the system'],
  },
  {
    key: 'client',
    icon: Users,
    title: 'Client',
    tile: 'bg-cyan-100 text-cyan-800',
    dot: 'bg-cyan-700',
    accent: 'border-t-cyan-700',
    bullets: ['See the signatures kept on file for you', 'Follow every screening in your name', 'See the examiner’s decision and receipt code'],
  },
]

const ACCOUNT_STEPS = [
  { icon: UserPlus, title: 'Your administrator registers you', text: 'They add your email and choose your role.' },
  { icon: KeyRound, title: 'You get your sign-in', text: 'Use Microsoft, Google or your email and a temporary password.' },
  { icon: LayoutDashboard, title: 'You sign in and land in your workspace', text: 'A short guided tour shows you the main buttons.' },
]

const PRIVACY = [
  { icon: EyeOff, title: 'View only', text: 'Signature images cannot be downloaded or exported. They are shown inside ForgeBlock only.' },
  { icon: Fingerprint, title: 'Your records only', text: 'Each person sees only their own clients, cases and screenings.' },
  { icon: Lock, title: 'Protected sign-in', text: 'Invite-only accounts, Microsoft or Google sign-in, lockout after wrong passwords and automatic sign-out.' },
  { icon: ShieldCheck, title: 'Tamper evident', text: 'The ledger is checked every day. Any change to a sealed record breaks the chain and shows.' },
]

const SECTIONS = [
  ['#how', 'How it works'],
  ['#who', 'Who uses it'],
  ['#access', 'Getting an account'],
  ['#privacy', 'Privacy'],
]

// Illustrative values, not real records.
const CHAIN = [
  { index: 1247, kind: 'Screening', hash: '3f9a…b71c', previous: '09de…e24f' },
  { index: 1248, kind: 'Decision', hash: '7a10…c5b3', previous: '3f9a…b71c' },
  { index: 1249, kind: 'Screening', hash: '58e2…a0f7', previous: '7a10…c5b3' },
]

// Free pen flourishes that join the written "ForgeBlock" strokes in the hero background.
const FLOURISHES = [
  { d: 'M-40 210 C 90 120, 170 300, 300 190 S 460 90, 560 180 S 700 260, 820 150', width: 2, opacity: 0.2, delay: 0.2, dur: 5 },
  { d: 'M930 120 C 1010 40, 1080 190, 1160 110 S 1300 40, 1500 130', width: 1.6, opacity: 0.16, delay: 1.2, dur: 4.4 },
  { d: 'M-30 640 C 120 560, 240 700, 380 610 S 540 520, 620 610 C 660 660, 590 700, 560 650 S 690 530, 860 600', width: 1.8, opacity: 0.16, delay: 0.8, dur: 5.4 },
  { d: 'M1010 690 C 1090 610, 1170 720, 1250 640 S 1390 590, 1500 660', width: 1.5, opacity: 0.14, delay: 1.8, dur: 4 },
]

// Faint hand-written strokes behind the hero that draw themselves in and slowly drift.
function HeroStrokes({ color = '#fff', words = true }) {
  const written = (x, y, scale, opacity, delay) => (
    <g transform={`translate(${x} ${y}) scale(${scale}) skewX(-6)`} strokeWidth={1.7 / scale + 0.45} opacity={opacity}>
      {SIGNATURE_PATHS.map((p, i) => (
        <path key={i} d={p.d} pathLength="1" style={{ '--len': 1, '--dur': '1.1s', '--delay': `${delay + i * 0.32}s` }} />
      ))}
    </g>
  )
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <svg viewBox="0 0 1440 800" preserveAspectRatio="xMidYMid slice" className="hero-strokes trace absolute -inset-[4%] h-[108%] w-[108%]" fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round">
        {words && written(50, 330, 2.5, 0.13, 0.4)}
        {words && written(1030, 300, 2.3, 0.11, 1.4)}
        {FLOURISHES.map((f) => (
          <path key={f.d} d={f.d} pathLength="1" strokeWidth={f.width} opacity={f.opacity} style={{ '--len': 1, '--dur': `${f.dur}s`, '--delay': `${f.delay}s` }} />
        ))}
      </svg>
    </div>
  )
}

function RevealOnScroll({ as = 'div', delay = 0, className = '', children }) {
  const Tag = as
  const ref = useRef(null)
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    if (!('IntersectionObserver' in window)) {
      setSeen(true)
      return
    }
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) {
        setSeen(true)
        io.disconnect()
      }
    }, { threshold: 0.12 })
    io.observe(ref.current)
    return () => io.disconnect()
  }, [])
  return <Tag ref={ref} className={`reveal ${seen ? 'is-visible' : ''} ${className}`} style={{ '--delay': `${delay}s` }}>{children}</Tag>
}

function SectionTitle({ eyebrow, title, text }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <div className="text-sm font-semibold uppercase tracking-[0.14em] text-brand-600">{eyebrow}</div>
      <h2 className="mt-2 text-3xl font-semibold tracking-[-0.01em] sm:text-4xl">{title}</h2>
      {text && <p className="mt-3 text-slate-600">{text}</p>}
    </div>
  )
}

// The hero's looping scene: a slip is signed, scanned, screened and sealed. Sample values only.
function ScreeningScene() {
  const box = useRef(null)
  const onScreen = useOnScreen(box)
  return (
    <div ref={box} className={`relative mx-auto h-[27rem] w-full max-w-[31rem] ${onScreen ? '' : 'motion-paused'}`} role="img" aria-label="A signed withdrawal slip is scanned, screened as Consistent with an 82% confidence score, and sealed in ledger block #1249">
      <div className="scene absolute inset-0" aria-hidden="true">
        <div className="absolute left-0 top-2 w-[15.5rem] -rotate-3">
          <div className="scene-doc relative h-[15rem] overflow-hidden rounded-lg border border-slate-200 bg-white p-4 shadow-lift">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Withdrawal slip</span>
              <span className="font-mono text-[10px] text-slate-400">No. 0042</span>
            </div>
            {['Account name', 'Account no.', 'Amount'].map((f) => (
              <div key={f} className="mt-3">
                <div className="text-[9px] uppercase tracking-wide text-slate-400">{f}</div>
                <div className="mt-1 h-1.5 w-full rounded bg-slate-100" />
              </div>
            ))}
            <div className="relative mt-4 h-12 overflow-hidden">
              <svg viewBox="0 0 160 40" className="absolute inset-0 h-full w-full" fill="none" stroke="#1e3a8a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 30 C 14 8, 22 40, 30 20 S 42 6, 48 24 S 58 34, 64 18 C 70 6, 76 30, 84 22 S 98 14, 108 26 C 118 36, 130 10, 152 16" />
              </svg>
              <div className="scene-ink-cover absolute inset-0 bg-white" />
            </div>
            <div className="border-t border-slate-300 pt-1 text-[9px] text-slate-400">Signature over printed name</div>
            <div className="scene-scan pointer-events-none absolute inset-x-0 top-0 h-10 bg-gradient-to-b from-transparent via-brand-400/25 to-transparent">
              <div className="absolute inset-x-0 top-1/2 h-0.5 bg-brand-500 shadow-[0_0_12px_rgb(15_108_189/0.7)]" />
            </div>
          </div>
        </div>
        <div className="scene-card absolute right-0 top-[7.5rem] w-[19.5rem] rounded-2xl border border-slate-200 bg-white p-5 shadow-xl shadow-brand-900/10">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Static screening · CL-0042</span>
            <span className="font-mono">FB-7KQ2-M9TX</span>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-ok-50 text-ok-600"><CheckCircle2 className="h-6 w-6" /></span>
            <div>
              <div className="text-lg font-semibold text-ok-700">Consistent</div>
              <div className="text-xs text-slate-500">Matches the client’s signatures on file</div>
            </div>
          </div>
          <div className="mt-4 flex justify-between text-sm">
            <span className="text-slate-600">Confidence score</span>
            <span className="scene-num font-semibold tabular-nums">82%</span>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100">
            <div className="scene-bar h-full w-full rounded-full bg-ok-600" />
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
            {['Cosine', 'Euclidean', 'Manhattan'].map((m, i) => (
              <div key={m} className="scene-pass rounded-lg bg-slate-50 px-2 py-2" style={{ '--delay': `${i * 0.36}s` }}>
                <div className="text-slate-500">{m}</div>
                <div className="mt-0.5 font-medium text-ok-700">Pass</div>
              </div>
            ))}
          </div>
        </div>
        <div className="scene-seal absolute bottom-0 right-6 flex items-center gap-2 rounded-xl border border-brand-100 bg-brand-50 px-3.5 py-2.5 text-sm font-medium text-brand-800 shadow-soft">
          <Link2 className="h-4 w-4" /> Sealed in ledger block #1249
          <CheckCircle2 className="scene-check h-4 w-4 text-ok-600" />
        </div>
      </div>
    </div>
  )
}

// A still preview of the workspace. All of it is made-up sample data.
function WorkspacePreview() {
  const nav = [
    { icon: Home, label: 'My work', on: true },
    { icon: Briefcase, label: 'Cases' },
    { icon: Users, label: 'Clients' },
    { icon: ScanSearch, label: 'Screen a signature' },
    { icon: ClipboardList, label: 'Records' },
  ]
  const stats = [
    { icon: Briefcase, label: 'Needs your decision', value: '3', tile: 'bg-warn-100 text-warn-700' },
    { icon: ScanSearch, label: 'Screenings this week', value: '18', tile: 'bg-brand-100 text-brand-700' },
    { icon: CheckCircle2, label: 'Decisions made', value: '42', tile: 'bg-ok-100 text-ok-700' },
  ]
  const latest = [
    ['FB-7KQ2-M9TX', 'CL-0042', 'Static', 'Consistent', 'bg-ok-50 text-ok-700', '82%'],
    ['FB-3HW8-C4LP', 'CL-0057', 'Dynamic', 'Inconsistent', 'bg-bad-50 text-bad-700', '64%'],
    ['FB-9TR5-K2DN', 'PR-0013', 'Static', 'Inconclusive', 'bg-warn-50 text-warn-700', '12%'],
    ['FB-6BX1-V7QS', 'CL-0031', 'Dynamic', 'Consistent', 'bg-ok-50 text-ok-700', '91%'],
    ['FB-2MJ4-Y8GF', 'CL-0019', 'Static', 'Consistent', 'bg-ok-50 text-ok-700', '76%'],
  ]
  const cases = [['CL', 'CL-0042', 'Inconclusive', 'bg-warn-50 text-warn-700'], ['CL', 'CL-0057', 'Inconsistent', 'bg-bad-50 text-bad-700'], ['PR', 'PR-0013', 'Inconclusive', 'bg-warn-50 text-warn-700']]
  return (
    <div className="sidebar-examiner flex aspect-[4/3] w-full text-left sm:aspect-[16/9]" role="img" aria-label="Preview of the ForgeBlock examiner workspace">
      <div className="hidden w-[21%] shrink-0 flex-col py-4 pl-3 text-white sm:flex">
        <div className="mb-4 flex items-center gap-1.5 text-[13px] font-semibold"><BrandMark light className="h-5 w-5" /> ForgeBlock</div>
        {nav.map((n) => (
          <div key={n.label} className={`mb-0.5 flex items-center gap-1.5 rounded-l-lg px-2 py-1.5 text-[11px] ${n.on ? 'bg-white font-semibold text-brand-700' : 'text-white/85'}`}>
            <n.icon className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{n.label}</span>
          </div>
        ))}
      </div>
      <div className="min-w-0 flex-1 overflow-hidden bg-white p-3 text-slate-900 sm:my-2 sm:mr-2 sm:rounded-2xl sm:p-5">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-brand-600">Examiner</div>
        <div className="text-base font-semibold tracking-[-0.01em] sm:text-xl">My work</div>
        <div className="mt-2 grid grid-cols-3 gap-2 sm:mt-3 sm:gap-3">
          {stats.map((s) => (
            <div key={s.label} className="rounded-xl border border-slate-100 p-2 shadow-soft sm:p-3">
              <div className="flex items-start justify-between gap-1">
                <span className="text-[10px] leading-tight text-slate-500 sm:text-[11px]">{s.label}</span>
                <span className={`hidden h-6 w-6 shrink-0 items-center justify-center rounded-md sm:flex ${s.tile}`}><s.icon className="h-3.5 w-3.5" /></span>
              </div>
              <div className="mt-1 text-lg font-semibold tabular-nums sm:text-2xl">{s.value}</div>
            </div>
          ))}
        </div>
        <div className="mt-2 grid gap-2 sm:mt-3 sm:grid-cols-[1fr_1.2fr] sm:gap-3">
          <div className="rounded-xl border border-ok-100 bg-gradient-to-br from-ok-100/80 via-ok-50 to-white p-3">
            <div className="text-[10px] uppercase tracking-wider text-slate-500">Screening result</div>
            <div className="mt-0.5 flex items-center justify-between gap-2">
              <span className="flex items-center gap-1 text-sm font-semibold text-ok-600 sm:text-base"><CheckCircle2 className="h-4 w-4" /> Consistent</span>
              <span className="text-lg font-semibold tabular-nums sm:text-2xl">82%</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white"><div className="h-full w-[82%] rounded-full bg-ok-600" /></div>
            <div className="mt-1.5 font-mono text-[10px] text-slate-500">FB-7KQ2-M9TX</div>
          </div>
          <div className="hidden rounded-xl border border-slate-100 p-3 shadow-soft sm:block">
            <div className="text-[11px] font-semibold">Needs your decision</div>
            {cases.map(([initials, code, result, tone]) => (
              <div key={code} className="mt-1.5 flex items-center gap-2 text-[11px]">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-cyan-100 text-[9px] font-semibold text-cyan-800">{initials}</span>
                <span className="font-mono">{code}</span>
                <span className={`ml-auto rounded px-1.5 py-0.5 text-[10px] font-medium ${tone}`}>{result}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-3 hidden rounded-xl border border-slate-100 p-3 shadow-soft sm:block">
          <div className="text-[11px] font-semibold">Latest screenings</div>
          {latest.map(([receipt, client, module, result, tone, score]) => (
            <div key={receipt} className="mt-1.5 grid grid-cols-[1.2fr_1fr_1fr_1.1fr_auto] items-center gap-2 border-t border-slate-50 pt-1.5 text-[11px]">
              <span className="font-mono text-brand-700">{receipt}</span>
              <span className="font-mono">{client}</span>
              <span className="text-slate-500">{module}</span>
              <span className={`w-fit rounded px-1.5 py-0.5 text-[10px] font-medium ${tone}`}>{result}</span>
              <span className="font-medium tabular-nums">{score}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// The large browser-style window in the hero. The play button appears once the
// demo video file exists; until then the still preview stays on its own.
function ProductWindow() {
  const [hasVideo, setHasVideo] = useState(false)
  const [playing, setPlaying] = useState(false)
  useEffect(() => {
    let live = true
    // The dev server and many hosts answer unknown paths with the app's HTML, so check the type.
    fetch(DEMO_VIDEO, { method: 'HEAD' })
      .then((res) => live && setHasVideo(res.ok && (res.headers.get('content-type') || '').startsWith('video/')))
      .catch(() => {})
    return () => { live = false }
  }, [])
  const stopVideo = () => {
    setPlaying(false)
    setHasVideo(false)
  }
  return (
    <div className="hero-window relative mx-auto mt-12 max-w-5xl">
      <div className="pointer-events-none absolute -inset-6 rounded-[3rem] bg-brand-300/40 blur-3xl" aria-hidden="true" />
      <div className="relative overflow-hidden rounded-2xl border border-white/40 bg-white shadow-2xl sm:rounded-3xl">
        <div className="flex h-9 items-center gap-1.5 border-b border-slate-100 bg-slate-50 px-4" aria-hidden="true">
          <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
          <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
          <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
          <span className="mx-auto rounded-md bg-white px-6 py-0.5 text-xs text-slate-500 ring-1 ring-slate-200">ForgeBlock workspace</span>
        </div>
        {playing ? (
          <video src={DEMO_VIDEO} className="aspect-[4/3] w-full bg-slate-950 sm:aspect-[16/9]" controls autoPlay playsInline controlsList="nodownload" onError={stopVideo}>
            A short demo of ForgeBlock.
          </video>
        ) : (
          <div className="relative">
            <WorkspacePreview />
            {hasVideo && (
              <button
                onClick={() => setPlaying(true)}
                aria-label="Play the ForgeBlock demo video"
                className="play-pulse absolute left-1/2 top-1/2 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white text-brand-600 shadow-xl transition hover:scale-110 focus-visible:scale-110 sm:h-20 sm:w-20"
              >
                <Play className="relative ml-1 h-7 w-7 fill-current sm:h-9 sm:w-9" />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function ChainBlock({ block }) {
  return (
    <div className="grid h-36 min-w-0 flex-1 grid-rows-3 rounded-2xl border border-white/25 bg-white/10 px-4 text-white backdrop-blur">
      <div className="flex items-center justify-between gap-2 text-xs text-white/75">
        <span className="font-semibold text-white">Block #{block.index}</span>
        <span>{block.kind}</span>
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-white/15 text-xs">
        <span className="text-white/70">Hash</span>
        <span className="font-mono text-sm">{block.hash}</span>
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-white/15 text-xs">
        <span className="text-white/70">Previous</span>
        <span className="font-mono text-sm text-white/85">{block.previous}</span>
      </div>
    </div>
  )
}

// Joins one block's hash to the "previous hash" row of the next block, with a pulse travelling along it.
function ChainLink({ delay }) {
  const trace = (d, dash) => (
    <>
      <path d={d} stroke="#fff" strokeOpacity="0.4" strokeWidth="2" />
      <path d={d} stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeDasharray={dash} className="chain-pulse" style={{ '--delay': `${delay}s` }} />
    </>
  )
  return (
    <div className="shrink-0" aria-hidden="true">
      <svg viewBox="0 0 48 144" preserveAspectRatio="none" fill="none" className="hidden h-36 w-12 md:block">{trace('M0 72H24V120H48', '12 200')}</svg>
      <svg viewBox="0 0 12 36" fill="none" className="mx-auto h-9 w-3 md:hidden">{trace('M6 0V36', '10 200')}</svg>
    </div>
  )
}

function LedgerCard() {
  return (
    <div className="sidebar-bg mx-auto max-w-5xl rounded-3xl p-6 shadow-lift sm:p-8">
      <div className="mb-5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-white">
        <div className="text-lg font-semibold sm:text-xl">Every screening is sealed into a tamper-evident chain.</div>
        <div className="text-xs text-white/70">Example values</div>
      </div>
      <div className="flex flex-col md:flex-row">
        {CHAIN.map((b, i) => (
          <div key={b.index} className="contents">
            <ChainBlock block={b} />
            {i < CHAIN.length - 1 && <ChainLink delay={i * 1.8} />}
          </div>
        ))}
      </div>
    </div>
  )
}

function RoleMockup({ role }) {
  const body = {
    examiner: (
      <>
        <div className="text-[11px] font-semibold">Needs your decision</div>
        {[['CL-0042', 'Inconclusive', 'bg-warn-50 text-warn-700'], ['CL-0057', 'Inconsistent', 'bg-bad-50 text-bad-700'], ['PR-0013', 'Inconclusive', 'bg-warn-50 text-warn-700']].map(([code, result, tone]) => (
          <div key={code} className="mt-1.5 flex items-center justify-between gap-2 rounded-md bg-slate-50 px-2 py-1 text-[11px]">
            <span className="font-mono">{code}</span><span className={`rounded px-1.5 text-[10px] font-medium ${tone}`}>{result}</span>
          </div>
        ))}
      </>
    ),
    admin: (
      <>
        <div className="grid grid-cols-2 gap-1.5">
          {[['Clients', '128'], ['Ledger', 'Intact']].map(([k, v]) => (
            <div key={k} className="rounded-md bg-slate-50 px-2 py-1">
              <div className="text-[10px] text-slate-500">{k}</div>
              <div className="text-xs font-semibold">{v}</div>
            </div>
          ))}
        </div>
        <div className="mt-2 flex h-12 items-end gap-1">
          {[40, 65, 35, 80, 55, 95, 70, 50].map((h, i) => <span key={i} className="flex-1 rounded-t bg-indigo-300" style={{ height: `${h}%` }} />)}
        </div>
      </>
    ),
    client: (
      <>
        <div className="text-[11px] font-semibold">Screenings on your documents</div>
        <div className="mt-1.5 rounded-md bg-slate-50 px-2 py-1.5 text-[11px]">
          <div className="flex items-center justify-between gap-2"><span>Screening</span><span className="rounded bg-ok-50 px-1.5 text-[10px] font-medium text-ok-700">Consistent</span></div>
          <div className="mt-1 font-mono text-[10px] text-slate-500">FB-7KQ2-M9TX</div>
        </div>
        <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-slate-600">
          <ShieldCheck className="h-3.5 w-3.5 text-ok-600" /> Sealed in the ledger
        </div>
      </>
    ),
  }[role.key]
  const shade = { examiner: 'sidebar-examiner', admin: 'sidebar-admin', client: 'sidebar-client' }[role.key]
  return (
    <div className={`${shade} flex h-40 overflow-hidden rounded-xl pt-2 text-slate-900`} aria-hidden="true">
      <div className="flex w-9 shrink-0 flex-col items-center gap-2 pt-1 text-white/85">
        <BrandMark light className="h-4 w-4" />
        <Gauge className="h-3.5 w-3.5" />
        <Users className="h-3.5 w-3.5" />
        <Link2 className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0 flex-1 rounded-tl-xl bg-white p-3">{body}</div>
    </div>
  )
}

export default function Landing() {
  const { user } = useAuth()
  const [study, setStudy] = useState(false)
  useEffect(() => {
    api.get('/api/auth/providers').then((p) => setStudy(!!p.study_mode)).catch(() => {})
  }, [])
  if (user) return <Navigate to={homeFor(user)} replace />

  return (
    <div className="min-h-screen overflow-x-clip bg-white text-slate-900">
      <header className="sticky top-3 z-20 h-0 px-3 sm:px-5">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between rounded-2xl border border-white/60 bg-white/90 pl-4 pr-2 shadow-soft backdrop-blur">
          <Brand tagline={false} />
          <nav className="hidden items-center gap-7 text-sm text-slate-600 md:flex">
            {SECTIONS.map(([href, label]) => <a key={href} href={href} className="transition hover:text-slate-900">{label}</a>)}
          </nav>
          <Link to="/signin" className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700">
            Sign in <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-b from-brand-50 via-white to-white">
        <div className="pointer-events-none absolute inset-0" aria-hidden="true">
          <div className="blob absolute -left-24 -top-16 h-96 w-96 rounded-full bg-brand-200 opacity-60 blur-3xl" />
          <div className="blob absolute right-[-6rem] top-24 h-80 w-80 rounded-full bg-cyan-200 opacity-50 blur-3xl [animation-delay:-8s]" />
          <div className="blob absolute bottom-[-8rem] left-1/3 h-96 w-96 rounded-full bg-indigo-200 opacity-45 blur-3xl [animation-delay:-14s]" />
        </div>
        <HeroStrokes color="#0f6cbd" words={false} />
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-5 pb-20 pt-28 lg:grid-cols-[1.1fr_1fr] lg:pt-32">
          <div>
            <SignatureTrace className="w-full max-w-xl text-brand-800" strokeWidth={1.9} duration={3.6} />
            <h1 className="fade-up mt-4 text-4xl font-semibold leading-tight tracking-[-0.01em] sm:text-5xl" style={{ '--delay': '0.4s' }}>
              Screen signatures.
              <br />
              <span className="text-brand-600">Seal every decision.</span>
            </h1>
            <p className="fade-up mt-5 max-w-xl text-lg text-slate-600" style={{ '--delay': '0.6s' }}>
              ForgeBlock checks a questioned signature against the signatures a client keeps on file, from a scanned page or live on a tablet, and
              keeps a tamper-evident record of every screening and every examiner’s finding.
            </p>
            <div className="fade-up mt-8 flex flex-wrap gap-3" style={{ '--delay': '0.8s' }}>
              <Link to="/signin" className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-5 py-3 font-medium text-white shadow-sm transition hover:bg-brand-700 hover:shadow-md">
                Sign in <ArrowRight className="h-4 w-4" />
              </Link>
              <a href="#how" className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-5 py-3 font-medium text-slate-800 transition hover:bg-slate-50">
                How it works
              </a>
            </div>
          </div>
          <ScreeningScene />
        </div>
      </section>

      {/* Product window (it becomes part of the scroll story later). */}
      <section className="px-5 pb-6">
        <ProductWindow />
      </section>

      {/* Ledger */}
      <section className="px-5 pb-6 pt-16">
        <RevealOnScroll><LedgerCard /></RevealOnScroll>
      </section>

      {/* How it works */}
      <section id="how" className="mx-auto max-w-6xl scroll-mt-24 px-5 py-20">
        <SectionTitle eyebrow="How it works" title="From questioned signature to sealed finding" />
        <ol className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <RevealOnScroll as="li" key={s.title} delay={i * 0.14} className="relative">
              <div className="lift group h-full rounded-2xl border border-slate-200/70 bg-white p-6 shadow-soft hover:border-brand-200">
                <div className="flex items-start justify-between">
                  <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-50 text-brand-700 transition-colors group-hover:bg-brand-600 group-hover:text-white">
                    <s.icon className="h-6 w-6" />
                  </span>
                  <span className="text-5xl font-semibold leading-none tracking-[-0.01em] text-brand-100 transition-colors group-hover:text-brand-200">{i + 1}</span>
                </div>
                <h3 className="mt-5 text-lg font-semibold leading-snug">{s.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{s.text}</p>
              </div>
              {i < STEPS.length - 1 && (
                <span className="absolute -right-[1.15rem] top-1/2 z-10 hidden h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full border border-brand-100 bg-white text-brand-600 shadow-sm lg:flex" aria-hidden="true">
                  <ArrowRight className="h-4 w-4" />
                </span>
              )}
              {i < STEPS.length - 1 && (
                <span className="absolute -bottom-[1.15rem] left-1/2 z-10 flex h-7 w-7 -translate-x-1/2 items-center justify-center rounded-full border border-brand-100 bg-white text-brand-600 shadow-sm md:hidden" aria-hidden="true">
                  <ArrowDown className="h-4 w-4" />
                </span>
              )}
            </RevealOnScroll>
          ))}
        </ol>
        <div className="mt-6 grid gap-5 md:grid-cols-2">
          <div className="flex gap-4 rounded-2xl bg-slate-50 p-6">
            <ScanLine className="h-6 w-6 shrink-0 text-brand-600" />
            <div>
              <h3 className="font-semibold">Static module</h3>
              <p className="mt-1 text-sm text-slate-600">For signatures on paper. A scanned or photographed signature is compared by its shape with three similarity measures.</p>
            </div>
          </div>
          <div className="flex gap-4 rounded-2xl bg-slate-50 p-6">
            <PenTool className="h-6 w-6 shrink-0 text-brand-600" />
            <div>
              <h3 className="font-semibold">Dynamic module</h3>
              <p className="mt-1 text-sm text-slate-600">For signatures written live with a pen on a tablet. Speed, pressure and pen angle are compared, not only the shape.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Who uses it */}
      <section id="who" className="scroll-mt-20 bg-slate-50 py-20">
        <div className="mx-auto max-w-6xl px-5">
          <SectionTitle eyebrow="Who uses it" title="Three roles, each with its own workspace" />
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {ROLES.map((r, i) => (
              <RevealOnScroll key={r.key} delay={i * 0.12}>
                <div className={`lift h-full rounded-2xl border border-t-4 border-slate-200/70 bg-white p-5 shadow-soft ${r.accent}`}>
                  <RoleMockup role={r} />
                  <div className="mt-5 flex items-center gap-3">
                    <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${r.tile}`}><r.icon className="h-5 w-5" /></span>
                    <h3 className="text-lg font-semibold">{r.title}</h3>
                  </div>
                  <ul className="mt-4 space-y-2 text-sm text-slate-700">
                    {r.bullets.map((b) => (
                      <li key={b} className="flex gap-2.5">
                        <span className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${r.dot}`} /> {b}
                      </li>
                    ))}
                  </ul>
                </div>
              </RevealOnScroll>
            ))}
          </div>
        </div>
      </section>

      {/* Getting an account */}
      <section id="access" className="mx-auto max-w-6xl scroll-mt-24 px-5 py-20">
        <SectionTitle eyebrow="Getting an account" title="Accounts are created by your administrator" text="There is no public sign-up. This keeps signature records limited to the people who need them." />
        <ol className="mt-12 grid gap-6 md:grid-cols-3">
          {ACCOUNT_STEPS.map((s, i) => (
            <RevealOnScroll as="li" key={s.title} delay={i * 0.12} className="text-center">
              <span className="relative mx-auto flex h-24 w-24 items-center justify-center rounded-3xl bg-gradient-to-br from-brand-50 to-brand-100 text-brand-700 shadow-soft">
                <s.icon className="h-11 w-11" strokeWidth={1.6} />
                <span className="absolute -right-2 -top-2 flex h-9 w-9 items-center justify-center rounded-full bg-brand-600 text-lg font-semibold text-white shadow-md ring-4 ring-white">{i + 1}</span>
              </span>
              <h3 className="mt-5 text-xl font-semibold leading-snug">{s.title}</h3>
              <p className="mt-1.5 text-sm text-slate-600">{s.text}</p>
            </RevealOnScroll>
          ))}
        </ol>
        <div className="mx-auto mt-16 max-w-2xl rounded-3xl border border-slate-200/70 bg-white p-7 shadow-soft">
          <h3 className="text-lg font-semibold">Check a receipt</h3>
          <p className="mb-4 mt-1 text-sm text-slate-500">
            Every screening has a receipt code such as FB-7KQ2-M9TX. Enter it to confirm the record has not been changed since it was sealed. No sign-in
            needed.
          </p>
          <ReceiptCheck />
        </div>
      </section>

      {/* Privacy */}
      <section id="privacy" className="scroll-mt-20 pb-20">
        <div className="mx-auto max-w-6xl px-5">
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {PRIVACY.map((p) => (
              <div key={p.title} className="rounded-2xl bg-slate-50 p-6">
                <p.icon className="h-5 w-5 text-brand-600" />
                <h3 className="mt-3 font-semibold">{p.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-slate-600">{p.text}</p>
              </div>
            ))}
          </div>
          <div className="hero-bg relative mt-16 overflow-hidden rounded-3xl px-6 py-14 text-center text-white shadow-lift">
            <h2 className="text-3xl font-semibold tracking-[-0.01em] sm:text-4xl">Your workspace is ready when you are.</h2>
            <p className="mx-auto mt-3 max-w-xl text-white/85">Sign in with the account your administrator registered for you.</p>
            <Link to="/signin" className="mt-7 inline-flex items-center gap-2 rounded-xl bg-white px-6 py-3 font-medium text-brand-700 shadow-lg transition hover:-translate-y-0.5 hover:shadow-xl">
              Sign in <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-200 bg-slate-50">
        <div className="mx-auto max-w-6xl px-5 py-10 text-sm text-slate-500">
          <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-4">
            <Brand tagline={false} />
            <nav className="flex flex-wrap gap-x-6 gap-y-2" aria-label="Sections">
              {SECTIONS.map(([href, label]) => <a key={href} href={href} className="transition hover:text-slate-900">{label}</a>)}
            </nav>
          </div>
          <div className="mt-6 max-w-3xl space-y-2">
            <ScreeningNotice />
            {study && <p>A research prototype of De La Salle University–Dasmariñas, used only for the approved activities of the ForgeBlock study. Not for actual legal, financial or official documents.</p>}
          </div>
          <p className="mt-6 border-t border-slate-200 pt-5">© 2026 CloudNine. All rights reserved.</p>
        </div>
      </footer>
    </div>
  )
}
