import { Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../auth'
import { clerkSessionToken, clerkSignOut, finishClerkRedirect } from '../clerk'
import Brand from '../components/Brand'
import { Alert } from '../components/ui'
import { homeFor } from './SignIn'

// Microsoft / Google through Clerk. Clerk returns to /auth/sso-callback
// (finishes its sign-in) and then to /auth/callback, where Clerk's session
// token is exchanged once for a ForgeBlock session. The backend accepts it
// only for an email an admin already registered.
export default function AuthCallback({ step = 'exchange' }) {
  const { signInWithProvider } = useAuth()
  const navigate = useNavigate()
  const [error, setError] = useState('')
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    const fail = (e) => {
      clerkSignOut()
      setError(e?.errors?.[0]?.longMessage || e?.message || 'The sign-in was cancelled or did not finish. Please try again.')
    }
    const run = async () => {
      const providers = await api.get('/api/auth/providers')
      if (!providers?.enabled) throw new Error('Microsoft and Google sign-in are not set up.')
      if (step === 'sso') {
        await finishClerkRedirect(providers) // redirects on to /auth/callback
        return
      }
      const token = await clerkSessionToken(providers)
      if (!token) throw new Error('The sign-in was cancelled or did not finish. Please try again.')
      try {
        const u = await signInWithProvider(token)
        navigate(homeFor(u), { replace: true })
      } finally {
        clerkSignOut()
      }
    }
    run().catch(fail)
  }, [navigate, signInWithProvider, step])

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <Brand />
        {error ? (
          <>
            <Alert className="mt-6">{error}</Alert>
            <Link to="/signin" className="mt-4 inline-block text-sm font-medium text-brand-700 hover:underline">Back to sign in</Link>
          </>
        ) : (
          <div className="mt-6 flex items-center gap-2 text-slate-600">
            <Loader2 className="h-4 w-4 animate-spin" /> Finishing sign-in…
          </div>
        )}
      </div>
    </div>
  )
}
