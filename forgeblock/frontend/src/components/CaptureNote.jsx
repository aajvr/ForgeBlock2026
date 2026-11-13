import { useState } from 'react'
import { ChevronDown, Ruler } from 'lucide-react'

// v8.22: the questioned signature was captured very differently from the client's
// references (its size is far off). Display only: the result is not changed.
const times = (x) => (x >= 10 ? Math.round(x) : Math.round(x * 10) / 10)

// A quiet one-line strip that sits under the signature pair; details on demand.
export function CaptureNote({ r, className = '' }) {
  const [open, setOpen] = useState(false)
  const c = r.analysis?.capture
  if (r.modality !== 'static' || !c?.flagged) return null
  const larger = c.size_ratio > 1
  const factor = times(larger ? c.size_ratio : 1 / c.size_ratio)
  const sm = r.analysis?.size_match
  const resized = sm?.enabled && sm.scale !== 1
  return (
    <div className={`rounded-[10px] border border-[#f4d49c] bg-warn-50 px-3 py-2 text-[13px] text-[#6b3f00] ${className}`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Ruler className="h-4 w-4 shrink-0 text-warn-500" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="font-semibold">Captured at a different size:</span> about {factor}× {larger ? 'larger' : 'smaller'} than the references
          {resized ? `, resized to ${times(sm.scale)}× before screening.` : '.'}
        </span>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="inline-flex items-center gap-1 font-medium underline underline-offset-2 hover:no-underline"
        >
          Why this matters
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
        </button>
      </div>
      {open && (
        <div className="mt-2 space-y-1.5 border-t border-[#f4d49c] pt-2 pl-6">
          <p>
            The questioned signature is {c.questioned_width} px wide; the references are about {c.reference_width} px. When captures differ
            this much, genuine signatures can score lower than they should, so weigh this result with extra care.
          </p>
          <p className="opacity-90">
            For a fairer comparison, capture the document the same way the references were captured (the in-app camera at a similar
            distance), or add references captured this way.
          </p>
        </div>
      )}
    </div>
  )
}

// One line in the details: how the questioned image was sized for this screening.
export function SizeMatchLine({ r }) {
  const sm = r.analysis?.size_match
  if (r.modality !== 'static' || !sm) return null
  return (
    <p className="text-[13px] text-muted">
      Size matching: {sm.enabled ? (sm.scale !== 1 ? `on, resized to ${times(sm.scale)}× to match the references` : 'on, no resize needed') : 'off'}.
    </p>
  )
}
