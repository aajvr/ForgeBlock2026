import { Compass, KeyRound, LogIn, Signature, User } from 'lucide-react'
import { useState } from 'react'
import { api } from '../api'
import { useAuth } from '../auth'
import { Alert, Avatar, Button, Card, Modal, PageHeader, fmtDate } from '../components/ui'
import { PasswordForm } from './ChangePassword'

export default function Profile() {
  const { user, setTourOpen } = useAuth()
  const [done, setDone] = useState('')
  const [requested, setRequested] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const rows = [
    ['Email', user.email],
    ['Role', user.role_label],
    ['Account code', user.account_code || '-'],
    ...(user.client_code ? [['Client record', user.client_code]] : []),
    ['Last sign-in', fmtDate(user.last_login)],
    ...(user.study_mode ? [['Research-use terms', user.research_use_accepted_at ? `Accepted ${fmtDate(user.research_use_accepted_at)}` : '-']] : []),
    ...(user.study_mode && user.is_test_account ? [['Account type', 'Evaluation account']] : []),
  ]
  return (
    <>
      <PageHeader title="Profile" description="Your account details, how you sign in, and your password." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card icon={User} title="Account" data-tour="profile-account">
          <div className="mb-5 flex items-center gap-4">
            <Avatar name={user.full_name} role={user.role} size="h-14 w-14 text-lg" />
            <div>
              <div className="text-lg font-semibold">{user.full_name}</div>
              <div className="text-sm text-slate-500">{user.role_label}</div>
            </div>
          </div>
          <dl className="space-y-3 text-[15px]">
            {rows.map(([k, v]) => (
              <div key={k} className="grid grid-cols-[150px_1fr] gap-2">
                <dt className="text-slate-500">{k}</dt>
                <dd className="break-all font-medium">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-sm text-slate-500">To change your name, email or role, ask your administrator.</p>
        </Card>
        <div className="space-y-6">
          <Card icon={LogIn} title="How you sign in">
            <div className="flex items-start gap-3 text-[15px]">
              <LogIn className="mt-0.5 h-5 w-5 text-brand-600" />
              <div>
                <div className="font-medium">Last signed in with {user.auth_provider_label || 'email and password'}</div>
                <p className="mt-1 text-sm text-slate-600">
                  You can sign in with your email and password, or with Microsoft or Google when your administrator has turned them on. They work only
                  with the email above, {user.email}.
                </p>
              </div>
            </div>
          </Card>
          <Card icon={Compass} title="Guided tour">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-slate-600">See the short tour of your workspace again.</p>
              <Button variant="secondary" onClick={() => setTourOpen('full')}><Compass className="h-4 w-4" /> Replay the tour</Button>
            </div>
          </Card>
        </div>
        <Card icon={KeyRound} title="Change password">
          {done && <Alert kind="success" className="mb-4">{done}</Alert>}
          <PasswordForm onDone={() => setDone('Your password was changed.')} />
        </Card>
        {user.role === 'client' && (
          <Card icon={Signature} title="Your signature data" subtitle="You can ask for your signatures on file to be deleted." data-tour="profile-data">
            <p className="text-sm text-slate-600">
              Deleting removes your reference signatures and stored images. Screening records keep only their hashes in the ledger so the chain stays
              valid; they contain no images.
            </p>
            {requested ? (
              <Alert kind="success" className="mt-4">Your request was sent to the administrator.</Alert>
            ) : (
              <Button variant="danger" className="mt-4" onClick={() => setConfirmDelete(true)}>Request deletion</Button>
            )}
          </Card>
        )}
      </div>
      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Ask for your signature data to be deleted?">
        <p className="text-[15px] text-slate-700">Your administrator will delete your signatures on file. This cannot be undone once it is done.</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirmDelete(false)}>Cancel</Button>
          <Button variant="danger" onClick={async () => { await api.post('/api/me/request-deletion'); setRequested(true); setConfirmDelete(false) }}>Send request</Button>
        </div>
      </Modal>
    </>
  )
}
