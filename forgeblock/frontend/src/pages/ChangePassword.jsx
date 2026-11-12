import { ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'
import Brand from '../components/Brand'
import { Alert, Button, Field, Input } from '../components/ui'
import { homeFor } from './SignIn'

export function PasswordForm({ onDone, submitLabel = 'Save new password' }) {
  const { changePassword } = useAuth()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e) => {
    e.preventDefault()
    if (next !== again) return setError('The new passwords do not match.')
    setBusy(true)
    setError('')
    try {
      const u = await changePassword(current, next)
      setCurrent('')
      setNext('')
      setAgain('')
      onDone?.(u)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Current password">
        <Input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
      </Field>
      <Field label="New password" hint="At least 8 characters, with letters and numbers.">
        <Input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" minLength={8} required />
      </Field>
      <Field label="Repeat new password">
        <Input type="password" value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" required />
      </Field>
      <Alert>{error}</Alert>
      <Button loading={busy}>{submitLabel}</Button>
    </form>
  )
}

export default function ChangePassword() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  if (!user) return <Navigate to="/signin" replace />
  if (!user.must_change_password) return <Navigate to={homeFor(user)} replace />
  return (
    <div data-role={user.role} className="app-shell relative min-h-screen overflow-x-clip bg-page px-6 py-10">
      {/* The role's colour band, as in the app; the account pages sit on it. */}
      <div className="app-band pointer-events-none absolute inset-x-0 top-0 h-[440px]" aria-hidden="true" />
      <div className="relative mx-auto w-full max-w-md pt-[6vh]">
        <div className="mb-6">
          <Brand light />
        </div>
        <div className="rounded-[16px] border border-line bg-white p-6 shadow-raised sm:p-8">
          <div className="mb-1 flex items-center gap-2 text-brand-700">
            <ShieldCheck className="h-5 w-5" /> <span className="text-sm font-semibold">First sign-in</span>
          </div>
          <h2 className="text-[26px] font-bold leading-tight tracking-[-0.01em] text-ink">Choose your own password</h2>
          <p className="mb-6 mt-1 text-sm text-muted">Hi {user.full_name.split(' ')[0]}, replace the temporary password your administrator gave you.</p>
          <PasswordForm onDone={(u) => navigate(homeFor(u))} submitLabel="Save and continue" />
          <button onClick={signOut} className="mt-4 text-sm text-slate-500 hover:underline">Sign out</button>
        </div>
      </div>
    </div>
  )
}
