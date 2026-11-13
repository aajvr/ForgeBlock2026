import { Eye, PenLine, PlayCircle, ScanSearch, Upload, Users } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../auth'
import ImagePicker from '../components/ImagePicker'
import SignaturePad from '../components/SignaturePad'
import { CasePicker, ClientPicker, DevPenNotice, PenDataHint } from '../components/shared'
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Tabs } from '../components/ui'

const PEN_KEY = 'forgeblock_pen_only'

function ModelView({ file, removeText }) {
  const [url, setUrl] = useState(null)
  const [quality, setQuality] = useState(null)
  useEffect(() => {
    if (!file) return
    let u
    const fd = new FormData()
    fd.append('file', file)
    if (removeText) fd.append('remove_text', 'true')
    api.upload('/api/static/quality', fd).then(setQuality).catch(() => setQuality(null))
    const fd2 = new FormData()
    fd2.append('file', file)
    if (removeText) fd2.append('remove_text', 'true')
    api.raw('/api/static/preprocess', { method: 'POST', form: fd2 }).then(async (r) => setUrl((u = URL.createObjectURL(await r.blob())))).catch(() => {})
    return () => u && URL.revokeObjectURL(u)
  }, [file, removeText])
  if (!file) return null
  return (
    <div className="grid gap-4 rounded-[12px] border border-line bg-[#f6f8fc] p-4 sm:grid-cols-[140px_1fr]">
      {url ? <img src={url} alt="Preprocessed signature" className="h-[140px] w-[140px] rounded-[10px] border border-line bg-white" /> : <div className="h-[140px] w-[140px] animate-pulse rounded-md bg-slate-200" />}
      <div className="text-sm">
        <div className="flex items-center gap-1.5 font-medium"><Eye className="h-4 w-4 text-brand-600" /> What the model sees</div>
        <p className="mt-1 text-slate-600">Cleaned (illumination, contrast, sharpening), cropped to the signature and resized to 224 × 224.{removeText ? ' Printed text removed first (if found).' : ''}</p>
        {quality && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge tone={quality.score >= 70 ? 'green' : quality.usable ? 'amber' : 'red'}>Quality {quality.score}/100</Badge>
            {quality.issues.map((i) => <span key={i} className="text-xs text-warn-700">{i}</span>)}
          </div>
        )}
      </div>
    </div>
  )
}

export default function Screen() {
  const { setTourOpen } = useAuth()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [modality, setModality] = useState('static')
  const [clientId, setClientId] = useState(params.get('client') || '')
  const [caseId, setCaseId] = useState(params.get('case') || '')
  const [files, setFiles] = useState([])
  const [doc, setDoc] = useState('')
  // v8.21: optional printed-text removal for the questioned photo (off by default)
  const [removeText, setRemoveText] = useState(false)
  const [canRemoveText, setCanRemoveText] = useState(false)
  useEffect(() => {
    api.get('/api/static/text-removal').then((d) => setCanRemoveText(!!d.available)).catch(() => setCanRemoveText(false))
  }, [])
  const [penOnly, setPenOnly] = useState(() => {
    try { return localStorage.getItem(PEN_KEY) === '1' } catch { return false }
  })
  // Pen-only from the page checkbox or the pad's full-screen toolbar; remembered.
  const changePenOnly = (on) => {
    setPenOnly(on)
    try { localStorage.setItem(PEN_KEY, on ? '1' : '0') } catch { /* ignore */ }
  }
  // The chosen client's code, shown in the pad's full-screen toolbar.
  const [clientCode, setClientCode] = useState('')
  useEffect(() => {
    if (!clientId || modality !== 'dynamic') return
    let live = true
    api.get(`/api/clients/${clientId}`).then((c) => live && setClientCode(c.client_code || '')).catch(() => live && setClientCode(''))
    return () => { live = false }
  }, [clientId, modality])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const pad = useRef(null)
  const [signed, setSigned] = useState(null) // v8.11: for the limited pen data hint

  const run = async () => {
    setError('')
    if (!clientId) return setError('Choose the client on file first.')
    setBusy(true)
    try {
      let r
      if (modality === 'static') {
        if (!files.length) throw new Error('Add the questioned signature image.')
        const fd = new FormData()
        fd.append('file', files[0])
        fd.append('client_id', clientId)
        if (caseId) fd.append('case_id', caseId)
        if (doc) fd.append('document_ref', doc)
        if (removeText && canRemoveText) fd.append('remove_text', 'true')
        r = await api.upload('/api/screen/static', fd)
      } else {
        if (pad.current.isEmpty()) throw new Error('Have the signer sign in the box first.')
        r = await api.post('/api/screen/dynamic', {
          test: pad.current.getStrokes(),
          client_id: Number(clientId),
          case_id: caseId ? Number(caseId) : null,
          document_ref: doc || null,
        })
      }
      navigate(`/app/records/${r.id}`)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Screen a signature"
        description="Compare a questioned signature with a client’s signatures on file. Use Static for a signature on paper and Dynamic for one signed live with a pen."
      >
        <Button variant="ghost" onClick={() => setTourOpen('screen')}><PlayCircle className="h-4 w-4" /> Replay tour</Button>
      </PageHeader>
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <Card bodyClass="p-0">
          <div className="px-5 pt-2" data-tour="modules">
            <Tabs
              value={modality}
              onChange={setModality}
              tabs={[{ value: 'static', label: 'Static (scanned paper)', icon: Upload }, { value: 'dynamic', label: 'Dynamic (live signing)', icon: PenLine }]}
            />
          </div>
          <div className="space-y-5 p-5">
            {modality === 'static' ? (
              <>
                <ImagePicker crop label="Questioned signature" files={files} onChange={setFiles} />
                {canRemoveText && (
                  <label className="flex items-start gap-2 text-sm text-slate-600">
                    <input type="checkbox" className="mt-0.5" checked={removeText} onChange={(e) => setRemoveText(e.target.checked)} />
                    <span>
                      <span className="font-medium text-ink">Remove printed text</span>
                      <span className="block text-xs text-muted">For a signature on a printed form (names, dates, stamps, lines). Only the questioned photo is cleaned; the original is kept with the record.</span>
                    </span>
                  </label>
                )}
                <ModelView file={files[0]} removeText={removeText && canRemoveText} />
              </>
            ) : (
              <>
                <label className="flex items-center gap-2 text-sm text-slate-600">
                  <input type="checkbox" checked={penOnly} onChange={(e) => changePenOnly(e.target.checked)} />
                  Pen-only mode (ignore finger and palm touches)
                </label>
                <DevPenNotice />
                <SignaturePad
                  ref={pad}
                  penOnly={penOnly}
                  onPenOnlyChange={changePenOnly}
                  label={clientId ? clientCode : ''}
                  onChange={(st) => setSigned(st.length ? st.map((x) => [...x]) : null)}
                />
                <PenDataHint strokes={signed} />
                <Button variant="secondary" className="min-h-11" onClick={() => pad.current.clear()}>Clear</Button>
              </>
            )}
          </div>
        </Card>

        <div className="space-y-6">
          <Card icon={Users} title="Screen against" data-tour="screen-client">
            <div className="space-y-4">
              <ClientPicker value={clientId} onChange={(v) => { setClientId(v); setCaseId('') }} modality={modality} />
              <CasePicker clientId={clientId} value={caseId} onChange={setCaseId} />
              {!caseId && (
                <Field label="Document reference (optional)">
                  <Input value={doc} onChange={(e) => setDoc(e.target.value)} placeholder="e.g. LN-1023" maxLength={120} />
                </Field>
              )}
              <Alert>{error}</Alert>
              <Button className="w-full" onClick={run} loading={busy} data-tour="screen-button">
                <ScanSearch className="h-4 w-4" /> Screen signature
              </Button>
              <p className="text-sm text-slate-500">If the result is not clearly Consistent, a case opens so you can decide Genuine or Forged.</p>
            </div>
          </Card>
        </div>
      </div>
    </>
  )
}
