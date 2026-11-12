import Logo from './Logo'

// The logo with the "Signature screening" tagline, for the sign-in and
// account pages. `light` is for brand-blue backgrounds (white logo).
export default function Brand({ light, variant, tagline = true }) {
  return (
    <div>
      <Logo variant={light ? 'white' : variant || 'blue'} size={44} />
      {tagline && (
        <div className={`mt-2 text-[12px] font-semibold uppercase tracking-[0.18em] ${light ? 'text-white/70' : 'text-slate-500'}`}>
          Signature screening
        </div>
      )}
    </div>
  )
}
