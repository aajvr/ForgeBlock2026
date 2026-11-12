import { groupColour } from './groupColors'

// A small coloured pill for a client group; the same group always gets the same colour.
export default function GroupTag({ id, name, className = '' }) {
  const [c] = groupColour(id)
  return (
    <span
      className={`inline-flex max-w-full items-center gap-1.5 truncate rounded-full px-2 py-0.5 text-xs font-medium ${className}`}
      style={{ color: c, background: `${c}14`, boxShadow: `inset 0 0 0 1px ${c}33` }}
      title={name ? `Group: ${name}` : 'No group'}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: c }} />
      <span className="truncate">{name || 'No group'}</span>
    </span>
  )
}
