import { useEffect, useState } from 'react'
import markBlue from '../assets/brand/forgeblock-mark-blue.svg'
import markDark from '../assets/brand/forgeblock-mark-dark.svg'
import markGradient from '../assets/brand/forgeblock-mark-gradient.svg'
import markLightblue from '../assets/brand/forgeblock-mark-lightblue.svg'
import markWhite from '../assets/brand/forgeblock-mark-white.svg'

// The ForgeBlock logo: the mark (no box around it), optionally with the
// "ForgeBlock" wordmark beside it.
//
// Which variant goes where:
//   blue      white or light grey backgrounds
//   gradient  the landing hero and the sign-in page
//   white     the blue sidebar / icon rail and other brand-blue surfaces
//   lightblue dark mode
//   dark      print or very light single-colour use
//   auto      blue, or lightblue when the app is in dark mode
//
// size is the mark's width in px; the mark keeps its 64:39 aspect ratio.
const MARKS = { blue: markBlue, gradient: markGradient, white: markWhite, lightblue: markLightblue, dark: markDark }
const TEXT = { blue: '#0F548C', gradient: '#0F548C', white: '#FFFFFF', lightblue: '#FFFFFF', dark: '#1B1F2A' }
const RATIO = 39 / 64

// Dark mode is an app setting (a "dark" class or data-theme="dark" on <html>),
// not the operating system's, since the app itself has no dark styles yet.
function useAppDark() {
  const read = () => {
    const el = document.documentElement
    return el.classList.contains('dark') || el.dataset.theme === 'dark'
  }
  const [dark, setDark] = useState(read)
  useEffect(() => {
    const obs = new MutationObserver(() => setDark(read()))
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] })
    return () => obs.disconnect()
  }, [])
  return dark
}

export default function Logo({ variant = 'auto', showText = true, size = 40, className = '' }) {
  const dark = useAppDark()
  const v = variant === 'auto' ? (dark ? 'lightblue' : 'blue') : MARKS[variant] ? variant : 'blue'
  const h = Math.round(size * RATIO)
  return (
    <span className={`inline-flex shrink-0 items-center ${className}`} style={{ gap: showText ? Math.round(h * 0.3) : 0 }}>
      <img src={MARKS[v]} alt="ForgeBlock" width={size} height={h} draggable={false} className="block shrink-0 select-none" style={{ width: size, height: h }} />
      {showText && (
        <span
          aria-hidden="true"
          className="whitespace-nowrap font-sans font-bold leading-none tracking-tight"
          style={{ color: TEXT[v], fontSize: Math.max(11, Math.round(h * 0.82)) }}
        >
          ForgeBlock
        </span>
      )}
    </span>
  )
}
