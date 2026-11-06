import { ArrowLeft, ShieldAlert, ShieldCheck } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../auth'
import ResultView, { DetailsToggle, KeyFacts, LedgerBlockValue, ResultHeader } from '../components/ResultView'
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
      <ResultHeader r={r} whose="your" />
      <KeyFacts facts={[
        ['Client', r.client_name || r.client_code || '-'],
        ['Examiner’s decision', decision],
        ['Date', fmtDate(r.created_at)],
        ['Ledger block', <LedgerBlockValue key="block" r={r} />],
        ['Module', r.modality === 'static' ? 'Static (scanned signature)' : 'Dynamic (signed on a tablet)'],
        ['Document', r.document_ref || r.case_code || 'Not given'],
        ['Screened by', r.examiner_name || '-'],
      ]}>
        <p className="mt-5 border-t border-slate-100 pt-4 text-xs text-slate-500">The screening result supports the examiner. The examiner’s decision is final.</p>
      </KeyFacts>
      <DetailsToggle tabs={[{ value: 'ledger', label: 'Ledger proof' }]}>
        {() => (
          <>
            <div className="flex items-start gap-3">
              {r.integrity?.valid ? <ShieldCheck className="h-6 w-6 shrink-0 text-ok-600" /> : <ShieldAlert className="h-6 w-6 shrink-0 text-bad-600" />}
              <p className="text-sm text-slate-700">
                {r.integrity?.valid
                  ? `This screening is sealed in ledger block #${r.block?.block_index}. The record has not been changed since it was made.`
                  : 'This record could not be verified against the ledger. Please report a problem.'}
              </p>
            </div>
            <p className="mt-3 text-xs text-slate-500">Anyone can check the receipt code on the sign-in page.</p>
          </>
        )}
      </DetailsToggle>
      <p className="text-sm text-slate-500">{r.disclaimer}</p>
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
      <button onClick={() => navigate(-1)} className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
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
