// ForgeBlock wordmark: a signature stroke that locks into a small block.
export function BrandMark({ className = 'h-9 w-9', light }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="8" fill={light ? '#fff' : '#0F6CBD'} />
      <path
        d="M6 20.5c2.2-6.5 3.6-8 5-4.6s2.6 4.4 4.2.2 3-5.4 4.6-.6c.9 2.6 1.6 3.4 2.6 3.4"
        fill="none"
        stroke={light ? '#0F6CBD' : '#fff'}
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="22.2" y="17.4" width="4.6" height="4.6" rx="1" fill={light ? '#0F6CBD' : '#fff'} />
    </svg>
  )
}

export default function Brand({ light, tagline = true }) {
  return (
    <div>
      <div className="flex items-center gap-2.5">
        <BrandMark light={light} />
        <span className={`text-xl font-semibold tracking-tight ${light ? 'text-white' : 'text-slate-900'}`}>ForgeBlock</span>
      </div>
      {tagline && (
        <div className={`mt-2 text-[12px] font-semibold uppercase tracking-[0.18em] ${light ? 'text-white/70' : 'text-slate-500'}`}>
          Signature screening
        </div>
      )}
    </div>
  )
}
