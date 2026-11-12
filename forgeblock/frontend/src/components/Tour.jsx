import { ArrowLeft, ArrowRight, X } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'
import SignatureTrace from './SignatureTrace'
import { RESULT } from './ui'

// Guided tour that moves through the app. Each step can go to a page (path),
// wait for an element marked data-tour="…" and spotlight it. A step whose
// element never shows up is skipped. `kind` is 'full' (first sign-in, or
// "Replay full tour") or a page's mini-tour ('screen', 'enroll').
//
// The demos are fake example content, clearly labelled, and never call the API.

const HOME = { admin: '/app/admin', examiner: '/app/home', client: '/app/me' }

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
    { path: '/app/clients', target: 'new-client', title: 'Clients', text: 'Register a client here. Each client gets a signature card that holds their genuine signatures.' },
    {
      path: '/app/clients', demo: 'enroll', title: 'Signature card',
      text: 'Open a client to add reference signatures: the printable sheet or images for Static, live pen signing for Dynamic. At least 7 per module, 20 recommended.',
    },
    { path: '/app/screen', target: 'modules', demo: 'screen', title: 'Screen a signature', text: 'Pick Static for paper or Dynamic for live signing, choose the client, then press Screen signature.' },
    { path: '/app/screen', target: 'screen-button', demo: 'result', title: 'Reading a result', text: 'Each screening is Consistent, Inconclusive or Inconsistent, with a confidence score. ForgeBlock screens; the examiner makes the final call.' },
    { path: '/app/cases', target: 'cases-list', title: 'Cases', text: 'Inconclusive and Inconsistent screenings open a case here. The examiner decides Genuine or Forged, with notes.' },
    { path: '/app/records', target: 'records-list', title: 'Records', text: 'Every screening, with its result, the examiner’s decision and its receipt code.' },
    ...(admin
      ? [
          { path: '/app/admin/users', target: 'users-list', title: 'Users and roles', text: 'Create accounts and set roles. A role change asks you to confirm first.' },
          { path: '/app/admin/ledger', target: 'ledger-check', title: 'Ledger', text: 'Every screening and decision is sealed in a hash-linked chain. Check it here; it is also checked every day.' },
        ]
      : []),
    { target: 'notifications', title: 'Notifications', text: 'New cases, decisions and references show up here. Replay this tour any time from the Help Center.' },
  ]
}

const CLIENT_STEPS = [
  { path: '/app/me', target: 'home-stats', title: 'Home', text: 'Your examiner and the signatures kept on file for you.' },
  { path: '/app/me', target: 'client-screenings', demo: 'result-client', title: 'Screenings on your documents', text: 'Each screening shows Consistent, Inconclusive or Inconsistent. Your examiner makes the final decision. Click one to see it.' },
  { target: 'notifications', title: 'Notifications', text: 'We let you know here when a document in your name is screened or decided.' },
  { target: 'nav-help', title: 'Help Center', text: 'Answers to common questions, and this tour again.' },
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

const WAIT_MS = 2500
const PAD = 8
const CARD_W = 360

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

// A signature drawn over and over: the SVG is re-mounted every few seconds.
function LoopingSignature({ every = 4800, className }) {
  const [n, setN] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setN((k) => k + 1), every)
    return () => clearInterval(t)
  }, [every])
  return <SignatureTrace key={n} className={className} duration={2.6} delay={0.2} />
}

function ExampleTag() {
  return <span className="rounded-md bg-slate-900/80 px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-white">Example</span>
}

function Demo({ kind }) {
  if (kind === 'screen' || kind === 'enroll') {
    return (
      <div className="relative mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3" aria-hidden>
        <div className="absolute right-2 top-2"><ExampleTag /></div>
        <div className="mb-1 text-[11.5px] font-medium text-slate-500">{kind === 'screen' ? 'Questioned signature' : 'Reference signatures'}</div>
        {kind === 'screen' ? (
          <div className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-3 text-slate-800"><LoopingSignature className="h-14 w-full" /></div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {[0, 1, 2].map((k) => (
              <div key={k} className="rounded-md border border-slate-200 bg-white px-2 py-2 text-slate-800">
                <LoopingSignature className="h-7 w-full" every={4800 + k * 700} />
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }
  const r = RESULT.consistent
  const client = kind === 'result-client'
  return (
    <div className="tour-pop relative mt-3 rounded-xl border border-ok-100 bg-gradient-to-br from-ok-50 to-white p-3" aria-hidden>
      <div className="absolute right-2 top-2"><ExampleTag /></div>
      <div className={`flex items-center gap-1.5 text-sm font-semibold ${r.text}`}><r.Icon className="h-4 w-4" /> {client ? 'Consistent' : r.long}</div>
      {!client && (
        <div className="mt-2">
          <div className="flex justify-between text-[11.5px] text-slate-500"><span>Confidence score</span><span className="font-semibold text-slate-700">92%</span></div>
          <div className="mt-1 h-1.5 rounded-full bg-slate-200"><div className="tour-bar h-full rounded-full bg-ok-600" style={{ width: '92%' }} /></div>
        </div>
      )}
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-slate-600">
        {Object.values(RESULT).map((x) => <span key={x.label} className="inline-flex items-center gap-1"><x.Icon className={`h-3 w-3 ${x.text}`} />{x.label}</span>)}
      </div>
      <div className="mt-1.5 text-[11.5px] text-slate-500">The examiner makes the final call.</div>
    </div>
  )
}

export default function Tour({ kind = 'full' }) {
  const { user, finishTour, setTourOpen } = useAuth()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const steps = kind === 'full' ? (user.role === 'client' ? CLIENT_STEPS : staffSteps(user.role)) : MINI[kind] || []
  const [i, setI] = useState(0)
  const [dir, setDir] = useState(1)
  const [rect, setRect] = useState(null)
  const [ready, setReady] = useState(false)
  const [cardH, setCardH] = useState(240)
  const elRef = useRef(null)
  const cardRef = useRef(null)
  const step = steps[i]

  // Full tour: remember it is done (stored per user on the server). Mini-tours just close.
  const close = useCallback(() => (kind === 'full' ? finishTour() : setTourOpen(false)), [kind, finishTour, setTourOpen])
  const go = useCallback((d) => {
    setDir(d)
    setI((n) => n + d)
  }, [])

  // Out of steps (or a step skipped past the end): close.
  useEffect(() => {
    if (!step) close()
  }, [step, close])

  // Go to the step's page, then wait for its element; skip the step if it never shows up.
  useEffect(() => {
    if (!step) return undefined
    let cancelled = false
    let timer
    setReady(false)
    setRect(null)
    elRef.current = null
    if (step.path && pathname !== step.path) {
      navigate(step.path)
      return undefined // runs again once the path has changed
    }
    if (!step.target) {
      setReady(true)
      return undefined
    }
    const started = Date.now()
    const look = () => {
      if (cancelled) return
      const el = findVisible(step.target)
      if (el) {
        elRef.current = el
        el.scrollIntoView({ block: 'center', behavior: 'smooth' })
        timer = setTimeout(() => {
          if (cancelled) return
          setRect(box(el))
          setReady(true)
        }, 320)
        return
      }
      if (Date.now() - started > WAIT_MS) {
        if (i + dir < 0) go(1)
        else go(dir)
        return
      }
      timer = setTimeout(look, 100)
    }
    look()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i, pathname])

  // Follow the element when the page scrolls, resizes or shifts.
  useEffect(() => {
    if (!ready) return undefined
    const update = () => elRef.current && document.contains(elRef.current) && setRect(box(elRef.current))
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    const t = setInterval(update, 500)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
      clearInterval(t)
    }
  }, [ready])

  useLayoutEffect(() => {
    if (cardRef.current) setCardH(cardRef.current.offsetHeight)
  }, [ready, i])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') close()
      if (e.key === 'ArrowRight' && ready) go(1)
      if (e.key === 'ArrowLeft' && ready && i > 0) go(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close, go, i, ready])

  if (!step) return null
  const last = i === steps.length - 1
  const vw = window.innerWidth
  const vh = window.innerHeight
  const w = Math.min(CARD_W, vw - 32)

  // Below the element if it fits, else above, else beside it, else centred.
  let cardStyle = { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }
  if (rect) {
    const gap = 14
    const below = rect.top + rect.height + PAD + gap
    const above = rect.top - PAD - gap - cardH
    const centreLeft = Math.min(Math.max(16, rect.left + rect.width / 2 - w / 2), vw - w - 16)
    if (below + cardH <= vh - 16) cardStyle = { top: below, left: centreLeft }
    else if (above >= 16) cardStyle = { top: above, left: centreLeft }
    else if (rect.left + rect.width + PAD + gap + w <= vw - 16) cardStyle = { top: Math.min(Math.max(16, rect.top), vh - cardH - 16), left: rect.left + rect.width + PAD + gap }
    else if (rect.left - PAD - gap - w >= 16) cardStyle = { top: Math.min(Math.max(16, rect.top), vh - cardH - 16), left: rect.left - PAD - gap - w }
  }

  return (
    <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label="Guided tour">
      {rect ? (
        <div
          className="tour-spot pointer-events-none absolute rounded-xl transition-all duration-300 ease-out"
          style={{
            top: rect.top - PAD,
            left: rect.left - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
            boxShadow: '0 0 0 9999px rgba(15, 23, 42, 0.55)',
          }}
        />
      ) : (
        <div className="absolute inset-0 bg-slate-900/55 transition-opacity duration-300" />
      )}
      {ready && (
        <div
          ref={cardRef}
          key={i}
          className="tour-card absolute rounded-2xl bg-white p-5 shadow-2xl transition-[top,left] duration-300 ease-out"
          style={{ ...cardStyle, width: w }}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="text-sm font-medium text-brand-600">
              {kind === 'full' && i === 0 ? `Welcome, ${user.full_name.split(' ')[0]}` : kind === 'full' ? 'Guided tour' : 'Quick tour'}
            </div>
            <button onClick={close} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Skip the tour">
              <X className="h-4 w-4" />
            </button>
          </div>
          <h3 className="mt-1 text-lg font-semibold">{step.title}</h3>
          <p className="mt-1 text-[15px] leading-relaxed text-slate-600">{step.text}</p>
          {step.demo && <Demo kind={step.demo} />}
          <div className="mt-4 flex items-center gap-1.5" aria-label={`Step ${i + 1} of ${steps.length}`}>
            {steps.map((_, k) => (
              <span key={k} className={`h-1.5 rounded-full transition-all ${k === i ? 'w-5 bg-brand-600' : 'w-1.5 bg-slate-200'}`} />
            ))}
          </div>
          <div className="mt-4 flex items-center justify-between">
            <button onClick={close} className="text-sm text-slate-500 hover:text-slate-800">Skip</button>
            <div className="flex gap-2">
              {i > 0 && (
                <button onClick={() => go(-1)} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-50">
                  <ArrowLeft className="h-4 w-4" /> Back
                </button>
              )}
              <button
                autoFocus
                onClick={() => (last ? close() : go(1))}
                className="inline-flex items-center gap-1 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
              >
                {last ? 'Finish' : 'Next'} {!last && <ArrowRight className="h-4 w-4" />}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
