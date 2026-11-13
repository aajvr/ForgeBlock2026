import { CircleHelp, FlaskConical, Link2, RotateCcw, ShieldAlert, ShieldCheck, Timer } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../api'
import { Alert, Badge, Button, Card, InfoTip, PageHeader, Spinner, fmtDate, shortHash } from '../../components/ui'

const TIPS = {
  record: 'A SHA-256 fingerprint of the sealed record. It changes if the record is changed.',
  block: 'A SHA-256 fingerprint of this block, including the record hash and the previous hash.',
  previous: 'The block hash of the block before this one. This is what links the chain together.',
  valid: 'Yes when every hash was recomputed and matches, and every block points to the block before it.',
}

function HashField({ label, tip, value, strong, right }) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1 font-sans text-[11.5px] uppercase tracking-wide text-slate-400">
        {label} <InfoTip label={`What is ${label.toLowerCase()}?`} align={right ? 'right' : 'left'}>{tip}</InfoTip>
      </dt>
      <dd className={`mt-0.5 truncate ${strong ? 'text-slate-900' : ''}`}>{shortHash(value)}</dd>
    </div>
  )
}

// The record summary reads "Static screening · FB-XXXX-XXXX" or "Finding: Genuine · CS-0001".
function splitSummary(b) {
  const [title, code] = b.summary.split(' · ')
  return { title, code, codeLabel: b.record_type === 'finding' ? 'Case' : 'Receipt' }
}

function LedgerIntro({ data, check }) {
  const auto = data.last_auto_check
  const valid = check ? check.valid : auto?.valid
  const items = [
    { icon: Link2, title: 'What it is', text: 'A SHA-256 hash-linked chain, with one block per screening and per examiner decision.' },
    { icon: ShieldCheck, title: 'Why it matters', text: 'Any change to a past record breaks the chain, and the break is detected.' },
    { icon: Timer, title: 'Last checked automatically', text: auto ? `${fmtDate(auto.checked_at)}: ${auto.valid ? 'intact' : 'FAILED'}.` : 'The daily auto-check has not run yet.' },
  ]
  return (
    <section className="mb-6 rounded-[16px] border border-edge bg-white p-6 shadow-card" data-tour="ledger-check">
      <div className="grid gap-6 md:grid-cols-3">
        {items.map((it) => (
          <div key={it.title} className="flex gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] bg-[var(--role-soft)] text-[var(--role-active)]"><it.icon className="h-5 w-5" /></span>
            <div className="min-w-0">
              <h2 className="text-[15px] font-semibold text-ink">{it.title}</h2>
              <p className="mt-0.5 text-sm text-slate-600">{it.text}</p>
            </div>
          </div>
        ))}
      </div>
      <dl className="mt-5 flex flex-wrap gap-x-10 gap-y-3 border-t border-track pt-4 text-sm">
        <div>
          <dt className="flex items-center gap-1 text-slate-500">Chain valid <InfoTip label="What is chain valid?">{TIPS.valid}</InfoTip></dt>
          <dd className={`mt-0.5 flex items-center gap-1.5 text-base font-semibold ${valid === undefined ? 'text-slate-600' : valid ? 'text-ok-700' : 'text-bad-700'}`}>
            {valid === undefined ? <CircleHelp className="h-4 w-4" /> : valid ? <ShieldCheck className="h-4 w-4" /> : <ShieldAlert className="h-4 w-4" />}
            {valid === undefined ? 'Not checked yet' : valid ? 'Yes' : 'No'}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">Chain height</dt>
          <dd className="mt-0.5 text-base font-semibold tabular-nums">{data.chain_height}</dd>
        </div>
      </dl>
    </section>
  )
}

export default function Ledger() {
  const [data, setData] = useState(null)
  const [check, setCheck] = useState(null)
  const [busy, setBusy] = useState(false)
  const [tampered, setTampered] = useState(null) // {log_id, original}
  const [error, setError] = useState('')

  const load = () => api.get('/api/ledger/blocks?limit=60').then(setData)
  useEffect(() => {
    load()
  }, [])

  const validate = async () => {
    setBusy(true)
    try {
      setCheck(await api.get('/api/ledger/validate'))
    } finally {
      setBusy(false)
    }
  }

  const tamper = async (b) => {
    setError('')
    const rec = await api.get(`/api/verifications/${b.verification_log_id}`)
    const to = rec.screening_result === 'inconsistent' ? 'consistent' : 'inconsistent'
    const r = await api.post(`/api/ledger/demo/tamper/${b.verification_log_id}`, { screening_result: to })
    setTampered({ log_id: b.verification_log_id, original: r.changed_from, to })
    await validate()
  }
  const restore = async () => {
    await api.post(`/api/ledger/demo/restore/${tampered.log_id}`, { screening_result: tampered.original })
    setTampered(null)
    await validate()
  }

  if (!data) return <Spinner />
  const bad = new Set((check?.invalid_blocks || []).map((b) => b.block_index))
  const firstBad = check?.first_invalid_block
  const lastVerification = data.blocks.find((b) => b.record_type === 'verification')

  return (
    <>
      <PageHeader title="Ledger">
        <Button onClick={validate} loading={busy}><ShieldCheck className="h-4 w-4" /> Check now</Button>
      </PageHeader>

      <LedgerIntro data={data} check={check} />

      {(check || data.demo_mode) && (
        <div className={`mb-6 grid items-start gap-4 ${check && data.demo_mode ? 'lg:grid-cols-[1fr_380px]' : ''}`}>
          {check && (
            <Card>
              <div className={`flex items-start gap-3 ${check.valid ? 'text-ok-700' : 'text-bad-700'}`}>
                {check.valid ? <ShieldCheck className="mt-0.5 h-6 w-6" /> : <ShieldAlert className="mt-0.5 h-6 w-6" />}
                <div>
                  <div className="text-lg font-semibold">{check.valid ? 'Chain intact' : 'Tampering detected'}</div>
                  <div className="text-sm text-slate-600">
                    {check.blocks_checked} blocks checked · height {check.chain_height} · {fmtDate(check.checked_at)}
                  </div>
                  {!check.valid && (
                    <ul className="mt-2 list-disc pl-5 text-sm">
                      {check.invalid_blocks.map((b) => <li key={b.block_index}>Block #{b.block_index}: {b.issues.join(' ')}</li>)}
                    </ul>
                  )}
                </div>
              </div>
            </Card>
          )}
          {data.demo_mode && (
            <Card icon={FlaskConical} title="Tamper demo">
              <p className="text-sm text-slate-600">Edits a sealed screening directly in the database, bypassing ForgeBlock, so you can show the check catching it. Restore it afterwards.</p>
              <Alert className="mt-3">{error}</Alert>
              <div className="mt-3 flex gap-2">
                {!tampered ? (
                  <Button variant="danger" size="sm" disabled={!lastVerification} onClick={() => tamper(lastVerification)}>Simulate tampering{lastVerification ? ` on block #${lastVerification.block_index}` : ''}</Button>
                ) : (
                  <Button size="sm" onClick={restore}><RotateCcw className="h-3.5 w-3.5" /> Restore original</Button>
                )}
              </div>
              {tampered && <p className="mt-2 text-xs text-bad-700">Changed the screening result from {tampered.original} to {tampered.to}.</p>}
            </Card>
          )}
        </div>
      )}

      <div className="mx-auto max-w-4xl">
        {data.blocks.map((b, i) => {
          const isBad = bad.has(b.block_index)
          const after = firstBad !== null && firstBad !== undefined && b.block_index > firstBad
          const { title, code, codeLabel } = splitSummary(b)
          return (
            <div key={b.block_index}>
              <div className={`rounded-[16px] border bg-white p-4 shadow-card transition hover:shadow-lift sm:p-5 ${isBad ? 'border-bad-600 ring-2 ring-bad-100' : after ? 'border-warn-600' : 'border-edge'}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className={`flex h-10 min-w-10 items-center justify-center rounded-[12px] px-1.5 text-sm font-semibold ${isBad ? 'bg-bad-600 text-white' : 'bg-[var(--role-soft)] text-[var(--role-active)]'}`}>#{b.block_index}</span>
                    <div className="min-w-0">
                      <div className="font-medium">
                        {b.verification_log_id ? <Link to={`/app/records/${b.verification_log_id}`} className="hover:underline">{title}</Link> : title}
                      </div>
                      <div className="text-xs text-slate-500">
                        {fmtDate(b.timestamp)}
                        {code && <> · {codeLabel} <span className="font-mono text-slate-700">{code}</span></>}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={b.record_type === 'finding' ? 'violet' : b.record_type === 'genesis' ? 'gray' : 'blue'}>{b.record_type === 'verification' ? 'screening' : b.record_type === 'finding' ? 'decision' : b.record_type}</Badge>
                    {isBad && <Badge tone="red">Altered</Badge>}
                    {after && !isBad && <Badge tone="amber">After a broken block</Badge>}
                  </div>
                </div>
                <dl className="mt-3 grid gap-3 rounded-[12px] bg-[#f6f8fc] px-3 py-2.5 font-mono text-[12.5px] text-slate-600 sm:grid-cols-3">
                  <HashField label="Block hash" tip={TIPS.block} value={b.block_hash} strong />
                  <HashField label="Previous hash" tip={TIPS.previous} value={b.previous_hash} />
                  <HashField label="Record hash" tip={TIPS.record} value={b.record_hash} right />
                </dl>
              </div>
              {i < data.blocks.length - 1 && (
                <div className={`flex flex-col items-center ${isBad || after ? 'text-bad-600' : 'text-[var(--role-soft)]'}`} aria-hidden="true">
                  <span className="h-2.5 w-0.5 bg-current" />
                  <Link2 className="h-4 w-4 rotate-90" />
                  <span className="h-2.5 w-0.5 bg-current" />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}
