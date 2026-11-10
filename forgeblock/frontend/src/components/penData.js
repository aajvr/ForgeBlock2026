// v8.11 helpers for dynamic signatures without pen pressure or tilt (see shared.jsx).
export const LIMITED_PEN_LABEL = 'Limited pen data'

// Which pen channels a captured signature lacks: [] | ['pressure'] | ['tilt'] | both.
// Same rule as the server (app/ml/dynamic_model.py): the value must change while signing.
export function penMissing(strokes) {
  const pts = (strokes || []).flat()
  if (!pts.length) return []
  const spread = (vals) => (vals.length === pts.length ? Math.max(...vals) - Math.min(...vals) : 0)
  const pressure = spread(pts.map((p) => p.pressure).filter((v) => typeof v === 'number' && v !== 0.5))
  const angles = Math.max(
    spread(pts.map((p) => p.azimuth).filter((v) => typeof v === 'number')),
    spread(pts.map((p) => p.altitude).filter((v) => typeof v === 'number')),
  )
  const tilt = angles > 0 || pts.some((p) => p.tiltX || p.tiltY)
  return [...(pressure > 1e-6 ? [] : ['pressure']), ...(tilt ? [] : ['tilt'])]
}

export function penWords(missing) {
  const m = missing || []
  if (m.length >= 2) return 'pen pressure or tilt'
  return m[0] === 'pressure' ? 'pen pressure' : m[0] === 'tilt' ? 'pen tilt' : ''
}
