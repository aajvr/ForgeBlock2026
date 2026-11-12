import { CircleAlert, TriangleAlert } from 'lucide-react'
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { Button } from './ui'

// One shared, promise-based confirm dialog (Fluent 2 look).
//
//   const confirm = useConfirm()
//   if (!(await confirm({ title: 'Change role?', message: '…', confirmLabel: 'Change role', danger: true }))) return
//
// Resolves true on Confirm, false on Cancel, Esc or a click outside.
// Focus goes to Cancel when it opens, so Enter never confirms by accident.
const ConfirmContext = createContext(null)

export function ConfirmProvider({ children }) {
  const [dialog, setDialog] = useState(null)
  const resolver = useRef(null)
  const confirm = useCallback(
    (opts) =>
      new Promise((resolve) => {
        resolver.current?.(false)
        resolver.current = resolve
        setDialog(typeof opts === 'string' ? { message: opts } : opts)
      }),
    [],
  )
  const close = useCallback((value) => {
    resolver.current?.(value)
    resolver.current = null
    setDialog(null)
  }, [])
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {dialog && <ConfirmModal {...dialog} onAnswer={close} />}
    </ConfirmContext.Provider>
  )
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error('useConfirm() needs <ConfirmProvider> above it')
  return ctx
}

function ConfirmModal({ title = 'Are you sure?', message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false, icon, onAnswer }) {
  const cancelRef = useRef(null)
  const Icon = icon || (danger ? TriangleAlert : CircleAlert)
  useEffect(() => {
    cancelRef.current?.focus()
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onAnswer(false)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onAnswer])
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/40 p-4" onMouseDown={() => onAnswer(false)}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-message"
        className="w-full max-w-md rounded-2xl bg-white shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex gap-3 p-5">
          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${danger ? 'bg-bad-50 text-bad-600' : 'bg-brand-50 text-brand-600'}`}>
            <Icon className="h-5 w-5" />
          </span>
          <div className="min-w-0 pt-0.5">
            <h3 id="confirm-title" className="font-semibold text-slate-900">{title}</h3>
            {message && <div id="confirm-message" className="mt-1 text-[15px] text-slate-600">{message}</div>}
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
          <Button ref={cancelRef} variant="secondary" onClick={() => onAnswer(false)}>{cancelLabel}</Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={() => onAnswer(true)}>{confirmLabel}</Button>
        </div>
      </div>
    </div>
  )
}
