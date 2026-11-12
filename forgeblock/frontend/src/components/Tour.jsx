import { ArrowLeft, ArrowRight, X } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'
import SignatureTrace from './SignatureTrace'
import { RESULT } from './ui'

// Guided tour that moves through the app. Each step can go to a page (path),
// wait for an element marked data-tour="…" and spotlight it. A step whose
// element never shows up is skipped. `kind` is 'full' (first sign-in, or
// "Replay full tour") or a page's mini-tour ('screen', 'enroll').
//
// Motion, one thing at a time: the card fades out; the page changes and the
// target settles; it scrolls into view; the spotlight glides to it; then the
// card fades and slides in. Next stays disabled until that is done.
// The demos are fake example content, clearly labelled, and never call the API.

const HOME = { admin: '/app/admin', examiner: '/app/home', client: '/app/me' }

// The last step of every full tour: back on the home page, a short wrap-up and
// where to find the tour again, so it does not just stop.
const finish = (role, text) => ({
  path: HOME[role],
  title: 'You’re all set',
  text: `${text} Replay this tour any time from the Help Center or your Profile.`,
})

function staffSteps(role) {
  const admin = role === 'admin'
  return [
    {
      path: HOME[role], target: 'home-stats',
      title: admin ? 'Dashboard' : 'My work',
      text: admin
        ? 'Screening activity, cases waiting for a decision and ledger health. Click a card to open the list behind it.'
        : 'Cases waiting for your decision and your latest screenings. Click a card to open that list.',
    },
    ...(admin
      ? [
          { path: HOME[role], target: 'dash-activity', title: 'Screenings per day', text: 'Each day’s screenings by result. Point at a day to see its counts, and change the period with 7, 14 or 30 days at the top.' },
          { path: HOME[role], target: 'dash-workload', title: 'Examiner workload', text: 'How many screenings each examiner made in this period. Click a name to open their records.' },
        ]
      : [
          { path: HOME[role], target: 'home-actions', title: 'Shortcuts', text: 'Screen a signature, register a client or open your records in one click.' },
          { path: HOME[role], target: 'home-decisions', title: 'Waiting for your decision', text: 'Open a case to compare the signatures and decide Genuine or Forged, with notes. Your decision is sealed in the ledger.' },
        ]),
    { target: 'global-search', title: 'Search', text: 'Find a client, a case or a receipt code from any page. Press Ctrl K to jump here.' },
    { path: '/app/clients', target: 'new-client', title: 'Clients', text: 'Register a client here. Each client gets a signature card that holds their genuine signatures.' },
    {
      path: '/app/clients', target: 'clients-list', title: admin ? 'Groups' : 'Your clients',
      text: admin
        ? 'Clients are kept in groups. Each group has one examiner, the only examiner who can see its clients. Open a folder to see them.'
        : 'The clients of your group. Open one to see their signature card, or right-click for quick actions.',
    },
    {
      path: '/app/clients', demo: 'enroll', title: 'Signature card',
      text: 'Open a client to add reference signatures: the printable sheet or images for Static, live pen signing for Dynamic. At least 7 per module, 20 recommended.',
    },
    { path: '/app/screen', target: 'modules', demo: 'screen', title: 'Screen a signature', text: 'Pick Static for paper or Dynamic for live signing, choose the client, then press Screen signature.' },
    { path: '/app/screen', target: 'screen-button', demo: 'result', title: 'Reading a result', text: 'Each screening is Consistent, Inconclusive or Inconsistent, with a confidence score. ForgeBlock screens; the examiner makes the final call.' },
    { path: '/app/cases', target: 'cases-list', title: 'Cases', text: 'Inconclusive and Inconsistent screenings open a case here. The examiner decides Genuine or Forged, with notes.' },
    { path: '/app/records', target: 'records-filters', title: 'Records', text: 'Every screening, with its result, the examiner’s decision and its receipt code. Filter by result, module, decision or date.' },
    ...(admin
      ? [
          { path: '/app/admin/users', target: 'users-list', title: 'Users and roles', text: 'Create accounts and set roles. A role change asks you to confirm first.' },
          { path: '/app/admin/ledger', target: 'ledger-check', title: 'Ledger', text: 'Every screening and decision is sealed in a hash-linked chain. Check it here; it is also checked every day.' },
          { path: '/app/admin/audit', target: 'audit-list', title: 'Audit log', text: 'Who did what and when: sign-ins, account changes, screenings, decisions and deletions. Filter by person or activity.' },
          { path: '/app/admin/settings', target: 'policy-settings', title: 'Policy and retention', text: 'How borderline results are handled, how long signature data is kept, and deletion requests.' },
          { path: '/app/admin/system', target: 'system-health', title: 'System', text: 'Check that the models, database, storage and ledger are working. Model upkeep after a retrain is here too.' },
        ]
      : []),
    { target: 'notifications', title: 'Notifications', text: admin ? 'New cases, decisions, role changes and references show up here.' : 'New cases, decisions and references for your clients show up here.' },
    { target: 'nav-help', title: 'Help Center', text: 'Answers to common questions, searchable and grouped by topic.' },
    { target: 'nav-profile', title: 'Profile', text: 'Your account details, how you sign in, and your password.' },
    finish(role, admin
      ? 'That is the whole workspace: screening, casework, the ledger and administration.'
      : 'Register a client, add their references, then screen a signature. Anything not clearly Consistent comes back to you as a case.'),
  ]
}

const CLIENT_STEPS = [
  { path: '/app/me', target: 'home-stats', title: 'Home', text: 'Your examiner and the signatures kept on file for you.' },
  { path: '/app/me', target: 'client-screenings', demo: 'result-client', title: 'Screenings on your documents', text: 'Each screening shows Consistent, Inconclusive or Inconsistent. Your examiner makes the final decision. Click one to see it.' },
  { path: '/app/me', target: 'report-problem', title: 'Report a problem', text: 'If something looks wrong, for example a document you did not sign, tell us here. An administrator looks into it.' },
  { target: 'notifications', title: 'Notifications', text: 'We let you know here when a document in your name is screened or decided.' },
  { path: '/app/profile', target: 'profile-data', title: 'Your signature data', text: 'Your account details are on your Profile. You can also ask for your signatures on file to be deleted here.' },
  { target: 'nav-help', title: 'Help Center', text: 'Answers to common questions, and this tour again.' },
  finish('client', 'You can check every screening on documents in your name from Home.'),
]

const MINI = {
  screen: [
    { target: 'modules', demo: 'screen', title: 'Static or Dynamic', text: 'Static: upload a scan or photo of the signature. Dynamic: the signer signs live with a pen.' },
    { target: 'screen-client', title: 'Choose the client', text: 'Pick the client whose signature it claims to be. Link an open case if there is one.' },
    { target: 'screen-button', title: 'Screen it', text: 'Press Screen signature. You go straight to the result.' },
    { demo: 'result', title: 'Reading the result', text: 'Consistent, Inconclusive or Inconsistent, with a confidence score. Anything not clearly Consistent opens a case for the examiner.' },
  ],
  enroll: [
    { target: 'enroll-tabs', title: 'Static and Dynamic', text: 'Each module keeps its own reference signatures. Switch between them with these tabs.' },
    { target: 'enroll-strength', title: 'How many references', text: 'At least 7 per module, 20 recommended, up to 30. The bar shows where this card stands.' },
    { target: 'enroll-add', demo: 'enroll', title: 'Add references', text: 'Use the printable sheet or upload images for Static; sign live with the pen for Dynamic.' },
    { target: 'enroll-back', title: 'Back to clients', text: 'Returns to the client list. If signatures are not saved yet, you are asked first.' },
  ],
}

// --- motion -------------------------------------------------------------------
const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)'
const T_OUT = 260 // card fade out
const T_GLIDE = 420 // spotlight glide
const T_IN = 400 // card fade + slide in
const T_FADE = 200 // reduced motion: plain fades
const WAIT_MS = 2500 // longest wait for a step's element before skipping it
const PAD = 8
const CARD_W = 360
const DIM = 'rgba(0, 0, 0, 0.45)'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const frame = () => new Promise((r) => requestAnimationFrame(() => r()))
const capped = (p, ms) => Promise.race([p, sleep(ms)])

function usePrefersReducedMotion() {
  const query = '(prefers-reduced-motion: reduce)'
  const [reduced, setReduced] = useState(() => window.matchMedia?.(query).matches ?? false)
  useEffect(() => {
    const mq = window.matchMedia?.(query)
    if (!mq) return undefined
    const on = () => setReduced(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return reduced
}

function findVisible(target) {
  const el = target && document.querySelector(`[data-tour="${target}"]`)
  if (!el) return null
  const r = el.getBoundingClientRect()
  // The phone drawer is parked off-screen until it is opened.
  if (r.width === 0 || r.height === 0 || r.right <= 0 || r.left >= window.innerWidth) return null
  return el
}

const box = (el) => {
  const r = el.getBoundingClientRect()
  return { top: r.top, left: r.left, width: r.width, height: r.height }
}
// No element: the cutout shrinks to a point in the middle, so the whole screen is dimmed.
const centre = () => ({ top: window.innerHeight / 2, left: window.innerWidth / 2, width: 0, height: 0 })
const same = (a, b) => a && b && Math.abs(a.top - b.top) < 0.5 && Math.abs(a.left - b.left) < 0.5 && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5

async function waitForElement(target, alive) {
  const started = Date.now()
  while (alive()) {
    const el = findVisible(target)
    if (el) return el
    if (Date.now() - started > WAIT_MS) return null
    await sleep(80)
  }
  return null
}

// The element exists; wait until it has stopped moving: two frames, fonts, images.
async function settle(el) {
  await frame()
  await frame()
  if (document.fonts?.ready) await capped(document.fonts.ready, 1000)
  const imgs = [...el.querySelectorAll('img')].filter((img) => !img.complete)
  if (imgs.length) await capped(Promise.all(imgs.map((img) => new Promise((r) => { img.addEventListener('load', r, { once: true }); img.addEventListener('error', r, { once: true }) }))), 1500)
  await frame()
}

// Scroll into view only when needed, then wait until the scrolling has stopped.
async function scrollIntoViewSettled(el, reduced) {
  const r = el.getBoundingClientRect()
  const vh = window.innerHeight
  if (r.top >= 72 && r.bottom <= vh - 24) return
  el.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' })
  let last = box(el)
  let still = 0
  const started = Date.now()
  while (still < 4 && Date.now() - started < 1200) {
    await frame()
    const now = box(el)
    still = same(now, last) ? still + 1 : 0
    last = now
  }
}

// Card position: below the element if it fits, else above, else beside it, else centred.
// `from` is the offset it slides in from (8px from the side it is anchored to).
function place(rect, cardH, w) {
  const vw = window.innerWidth
  const vh = window.innerHeight
  if (!rect || rect.width === 0) return { top: Math.max(16, (vh - cardH) / 2), left: (vw - w) / 2, from: [0, 8] }
  const gap = 14
  const below = rect.top + rect.height + PAD + gap
  const above = rect.top - PAD - gap - cardH
  const centreLeft = Math.min(Math.max(16, rect.left + rect.width / 2 - w / 2), vw - w - 16)
  const sideTop = Math.min(Math.max(16, rect.top), vh - cardH - 16)
  if (below + cardH <= vh - 16) return { top: below, left: centreLeft, from: [0, -8] }
  if (above >= 16) return { top: above, left: centreLeft, from: [0, 8] }
  if (rect.left + rect.width + PAD + gap + w <= vw - 16) return { top: sideTop, left: rect.left + rect.width + PAD + gap, from: [-8, 0] }
  if (rect.left - PAD - gap - w >= 16) return { top: sideTop, left: rect.left - PAD - gap - w, from: [8, 0] }
  return { top: Math.max(16, (vh - cardH) / 2), left: (vw - w) / 2, from: [0, 8] }
}

// --- demos ----------------------------------------------------------------------
const DRAW_S = 2.5 // the signature itself
const TAIL_S = 1.3 // flourish and the small block after it
const HOLD_MS = 1000
const FADE_MS = 350

// A signature drawn, held for a second, faded out and drawn again. Starts only when `play`.
function LoopingSignature({ play, reduced, className, offset = 0 }) {
  const [n, setN] = useState(0)
  const [shown, setShown] = useState(true)
  useEffect(() => {
    if (!play || reduced) return undefined
    let alive = true
    let t
    const cycle = () => {
      t = setTimeout(() => {
        if (!alive) return
        setShown(false)
        t = setTimeout(() => {
          if (!alive) return
          setN((k) => k + 1)
          setShown(true)
          cycle()
        }, FADE_MS)
      }, (0.2 + DRAW_S + TAIL_S) * 1000 + HOLD_MS + offset)
    }
    cycle()
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [play, reduced, offset])
  if (!play && !reduced) return <div className={className} />
  return (
    <div style={{ opacity: shown ? 1 : 0, transition: `opacity ${FADE_MS}ms ease` }}>
      <SignatureTrace key={n} className={className} duration={DRAW_S} delay={0.2 + offset / 1000} timing="cubic-bezier(0.45, 0, 0.55, 1)" />
    </div>
  )
}

function ExampleTag() {
  return <span className="rounded-md bg-slate-900/80 px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-white">Example</span>
}

function Demo({ kind, play, reduced }) {
  if (kind === 'screen' || kind === 'enroll') {
    return (
      <div className="relative mt-3 rounded-[12px] border border-line bg-[#f6f8fc] p-3" aria-hidden>
        <div className="absolute right-2 top-2"><ExampleTag /></div>
        <div className="mb-1 text-[11.5px] font-medium text-slate-500">{kind === 'screen' ? 'Questioned signature' : 'Reference signatures'}</div>
        {kind === 'screen' ? (
          <div className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-3 text-slate-800"><LoopingSignature play={play} reduced={reduced} className="h-14 w-full" /></div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {[0, 1, 2].map((k) => (
              <div key={k} className="rounded-md border border-slate-200 bg-white px-2 py-2 text-slate-800">
                <LoopingSignature play={play} reduced={reduced} className="h-7 w-full" offset={k * 450} />
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }
  const r = RESULT.consistent
  const client = kind === 'result-client'
  const on = play || reduced
  return (
    <div
      className="relative mt-3 rounded-[12px] border border-line bg-white p-3"
      style={{ opacity: on ? 1 : 0, transition: reduced ? `opacity ${T_FADE}ms ease` : `opacity 600ms ${EASE}` }}
      aria-hidden
    >
      <div className="absolute right-2 top-2"><ExampleTag /></div>
      <div className={`flex items-center gap-1.5 text-sm font-semibold ${r.text}`}><r.Icon className="h-4 w-4" /> {client ? 'Consistent' : r.long}</div>
      {!client && (
        <div className="mt-2">
          <div className="flex justify-between text-[11.5px] text-slate-500"><span>Confidence score</span><span className="font-semibold text-slate-700">92%</span></div>
          <div className="mt-1 h-1.5 rounded-full bg-slate-200">
            <div
              className="h-full origin-left rounded-full bg-ok-600"
              style={{ width: '92%', transform: on ? 'scaleX(1)' : 'scaleX(0)', transition: reduced ? 'none' : `transform 900ms ${EASE} 450ms` }}
            />
          </div>
        </div>
      )}
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-slate-600">
        {Object.values(RESULT).map((x) => <span key={x.label} className="inline-flex items-center gap-1"><x.Icon className={`h-3 w-3 ${x.text}`} />{x.label}</span>)}
      </div>
      <div className="mt-1.5 text-[11.5px] text-slate-500">The examiner makes the final call.</div>
    </div>
  )
}

// --- tour -----------------------------------------------------------------------
export default function Tour({ kind = 'full' }) {
  const { user, finishTour, setTourOpen } = useAuth()
  const navigate = useNavigate()
  const reduced = usePrefersReducedMotion()
  const steps = kind === 'full' ? (user.role === 'client' ? CLIENT_STEPS : staffSteps(user.role)) : MINI[kind] || []

  const [i, setI] = useState(-1) // the step whose text the card shows
  const [rect, setRect] = useState(centre)
  const [hasTarget, setHasTarget] = useState(false)
  const [gliding, setGliding] = useState(false)
  const [card, setCard] = useState({ visible: false, top: 0, left: 0, from: [0, 8], animate: false })
  const [busy, setBusy] = useState(true) // a step change is running: Next/Back are disabled
  const [settled, setSettled] = useState(false) // the card is in place: demos may play
  const [closing, setClosing] = useState(false)

  const token = useRef(0)
  const elRef = useRef(null)
  const cardRef = useRef(null)
  const iRef = useRef(-1)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true // StrictMode mounts twice in development
    return () => { mounted.current = false }
  }, [])

  const w = Math.min(CARD_W, window.innerWidth - 32)
  const t = (normal) => (reduced ? T_FADE : normal)

  const close = useCallback(async () => {
    token.current += 1 // stop any step change
    setClosing(true)
    await sleep(reduced ? T_FADE : 300)
    if (kind === 'full') finishTour()
    else setTourOpen(false)
  }, [kind, finishTour, setTourOpen, reduced])

  // Change to step `target` (skipping steps whose element never appears, in direction `dir`).
  const goTo = useCallback(async (target, dir) => {
    const my = ++token.current
    const alive = () => mounted.current && token.current === my
    setBusy(true)
    setSettled(false)

    // 1. the card fades out (it stays where it is)
    setCard((c) => ({ ...c, visible: false, animate: true }))
    if (iRef.current >= 0) await sleep(t(T_OUT))
    if (!alive()) return

    let idx = target
    let el = null
    for (;;) {
      if (idx < 0 || idx >= steps.length) {
        if (dir < 0 && idx < 0) { idx = Math.max(0, iRef.current) ; dir = 1; continue }
        close()
        return
      }
      const step = steps[idx]
      // 2. go to the page and wait for the element and the layout to settle
      if (step.path && window.location.pathname !== step.path) navigate(step.path)
      if (!step.target) { el = null; break }
      el = await waitForElement(step.target, alive)
      if (!alive()) return
      if (el) break
      idx += dir // missing: skip this step
    }
    if (el) {
      await settle(el)
      if (!alive()) return
      // 3. scroll it into view if needed
      await scrollIntoViewSettled(el, reduced)
      if (!alive()) return
    } else {
      await frame()
    }
    elRef.current = el

    // 4. the spotlight glides to the new element (or to the centre)
    const next = el ? box(el) : centre()
    setHasTarget(!!el)
    setGliding(true)
    setRect(next)
    await sleep(reduced ? 0 : T_GLIDE)
    if (!alive()) return
    setGliding(false)

    // 5. new text in the (still hidden) card, measure it, place it at its start offset, then show it
    iRef.current = idx
    setI(idx)
    await frame()
    await frame()
    if (!alive()) return
    const h = cardRef.current?.offsetHeight || 240
    const pos = place(el ? next : null, h, w)
    setCard({ visible: false, top: pos.top, left: pos.left, from: pos.from, animate: false })
    await frame()
    await frame()
    if (!alive()) return
    setCard((c) => ({ ...c, visible: true, animate: true }))
    await sleep(t(T_IN))
    if (!alive()) return
    setBusy(false)
    setSettled(true)
  }, [steps, navigate, close, reduced, w]) // eslint-disable-line react-hooks/exhaustive-deps

  // First step.
  useEffect(() => {
    goTo(0, 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Between step changes, follow the element when the page scrolls or resizes (no animation).
  useEffect(() => {
    if (busy) return undefined
    const update = () => {
      const el = elRef.current
      const r = el && document.contains(el) ? box(el) : centre()
      setRect((cur) => (same(cur, r) ? cur : r))
      const h = cardRef.current?.offsetHeight || 240
      const pos = place(el ? r : null, h, w)
      setCard((c) => (Math.abs(c.top - pos.top) < 0.5 && Math.abs(c.left - pos.left) < 0.5 ? c : { ...c, top: pos.top, left: pos.left, animate: false }))
    }
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    const timer = setInterval(update, 500)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
      clearInterval(timer)
    }
  }, [busy, w])

  // The demo may change the card's height once it plays; keep the card inside the screen.
  useLayoutEffect(() => {
    if (!settled || !cardRef.current) return
    const h = cardRef.current.offsetHeight
    setCard((c) => (c.top + h > window.innerHeight - 16 ? { ...c, top: Math.max(16, window.innerHeight - h - 16), animate: false } : c))
  }, [settled])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') close()
      if (busy) return
      if (e.key === 'ArrowRight') {
        if (iRef.current >= steps.length - 1) close()
        else goTo(iRef.current + 1, 1)
      }
      if (e.key === 'ArrowLeft' && iRef.current > 0) goTo(iRef.current - 1, -1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, close, goTo, steps.length])

  const step = steps[Math.max(0, i)]
  if (!step) return null
  const last = i === steps.length - 1

  const geometry = `top ${T_GLIDE}ms ${EASE}, left ${T_GLIDE}ms ${EASE}, width ${T_GLIDE}ms ${EASE}, height ${T_GLIDE}ms ${EASE}`
  const spotTransition = gliding && !reduced ? geometry : 'none'
  const [fx, fy] = card.from
  const cardTransition = !card.animate ? 'none'
    : reduced ? `opacity ${T_FADE}ms ease`
      : card.visible ? `opacity ${T_IN}ms ${EASE}, transform ${T_IN}ms ${EASE}` : `opacity ${T_OUT}ms ease`
  const cardTransform = reduced || card.visible ? 'none' : `translate(${fx}px, ${fy}px)`
  const btn = 'inline-flex items-center gap-1 rounded-[10px] px-3 py-2 text-sm font-semibold transition disabled:cursor-default disabled:opacity-50'

  return (
    <div
      className="fixed inset-0 z-[60]"
      role="dialog"
      aria-modal="true"
      aria-label="Guided tour"
      style={{ opacity: closing ? 0 : 1, transition: `opacity ${reduced ? T_FADE : 300}ms ease` }}
    >
      {/* One overlay for the whole tour: the cutout's shadow is the dimming. */}
      <div
        className={`pointer-events-none absolute rounded-xl ${hasTarget ? 'tour-spot' : ''}`}
        style={{
          top: rect.top - (hasTarget ? PAD : 0),
          left: rect.left - (hasTarget ? PAD : 0),
          width: rect.width + (hasTarget ? PAD * 2 : 0),
          height: rect.height + (hasTarget ? PAD * 2 : 0),
          boxShadow: `0 0 0 9999px ${DIM}`,
          transition: spotTransition,
        }}
      />
      <div
        ref={cardRef}
        aria-live="polite"
        className="absolute rounded-[16px] border border-line bg-white p-5 shadow-2xl"
        style={{
          top: card.top,
          left: card.left,
          width: w,
          opacity: card.visible ? 1 : 0,
          transform: cardTransform,
          transition: cardTransition,
          pointerEvents: card.visible ? 'auto' : 'none',
          visibility: i < 0 ? 'hidden' : 'visible',
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="text-sm font-medium text-brand-600">
            {kind === 'full' && i === 0 ? `Welcome, ${user.full_name.split(' ')[0]}` : kind === 'full' ? 'Guided tour' : 'Quick tour'}
          </div>
          <button onClick={close} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Skip the tour">
            <X className="h-4 w-4" />
          </button>
        </div>
        <h3 className="mt-1 text-[17px] font-semibold text-ink">{step.title}</h3>
        <p className="mt-1 text-[15px] leading-relaxed text-slate-600">{step.text}</p>
        {step.demo && <Demo key={i} kind={step.demo} play={settled} reduced={reduced} />}
        <div className="mt-4 flex items-center gap-1.5" aria-label={`Step ${i + 1} of ${steps.length}`}>
          {steps.map((_, k) => (
            <span key={k} className={`h-1.5 rounded-full ${k === i ? 'w-5 bg-brand-600' : 'w-1.5 bg-slate-200'}`} style={{ transition: reduced ? 'none' : `all 400ms ${EASE}` }} />
          ))}
        </div>
        <div className="mt-4 flex items-center justify-between">
          <button onClick={close} className="text-sm text-slate-500 hover:text-slate-800">Skip</button>
          <div className="flex gap-2">
            {i > 0 && (
              <button onClick={() => goTo(i - 1, -1)} disabled={busy} className={`${btn} border border-line text-[#3b4a5e] hover:bg-slate-50`}>
                <ArrowLeft className="h-4 w-4" /> Back
              </button>
            )}
            <button
              onClick={() => (last ? close() : goTo(i + 1, 1))}
              disabled={busy}
              className={`${btn} bg-brand-600 px-4 text-white shadow-[0_4px_12px_rgb(15_108_189/0.22)] hover:bg-brand-700`}
            >
              {last ? 'Finish' : 'Next'} {!last && <ArrowRight className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
