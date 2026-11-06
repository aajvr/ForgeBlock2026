// Faint pen flourishes that draw themselves in once and then drift slowly,
// with a few blurred colour blobs behind them. Decorative only.
const LINES = [
  { d: 'M-40 140 C 80 60, 160 230, 290 130 S 450 40, 560 120 S 700 210, 820 90', width: 2, opacity: 0.22, delay: 0.3, dur: 5 },
  { d: 'M-20 470 C 110 400, 220 540, 350 450 S 520 360, 610 450 C 650 500, 580 540, 550 490 S 680 370, 860 440', width: 1.8, opacity: 0.17, delay: 1, dur: 5.4 },
  { d: 'M60 760 C 180 690, 260 800, 380 720 S 560 650, 860 730', width: 1.5, opacity: 0.14, delay: 1.8, dur: 4.4 },
]

const BLOBS = [
  'left-[-8rem] top-[-6rem] h-80 w-80 bg-brand-400',
  'right-[-6rem] top-1/3 h-72 w-72 bg-cyan-400 [animation-delay:-7s]',
  'bottom-[-8rem] left-1/4 h-96 w-96 bg-indigo-500 [animation-delay:-13s]',
]

export default function DriftingLines() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      {BLOBS.map((b) => <div key={b} className={`blob absolute rounded-full opacity-40 blur-3xl ${b}`} />)}
      <svg viewBox="0 0 800 800" preserveAspectRatio="xMidYMid slice" className="hero-strokes trace absolute -inset-[4%] h-[108%] w-[108%]" fill="none" stroke="#fff" strokeLinecap="round">
        {LINES.map((l) => (
          <path key={l.d} d={l.d} pathLength="1" strokeWidth={l.width} opacity={l.opacity} style={{ '--len': 1, '--dur': `${l.dur}s`, '--delay': `${l.delay}s` }} />
        ))}
      </svg>
    </div>
  )
}
