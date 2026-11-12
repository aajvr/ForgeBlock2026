import { CheckCircle2, CircleAlert, RefreshCw, Upload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { api } from '../../api'
import { Alert, Button, Card, PageHeader, Spinner, fmtDate } from '../../components/ui'

function Row({ ok, label, detail }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-100 py-3 last:border-0">
      <div className="flex items-center gap-2 text-sm font-medium">
        {ok ? <CheckCircle2 className="h-4 w-4 text-ok-600" /> : <CircleAlert className="h-4 w-4 text-warn-600" />}
        {label}
      </div>
      <div className="text-right text-sm text-slate-600">{detail}</div>
    </div>
  )
}

// System status and model upkeep on one page (v7 merges the old Model and
// System status pages).
export default function SystemPage() {
  const [s, setS] = useState(null)
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const file = useRef(null)
  const load = () => api.get('/api/admin/status').then(setS)
  useEffect(() => {
    load()
  }, [])
  if (!s) return <Spinner />
  const lc = s.ledger.last_auto_check

  const run = async (kind, fn) => {
    setBusy(kind)
    setError('')
    setMsg('')
    try {
      setMsg(await fn())
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy('')
    }
  }

  return (
    <>
      <PageHeader title="System" description="Is everything working, and model upkeep after the dynamic model is retrained.">
        <Button variant="secondary" loading={busy === 'ledger'} onClick={() => run('ledger', async () => { await api.post('/api/admin/ledger/check-now'); await load(); return 'Ledger checked.' })}>
          Run ledger check
        </Button>
      </PageHeader>
      <Alert kind="success" className="mb-4">{msg}</Alert>
      <Alert className="mb-4">{error}</Alert>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Health" data-tour="system-health">
          <Row ok={s.models.static.trained} label="Static model" detail={s.models.static.trained ? 'Loaded' : 'Not loaded'} />
          <Row ok={s.models.dynamic.trained} label="Dynamic model" detail={s.models.dynamic.trained ? 'Loaded' : 'Not loaded'} />
          <Row ok={s.database.ok} label="Database" detail={`${s.database.kind}, ${s.database.ok ? 'connected' : 'not reachable'}`} />
          <Row ok={s.storage.free_gb > 1} label="Storage" detail={`${s.storage.used_mb} MB used, ${s.storage.free_gb} GB free`} />
          <Row ok={lc ? lc.valid : false} label="Ledger" detail={lc ? `${lc.valid ? 'Intact' : 'FAILED'} · ${s.ledger.chain_height} blocks · checked ${fmtDate(lc.checked_at)}` : `${s.ledger.chain_height} blocks, not checked yet`} />
        </Card>
        <Card title="Model upkeep" subtitle="Only needed when your dynamic model is retrained.">
          <ol className="mb-4 list-decimal space-y-1 pl-5 text-sm text-slate-700">
            <li>Upload the model bundle (.zip) from the dynamic notebook, or a .pt file.</li>
            <li>Restart the backend.</li>
            <li>Re-embed the references so they match the new model.</li>
          </ol>
          <input ref={file} type="file" accept=".zip,.pt" className="hidden" onChange={(e) => {
            const f = e.target.files[0]
            if (!f) return
            run('upload', async () => {
              const fd = new FormData()
              fd.append('file', f)
              e.target.value = ''
              return (await api.upload('/api/admin/model/dynamic-weights', fd)).note
            })
          }} />
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" loading={busy === 'upload'} onClick={() => file.current.click()}><Upload className="h-4 w-4" /> Upload dynamic model</Button>
            <Button variant="secondary" loading={busy === 'reembed'} onClick={() => run('reembed', async () => {
              const r = await api.post('/api/admin/reembed')
              return `Re-embedded ${r.updated} reference(s).${r.failed.length ? ` ${r.failed.length} failed.` : ''}`
            })}><RefreshCw className="h-4 w-4" /> Re-embed references</Button>
          </div>
        </Card>
        <Card title="Counts" className="lg:col-span-2">
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {Object.entries(s.counts).map(([k, v]) => (
              <div key={k}><dt className="text-sm capitalize text-slate-500">{k.replaceAll('_', ' ')}</dt><dd className="text-2xl font-semibold tabular-nums">{v}</dd></div>
            ))}
          </dl>
        </Card>
      </div>
    </>
  )
}
