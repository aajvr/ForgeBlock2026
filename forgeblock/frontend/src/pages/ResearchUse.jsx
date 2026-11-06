import { FlaskConical } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../auth'
import Brand from '../components/Brand'
import { Alert, Button } from '../components/ui'
import { homeFor } from './SignIn'

// Shown once, after the first password change (Chapter 3, Section 3.8).
export default function ResearchUse() {
  const { user, signOut, acceptResearchUse } = useAuth()
  const navigate = useNavigate()
  const [terms, setTerms] = useState([])
  const [agree, setAgree] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    api.get('/api/auth/research-use').then((d) => setTerms(d.terms)).catch((e) => setError(e.message))
  }, [])
  if (!user) return <Navigate to="/signin" replace />
  if (user.must_change_password || user.research_use_accepted) return <Navigate to={homeFor(user)} replace />

  const accept = async () => {
    setBusy(true)
    setError('')
    try {
      navigate(homeFor(await acceptResearchUse()))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6 py-10">
      <div className="w-full max-w-xl">
        <div className="mb-6">
          <Brand />
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          <div className="mb-1 flex items-center gap-2 text-brand-700">
            <FlaskConical className="h-5 w-5" /> <span className="text-sm font-semibold">Research use only</span>
          </div>
          <h2 className="text-2xl font-semibold tracking-tight">Before you start</h2>
          <p className="mb-5 mt-1 text-sm text-slate-500">
            {user.is_test_account
              ? 'This is a test account for the system evaluation. Please read and accept these terms.'
              : 'Please read and accept these terms to use ForgeBlock.'}
          </p>
          <ol className="list-decimal space-y-3 pl-5 text-sm leading-relaxed text-slate-700">
            {terms.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ol>
          <label className="mt-6 flex items-start gap-2 rounded-lg border border-slate-200 p-3 text-sm">
            <input type="checkbox" className="mt-0.5" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            <span>I have read these terms and will use ForgeBlock only as described.</span>
          </label>
          <Alert className="mt-3">{error}</Alert>
          <div className="mt-5 flex items-center gap-3">
            <Button onClick={accept} disabled={!agree || !terms.length} loading={busy}>Accept and continue</Button>
            <button onClick={signOut} className="text-sm text-slate-500 hover:underline">Sign out</button>
          </div>
        </div>
      </div>
    </div>
  )
}
