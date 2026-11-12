import { Check, ChevronDown, Search, X } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'

// A searchable dropdown (combobox) for filters.
//   options: [{ value, label, sub?, prefix? (node), keywords? }]
//   value '' means the "any" option (anyLabel).
//   tabs: optional [{ value, label }] shown above the list; an option shows under
//   a tab when its `group` matches. Options with `tabOnly` show only under their tab.
export function Combobox({ label, value, onChange, options, anyLabel = 'Any', placeholder = 'Search…', className = '', extra, tabs }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [tab, setTab] = useState('')
  const [active, setActive] = useState(0)
  const ref = useRef(null)
  const listRef = useRef(null)
  const id = useId()
  const all = useMemo(() => [{ value: '', label: anyLabel }, ...(extra || []), ...options], [anyLabel, extra, options])
  const shown = useMemo(() => {
    const inTab = all.filter((o) => o.value === '' || (tab ? o.group === tab : !o.tabOnly))
    const t = q.trim().toLowerCase()
    if (!t) return inTab
    return inTab.filter((o) => o.value !== '' && `${o.label} ${o.sub || ''} ${o.keywords || ''}`.toLowerCase().includes(t))
  }, [all, q, tab])
  const current = all.find((o) => String(o.value) === String(value)) || all[0]

  useEffect(() => {
    if (!open) return
    const close = (e) => !ref.current?.contains(e.target) && setOpen(false)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  useEffect(() => setActive(0), [q, open, tab])
  // Open on the tab of the current choice.
  useEffect(() => {
    if (open && tabs) setTab(current.group && tabs.some((t) => t.value === current.group) ? current.group : '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const pick = (o) => {
    onChange(o.value === '' ? '' : String(o.value))
    setOpen(false)
    setQ('')
  }
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, shown.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); if (shown[active]) pick(shown[active]) }
    else if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) }
  }

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${current.label}`}
        onClick={() => setOpen((o) => !o)}
        className={`flex w-full min-w-0 items-center gap-2 rounded-[10px] border bg-white px-3 py-2 text-left text-sm outline-none transition hover:border-slate-300 focus-visible:border-brand-600 focus-visible:ring-2 focus-visible:ring-brand-100 ${value ? 'border-brand-300 text-ink' : 'border-[#dde3ec] text-slate-600'}`}
      >
        <span className="shrink-0 text-slate-500">{label}:</span>
        <span className="min-w-0 flex-1 truncate font-medium">{current.label}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute left-0 z-40 mt-1 w-80 max-w-[calc(100vw-2rem)] rounded-[12px] border border-line bg-white p-1 shadow-xl">
          {tabs && (
            <div role="tablist" aria-label={`${label} by role`} className="flex flex-wrap gap-1 p-1">
              {[{ value: '', label: 'All' }, ...tabs].map((t) => (
                <button
                  key={t.value}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.value}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setTab(t.value)}
                  className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${tab === t.value ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}
          <div className="relative p-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={onKey}
              placeholder={placeholder}
              role="combobox"
              aria-controls={id}
              aria-expanded
              aria-activedescendant={shown[active] ? `${id}-${active}` : undefined}
              className="w-full rounded-[8px] border border-[#dde3ec] py-1.5 pl-8 pr-2 text-sm outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-100"
            />
          </div>
          <ul ref={listRef} id={id} role="listbox" aria-label={label} className="max-h-64 overflow-y-auto py-1">
            {shown.length === 0 && <li className="px-3 py-2 text-sm text-slate-500">No matches.</li>}
            {shown.map((o, i) => {
              const selected = String(o.value) === String(value)
              return (
                <li
                  key={`${o.value}`}
                  id={`${id}-${i}`}
                  data-index={i}
                  role="option"
                  aria-selected={selected}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => { e.preventDefault(); pick(o) }}
                  className={`flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm ${i === active ? 'bg-slate-100' : ''}`}
                >
                  {o.prefix}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-slate-900">{o.label}</span>
                    {o.sub && <span className="block truncate text-xs text-slate-500">{o.sub}</span>}
                  </span>
                  {selected && <Check className="h-4 w-4 shrink-0 text-brand-600" />}
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}

// An active filter shown as a removable chip.
export function FilterChip({ label, onRemove }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 py-0.5 pl-2.5 pr-1 text-xs font-medium text-brand-800 ring-1 ring-inset ring-brand-100">
      {label}
      <button type="button" onClick={onRemove} aria-label={`Remove filter ${label}`} className="rounded-full p-0.5 text-brand-600 hover:bg-brand-100 hover:text-brand-800">
        <X className="h-3 w-3" />
      </button>
    </span>
  )
}
