import { useState } from 'react'

// Pen-only mode for the signing pad, remembered per device. It turns on by
// itself the first time the pad sees a pen (a palm resting on an iPad would
// otherwise become an extra stroke), unless the user turned it off on this
// device; the checkbox stays, for finger and mouse users.
export const PEN_KEY = 'forgeblock_pen_only'

function stored() {
  try { return localStorage.getItem(PEN_KEY) } catch { return null }
}

export function usePenOnly() {
  const [penOnly, setPenOnly] = useState(() => stored() === '1')
  const change = (on) => {
    setPenOnly(on)
    try { localStorage.setItem(PEN_KEY, on ? '1' : '0') } catch { /* ignore */ }
  }
  // Called by the pad when a pen touches or hovers.
  const penSeen = () => {
    if (!penOnly && stored() !== '0') change(true)
  }
  return [penOnly, change, penSeen]
}
