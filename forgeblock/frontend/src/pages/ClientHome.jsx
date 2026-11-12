import { FileSignature, MessageSquareWarning, ScanSearch, UserCheck } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../auth'
import { Alert, Badge, Button, Card, Empty, FindingBadge, Modal, PageHeader, ScreeningBadge, Spinner, Stat, StrengthBadge, Table, Textarea, fmtDate, td } from '../components/ui'

export default function ClientHome() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [c, setC] = useState(null)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [sent, setSent] = useState(false)
  useEffect(() => {
    api.get('/api/me/client').then(setC).catch((e) => setError(e.message))
  }, [])
  if (error) return <Alert>{error}</Alert>
  if (!c) return <Spinner />
  return (
    <>
      <PageHeader eyebrow={`Client · ${c.client_code}`} title={`Hello, ${user.full_name.split(' ')[0]}`} description="Your signatures on file and every screening made on documents in your name.">
        <Button variant="secondary" onClick={() => setOpen(true)}>
          <MessageSquareWarning className="h-4 w-4" /> Report a problem
        </Button>
      </PageHeader>
      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4" data-tour="home-stats">
        <Stat label="Your examiner" value={<span className="block truncate text-[22px] leading-[36px] tracking-[-0.01em]">{c.assigned_examiner ? c.assigned_examiner.full_name : 'Not assigned yet'}</span>}
          hint={c.assigned_examiner ? `${c.assigned_examiner.account_code}${c.group_name ? ` · ${c.group_name}` : ''}` : undefined} icon={UserCheck} />
        <Stat label="Static signatures on file" value={c.static_count} hint={<StrengthBadge strength={c.static_strength} />} icon={FileSignature} tone="sky" />
        <Stat label="Dynamic signatures on file" value={c.dynamic_count} hint={<StrengthBadge strength={c.dynamic_strength} />} icon={FileSignature} tone="violet" />
        <Stat label="Screenings on your documents" value={c.checks.length} icon={ScanSearch} tone="green" />
      </div>
      <Card data-tour="client-screenings" title="Screenings on your documents" subtitle="Click a screening to see its details. The screening result supports the examiner; the examiner’s decision is final." bodyClass="p-0">
        {c.checks.length === 0 ? (
          <Empty>No documents in your name have been screened.</Empty>
        ) : (
          <Table head={['Document', 'Module', 'Screening', 'Examiner', 'Examiner’s decision', 'Receipt', 'Date']}>
            {c.checks.map((k) => (
              <tr
                key={k.id}
                tabIndex={0}
                aria-label={`Open the screening ${k.receipt_code}`}
                className="cursor-pointer outline-none hover:bg-[#f7fafd] focus-visible:bg-brand-50"
                onClick={() => navigate(`/app/records/${k.id}`)}
                onKeyDown={(e) => e.key === 'Enter' && navigate(`/app/records/${k.id}`)}
              >
                <td className={`${td} font-medium text-ink`}>{k.document || <span className="font-normal text-muted">Screening</span>}{k.case_code && <span className="ml-1 text-xs font-normal text-muted">({k.case_code})</span>}</td>
                <td className={td}><Badge tone={k.modality === 'static' ? 'blue' : 'violet'}>{k.modality === 'static' ? 'Static' : 'Dynamic'}</Badge></td>
                <td className={td}><ScreeningBadge value={k.screening_result} /></td>
                <td className={`${td} whitespace-nowrap`}>{k.examiner_name || '-'}</td>
                <td className={td}>{k.case_code ? (k.finding && k.case_status !== 'open' ? <FindingBadge value={k.finding} /> : <span className="text-sm text-slate-500">Being examined</span>) : <span className="text-sm text-slate-400">{k.screening_result === 'consistent' ? 'Not needed' : 'Not reviewed'}</span>}</td>
                <td className={`${td} whitespace-nowrap font-mono text-[13px] text-ink`}>{k.receipt_code}</td>
                <td className={`${td} whitespace-nowrap text-muted`}>{fmtDate(k.created_at)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <Modal open={open} onClose={() => setOpen(false)} title="Report a problem">
        {sent ? (
          <Alert kind="success">Thank you. An administrator will look into it.</Alert>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">For example: you did not sign a document listed here, or a detail is wrong.</p>
            <Textarea value={text} onChange={(e) => setText(e.target.value)} />
            <Button disabled={text.trim().length < 3} onClick={async () => { await api.post('/api/me/report-problem', { text }); setSent(true) }}>Send</Button>
          </div>
        )}
      </Modal>
    </>
  )
}
