import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './auth'
import Layout from './components/Layout'
import { Spinner } from './components/ui'
import Audit from './pages/admin/Audit'
import Dashboard from './pages/admin/Dashboard'
import Ledger from './pages/admin/Ledger'
import Settings from './pages/admin/Settings'
import SystemPage from './pages/admin/System'
import Users from './pages/admin/Users'
import AuthCallback from './pages/AuthCallback'
import CaseDetail from './pages/CaseDetail'
import Cases from './pages/Cases'
import ChangePassword from './pages/ChangePassword'
import ClientHome from './pages/ClientHome'
import Clients, { ClientDetail } from './pages/Clients'
import ExaminerHome from './pages/ExaminerHome'
import Help from './pages/Help'
import Landing from './pages/Landing'
import Profile from './pages/Profile'
import Record from './pages/Record'
import Records from './pages/Records'
import ResearchUse from './pages/ResearchUse'
import Screen from './pages/Screen'
import SignIn, { homeFor } from './pages/SignIn'

function Protected({ children, roles }) {
  const { user, loading } = useAuth()
  if (loading) return <Spinner />
  if (!user) return <Navigate to="/signin" replace />
  if (user.must_change_password) return <Navigate to="/change-password" replace />
  if (user.study_mode && !user.research_use_accepted) return <Navigate to="/research-use" replace />
  if (roles && !roles.includes(user.role)) return <Navigate to={homeFor(user)} replace />
  return children
}

const STAFF = ['admin', 'examiner']

function Home() {
  const { user } = useAuth()
  return <Navigate to={homeFor(user)} replace />
}

export default function App() {
  const staff = (el) => <Protected roles={STAFF}>{el}</Protected>
  const admin = (el) => <Protected roles={['admin']}>{el}</Protected>
  const to = (path) => <Navigate to={path} replace />
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/signin" element={<SignIn />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route path="/auth/sso-callback" element={<AuthCallback step="sso" />} />
      <Route path="/change-password" element={<ChangePassword />} />
      <Route path="/research-use" element={<ResearchUse />} />
      <Route path="/app" element={<Protected><Layout /></Protected>}>
        <Route index element={<Home />} />
        <Route path="home" element={staff(<ExaminerHome />)} />
        <Route path="cases" element={staff(<Cases />)} />
        <Route path="cases/:id" element={staff(<CaseDetail />)} />
        <Route path="clients" element={staff(<Clients />)} />
        <Route path="clients/:id" element={staff(<ClientDetail />)} />
        <Route path="screen" element={staff(<Screen />)} />
        <Route path="records" element={staff(<Records />)} />
        <Route path="records/:id" element={<Record />} />
        <Route path="me" element={<Protected roles={['client']}><ClientHome /></Protected>} />
        <Route path="profile" element={<Profile />} />
        <Route path="help" element={<Help />} />
        <Route path="admin" element={admin(<Dashboard />)} />
        <Route path="admin/users" element={admin(<Users />)} />
        <Route path="admin/ledger" element={admin(<Ledger />)} />
        <Route path="admin/evaluation" element={to('/app/admin')} />
        <Route path="admin/settings" element={admin(<Settings />)} />
        <Route path="admin/system" element={admin(<SystemPage />)} />
        <Route path="admin/audit" element={admin(<Audit />)} />
        {/* Pages merged or removed in v7 */}
        <Route path="review" element={to('/app/cases')} />
        <Route path="compare" element={to('/app/screen')} />
        <Route path="checks" element={to('/app/records')} />
        <Route path="admin/reports" element={to('/app/records')} />
        <Route path="admin/performance" element={to('/app/admin')} />
        <Route path="admin/model" element={to('/app/admin/system')} />
        <Route path="admin/status" element={to('/app/admin/system')} />
        <Route path="admin/retention" element={to('/app/admin/settings')} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
