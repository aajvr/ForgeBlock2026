import { ArrowLeft, ShieldAlert, ShieldCheck } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../auth'
import ResultView, { KeyFacts, LedgerBlockValue, PenDataNote, ResultHeader } from '../components/ResultView'
import { Alert, Badge, FindingBadge, PageHeader, Spinner, fmtDate } from '../components/ui'

// What a client sees of a screening on a document in their name: the result,
// the examiner and their decision, and the ledger receipt. Not the model's
// scores, thresholds or the signature images.
function ClientResult({ r }) {
  const decided = r.finding?.finding
  const decision = decided ? <FindingBadge value={decided} />
    : r.case_code ? <Badge tone="amber">Being examined</Badge>
      : r.screening_result === 'consistent' ? 'Not needed' : 'Not reviewed'
  return (
    <div className="space-y-5">
      <PenDataNote r={r} />
      <div className="grid items-stretch gap-5 lg:grid-cols-[1.35fr_1fr]">
      <ResultHeader r={r} whose="your" client />
      <KeyFacts facts={[
        ['Client', r.client_name || r.client_code || '-'],
        ['Examiner’s decision', decision],
        ['Date', fmtDate(r.created_at)],
        ['Ledger block', <LedgerBlockValue key="block" r={r} />],
        ['Module', r.modality === 'static' ? 'Static (scanned signature)' : 'Dynamic (signed on a tablet)'],
        ['Document', r.document_ref || r.case_code || 'Not given'],
        ['Screened by', r.examiner_name || '-'],
      ]}>
        <p className="border-t border-track pt-3.5 text-[12.5px] text-muted">The screening result supports the examiner. The examiner’s decision is final.</p>
      </KeyFacts>
      </div>
      <section className="flex items-start gap-3.5 rounded-[16px] border border-edge bg-white px-5 py-5 shadow-card sm:px-[22px]" aria-label="Ledger proof">
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] ${r.integrity?.valid ? 'bg-ok-100 text-ok-600' : 'bg-bad-100 text-bad-600'}`}>
          {r.integrity?.valid ? <ShieldCheck className="h-5 w-5" /> : <ShieldAlert className="h-5 w-5" />}
        </span>
        <div className="min-w-0">
          <h2 className="text-[17px] font-semibold text-ink">Ledger proof</h2>
          <p className="mt-1 text-sm text-slate-700">
            {r.integrity?.valid
              ? `This screening is sealed in ledger block #${r.block?.block_index}. The record has not been changed since it was made.`
              : 'This record could not be verified against the ledger. Please report a problem.'}
          </p>
          <p className="mt-2 text-[12.5px] text-muted">Anyone can check the receipt code on the sign-in page.</p>
        </div>
      </section>
      <p className="mx-0.5 text-[13px] text-muted">{r.disclaimer}</p>
    </div>
  )
}

export default function Record() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [r, setR] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    setR(null)
    api.get(`/api/verifications/${id}`).then(setR).catch((e) => setError(e.message))
  }, [id])
  if (error) return <Alert>{error}</Alert>
  if (!r) return <Spinner label="Loading result…" />
  return (
    <>
      <button onClick={() => navigate(-1)} className="mb-2.5 inline-flex items-center gap-1.5 text-[13.5px] font-medium text-white/85 hover:text-white">
        <ArrowLeft className="h-4 w-4" /> Back
      </button>
      <PageHeader
        eyebrow="Screening record"
        title={`${r.modality === 'static' ? 'Static' : 'Dynamic'} screening`}
        description={r.case_code ? undefined : r.document_ref || undefined}
      >
      </PageHeader>
      {user.role === 'client' ? <ClientResult r={r} /> : <ResultView result={r} />}
    </>
  )
}
