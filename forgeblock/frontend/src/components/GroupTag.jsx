import { groupColour } from './groupColors'

// A small coloured pill for a client group; the same group always gets the same colour.
export default function GroupTag({ id, name, className = '' }) {
  const [c] = groupColour(id)
  return (
    <span
      className={`inline-flex max-w-full items-center gap-1.5 truncate rounded-[8px] px-2 py-0.5 text-xs font-semibold ${className}`}
      style={{ color: c, background: `${c}1a` }}
      title={name ? `Group: ${name}` : 'No group'}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: c }} />
      <span className="truncate">{name || 'No group'}</span>
    </span>
  )
}
