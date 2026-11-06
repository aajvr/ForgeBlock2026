import { SIGNATURE_HEIGHT, SIGNATURE_PATHS, SIGNATURE_WIDTH } from './signaturePaths'

// "ForgeBlock" written stroke by stroke, like a pen signing, then underlined
// with a flourish that ends in a small block (the ForgeBlock mark).
const FLOURISH = `M4 ${SIGNATURE_HEIGHT + 7} C 40 ${SIGNATURE_HEIGHT + 1}, 90 ${SIGNATURE_HEIGHT + 11}, ${SIGNATURE_WIDTH - 14} ${SIGNATURE_HEIGHT + 4}`

export default function SignatureTrace({ className = 'w-full', color = 'currentColor', duration = 3.4, delay = 0.3, strokeWidth = 1.7 }) {
  const total = SIGNATURE_PATHS.reduce((s, p) => s + p.len, 0)
  let start = delay
  const strokes = SIGNATURE_PATHS.map((p) => {
    const dur = (p.len / total) * duration
    const item = { ...p, delay: start, dur }
    start += dur
    return item
  })
  const flourishDelay = start + 0.05
  const blockDelay = flourishDelay + 0.55
  return (
    <svg
      viewBox={`-6 -4 ${SIGNATURE_WIDTH + 16} ${SIGNATURE_HEIGHT + 20}`}
      className={`trace ${className}`}
      role="img"
      aria-label="ForgeBlock"
    >
      <g transform="skewX(-6) translate(4 0)" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
        {strokes.map((p, i) => (
          <path key={i} d={p.d} pathLength="1" style={{ '--len': 1, '--dur': `${p.dur}s`, '--delay': `${p.delay}s`, animationTimingFunction: 'linear' }} />
        ))}
        <path d={FLOURISH} pathLength="1" strokeWidth={strokeWidth * 0.8} style={{ '--len': 1, '--dur': '0.6s', '--delay': `${flourishDelay}s` }} />
      </g>
      <rect
        x={SIGNATURE_WIDTH - 9}
        y={SIGNATURE_HEIGHT + 1.5}
        width="5"
        height="5"
        rx="1"
        fill={color}
        className="fade-up"
        style={{ '--delay': `${blockDelay}s` }}
      />
    </svg>
  )
}
