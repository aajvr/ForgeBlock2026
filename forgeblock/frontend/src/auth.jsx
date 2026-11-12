import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { api, getToken, setToken } from './api'

const AuthContext = createContext(null)
const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'pointerdown', 'scroll']

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(!!getToken())
  const [notice, setNotice] = useState('')
  // Which guided tour is open: false, 'full' (first sign-in, Help Center, Profile)
  // or a page's mini-tour ('screen', 'enroll').
  const [tourOpen, setTourOpen] = useState(false)
  const lastActive = useRef(Date.now())

  useEffect(() => {
    if (!getToken()) return
    api.get('/api/auth/me').then(setUser).catch(() => setToken(null)).finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    const onLogout = (e) => {
      setUser(null)
      if (e.detail) setNotice(e.detail)
    }
    window.addEventListener('forgeblock:logout', onLogout)
    return () => window.removeEventListener('forgeblock:logout', onLogout)
  }, [])

  // Sign out after the idle timeout (the server enforces it too).
  useEffect(() => {
    if (!user) return
    const minutes = user.idle_timeout_minutes || 15
    const touch = () => (lastActive.current = Date.now())
    ACTIVITY_EVENTS.forEach((ev) => window.addEventListener(ev, touch, { passive: true }))
    const timer = setInterval(() => {
      if (Date.now() - lastActive.current > minutes * 60 * 1000) {
        setToken(null)
        setUser(null)
        setNotice(`You were signed out after ${minutes} minutes without activity.`)
      }
    }, 15000)
    return () => {
      ACTIVITY_EVENTS.forEach((ev) => window.removeEventListener(ev, touch))
      clearInterval(timer)
    }
  }, [user])

  const start = useCallback(({ token, user, idle_timeout_minutes }) => {
    setToken(token)
    lastActive.current = Date.now()
    setNotice('')
    const u = { ...user, idle_timeout_minutes }
    setUser(u)
    return u
  }, [])

  const signIn = useCallback(async (email, password) => start(await api.post('/api/auth/login', { email, password })), [start])

  // Microsoft or Google: the Clerk session token is exchanged for a
  // ForgeBlock session. Only emails registered by an admin are accepted.
  const signInWithProvider = useCallback(async (access_token) => start(await api.post('/api/auth/oauth', { access_token })), [start])

  const changePassword = useCallback(async (current_password, new_password) => {
    const u = await api.post('/api/auth/change-password', { current_password, new_password })
    setUser((prev) => ({ ...prev, ...u }))
    return u
  }, [])

  const acceptResearchUse = useCallback(async () => {
    const u = await api.post('/api/auth/research-use/accept')
    setUser((prev) => ({ ...prev, ...u }))
    return u
  }, [])

  const finishTour = useCallback(async () => {
    setTourOpen(false)
    try {
      const u = await api.post('/api/auth/tour', { done: true })
      setUser((prev) => ({ ...prev, ...u }))
    } catch {
      setUser((prev) => (prev ? { ...prev, tour_completed: true } : prev))
    }
  }, [])

  const signOut = useCallback(() => {
    setToken(null)
    setUser(null)
  }, [])

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        notice,
        setNotice,
        signIn,
        signInWithProvider,
        signOut,
        changePassword,
        acceptResearchUse,
        tourOpen,
        setTourOpen,
        finishTour,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
