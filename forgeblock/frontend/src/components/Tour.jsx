import { ArrowLeft, ArrowRight, X } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useState } from 'react'
import { useAuth } from '../auth'

// First-time guided tour. It highlights the main menu items of the user's
// workspace one by one. It runs once after the first sign-in and can be
// replayed from the Help Center or the Profile page.
const STEPS = {
  examiner: [
    { title: 'Welcome to ForgeBlock', text: 'This short tour shows where everything is in your examiner workspace. It takes about a minute.' },
    { target: 'nav-home', title: 'My work', text: 'Your start page: cases waiting for your decision and your latest screenings.' },
    { target: 'nav-clients', title: 'Clients', text: 'The clients of your group. Register a client (add their email to create their account) and enroll their genuine signatures: at least 5, and 10 or more for the best results.' },
    { target: 'nav-screen', title: 'Screen a signature', text: 'Upload a scanned signature (Static) or have it signed with the pen (Dynamic). ForgeBlock compares it with the client’s signatures on file.' },
    { target: 'nav-cases', title: 'Cases', text: 'When a result is Inconclusive or Inconsistent, a case opens here. You decide Genuine or Forged and write your notes.' },
    { target: 'nav-records', title: 'Records', text: 'Every screening you made, with its result, your decision and its receipt code.' },
    { target: 'nav-help', title: 'Help Center', text: 'Answers to common questions. You can replay this tour from here or from your Profile.' },
  ],
  admin: [
    { title: 'Welcome to ForgeBlock', text: 'This short tour shows where everything is in the administrator workspace.' },
    { target: 'nav-home', title: 'Dashboard', text: 'Activity, cases waiting for a decision and the health of the ledger at a glance.' },
    { target: 'nav-users', title: 'Users and roles', text: 'Create examiner and client accounts. People sign in with the email you register, by password, Microsoft or Google.' },
    { target: 'nav-clients', title: 'Clients', text: 'Clients are kept in group folders, each with one assigned examiner. Open a folder to enroll signatures; right-click a client to move or delete it.' },
    { target: 'nav-cases', title: 'Cases', text: 'Screenings that need an examiner’s decision, from every examiner.' },
    { target: 'nav-ledger', title: 'Ledger', text: 'The hash-linked chain of every screening and decision. Check it here; it is also checked every day.' },
    { target: 'nav-policy', title: 'Policy and retention', text: 'How long signature data is kept, and deletion requests.' },
    { target: 'nav-help', title: 'Help Center', text: 'Answers to common questions. You can replay this tour from here or from your Profile.' },
  ],
  client: [
    { title: 'Welcome to ForgeBlock', text: 'Here you can see how your signatures are kept and used.' },
    { target: 'nav-home', title: 'Home', text: 'Your examiner, your signatures on file and every screening made on documents in your name. Click a screening to see its details.' },
    { target: 'nav-profile', title: 'Profile', text: 'Your account details, password and how you sign in. You can also ask for your signature data to be deleted.' },
    { target: 'nav-help', title: 'Help Center', text: 'Answers to common questions, and this tour again.' },
  ],
}

function rectOf(target) {
  if (!target) return null
  const el = document.querySelector(`[data-tour="${target}"]`)
  if (!el) return null
  const r = el.getBoundingClientRect()
  // The phone drawer is parked off-screen until it is opened.
  if (r.width === 0 || r.height === 0 || r.right <= 0) return null
  return { top: r.top, left: r.left, width: r.width, height: r.height }
}

export default function Tour() {
  const { user, finishTour } = useAuth()
  const steps = STEPS[user.role] || STEPS.examiner
  const [i, setI] = useState(0)
  const [rect, setRect] = useState(null)
  const step = steps[i]

  const measure = useCallback(() => setRect(rectOf(step.target)), [step.target])
  useLayoutEffect(() => {
    const el = step.target && document.querySelector(`[data-tour="${step.target}"]`)
    el?.scrollIntoView?.({ block: 'nearest' })
    measure()
  }, [measure, step.target])
  useEffect(() => {
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [measure])
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') finishTour()
      if (e.key === 'ArrowRight') setI((n) => Math.min(n + 1, steps.length - 1))
      if (e.key === 'ArrowLeft') setI((n) => Math.max(n - 1, 0))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [finishTour, steps.length])

  const last = i === steps.length - 1
  const pad = 6
  // The card sits to the right of a highlighted menu item, or in the middle.
  const cardStyle = rect
    ? { top: Math.max(16, Math.min(rect.top - 8, window.innerHeight - 260)), left: Math.min(rect.left + rect.width + 20, window.innerWidth - 380) }
    : { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }

  return (
    <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label="Guided tour">
      {rect ? (
        <div
          className="pointer-events-none absolute rounded-xl ring-2 ring-white transition-all duration-300"
          style={{
            top: rect.top - pad,
            left: rect.left - pad,
            width: rect.width + pad * 2,
            height: rect.height + pad * 2,
            boxShadow: '0 0 0 9999px rgba(15, 23, 42, 0.6)',
          }}
        />
      ) : (
        <div className="absolute inset-0 bg-slate-900/60" />
      )}
      <div className="absolute w-[min(360px,calc(100vw-32px))] rounded-2xl bg-white p-5 shadow-2xl transition-all duration-300" style={cardStyle}>
        <div className="flex items-start justify-between gap-3">
          <div className="text-sm font-medium text-brand-600">Step {i + 1} of {steps.length}</div>
          <button onClick={finishTour} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Skip the tour">
            <X className="h-4 w-4" />
          </button>
        </div>
        <h3 className="mt-1 text-lg font-semibold">{i === 0 ? `${step.title}, ${user.full_name.split(' ')[0]}` : step.title}</h3>
        <p className="mt-1.5 text-[15px] leading-relaxed text-slate-600">{step.text}</p>
        <div className="mt-4 flex items-center gap-1.5">
          {steps.map((_, k) => (
            <span key={k} className={`h-1.5 rounded-full transition-all ${k === i ? 'w-5 bg-brand-600' : 'w-1.5 bg-slate-200'}`} />
          ))}
        </div>
        <div className="mt-5 flex items-center justify-between">
          <button onClick={finishTour} className="text-sm text-slate-500 hover:text-slate-800">Skip tour</button>
          <div className="flex gap-2">
            {i > 0 && (
              <button onClick={() => setI(i - 1)} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-50">
                <ArrowLeft className="h-4 w-4" /> Back
              </button>
            )}
            <button
              onClick={() => (last ? finishTour() : setI(i + 1))}
              className="inline-flex items-center gap-1 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
            >
              {last ? 'Finish' : i === 0 ? 'Start' : 'Next'} {!last && <ArrowRight className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
