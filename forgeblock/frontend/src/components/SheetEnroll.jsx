import { Camera, Check, FileUp, Printer } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { Alert, Button } from './ui'

// Static enrollment from the printable sheet: print it, let the client sign the
// 2 practice boxes (warm-up, never used) and the 10 reference boxes, then take a
// phone photo (or upload a scan). The server straightens the photo and crops the
// 10 reference boxes; the examiner unticks bad captures only and the rest are
// added through the normal static enroll endpoint. 20 references are
// recommended, so a client fills two sheets, ideally on different days.
export default function SheetEnroll({ client, onDone, onDirty }) {
  const cameraRef = useRef(null)
  const fileRef = useRef(null)
  const [boxes, setBoxes] = useState(null)
  const [picked, setPicked] = useState({})
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [res, setRes] = useState(null)
  const max = client.static_strength?.maximum ?? 30
  const recommended = client.static_strength?.recommended ?? 20
  const room = Math.max(0, max - (client.static_count || 0))
  const chosen = (boxes || []).filter((b) => picked[b.index])
  // Read boxes that are not saved yet count as unsaved work.
  const dirty = !!boxes?.length
  useEffect(() => {
    onDirty?.(dirty)
    return () => onDirty?.(false)
  }, [dirty, onDirty])

  const printSheet = async () => {
    setError('')
    setBusy('print')
    // Open the tab first (pop-up blockers allow it inside the click), then fill it.
    const win = window.open('', '_blank')
    try {
      const blob = await api.blob(`/api/clients/${client.id}/static/enrollment-sheet`)
      const url = URL.createObjectURL(blob)
      if (win) win.location.href = url
      else window.location.href = url
      setTimeout(() => URL.revokeObjectURL(url), 60000)
    } catch (err) {
      if (win) win.close()
      setError(err.message)
    } finally {
      setBusy('')
    }
  }

  const readSheet = async (file) => {
    if (!file) return
    setError('')
    setRes(null)
    setBoxes(null)
    setBusy('read')
    try {
      const fd = new FormData()
      fd.append('file', file)
      const r = await api.upload(`/api/clients/${client.id}/static/sheet-preview`, fd)
      setBoxes(r.boxes)
      const pick = {}
      let n = 0
      r.boxes.forEach((b) => {
        if (b.usable && !b.cut_off && n < room) {
          pick[b.index] = true
          n += 1
        }
      })
      setPicked(pick)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy('')
    }
  }

  const save = async () => {
    setError('')
    setBusy('save')
    try {
      const fd = new FormData()
      for (const b of chosen) {
        const blob = await (await fetch(b.image)).blob()
        fd.append('files', blob, `${client.client_code}-sheet-box${String(b.index).padStart(2, '0')}.png`)
      }
      const r = await api.upload(`/api/clients/${client.id}/static/enroll`, fd)
      setRes(r)
      setBoxes(null)
      setPicked({})
      onDone()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy('')
    }
  }

  const toggle = (b) => {
    if (b.empty) return
    if (!picked[b.index] && chosen.length >= room) return
    setPicked({ ...picked, [b.index]: !picked[b.index] })
  }

  return (
    <div className="space-y-4">
      <ol className="space-y-1.5 text-sm text-slate-600">
        <li><span className="font-semibold text-slate-800">1.</span> Print the sheet for {client.client_code}. The client signs the 2 practice boxes first (they are not used), then once in each of the 10 numbered boxes.</li>
        <li><span className="font-semibold text-slate-800">2.</span> Lay it flat in good light and take a photo from straight above, with all four black squares in view.</li>
        <li><span className="font-semibold text-slate-800">3.</span> Check the 10 crops. Untick only bad captures (empty, smudged, cut off or blurry), not signatures that just look a little different: natural variation helps.</li>
      </ol>
      <Alert kind="info">
        More signatures make screening more reliable. {recommended} are recommended (two sheets), up to {max}.
        If possible, fill the second sheet on another day, so the references show how the client's signature naturally varies.
      </Alert>

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={printSheet} loading={busy === 'print'}>
          <Printer className="h-4 w-4" /> Print sheet
        </Button>
        <Button onClick={() => cameraRef.current.click()} loading={busy === 'read'}>
          <Camera className="h-4 w-4" /> Scan with phone
        </Button>
        <Button variant="secondary" onClick={() => fileRef.current.click()} disabled={busy === 'read'}>
          <FileUp className="h-4 w-4" /> Upload a scan
        </Button>
      </div>
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { readSheet(e.target.files[0]); e.target.value = '' }} />
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { readSheet(e.target.files[0]); e.target.value = '' }} />

      <Alert>{error}</Alert>
      {res && (
        <Alert kind={res.rejected.length ? 'warn' : 'success'}>
          Added {res.accepted.length} reference(s) from the sheet.
          {res.rejected.map((r) => (
            <div key={r.file}>Not added, {r.file}: {r.issues.join(' ')}</div>
          ))}
        </Alert>
      )}

      {boxes && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="text-slate-600">
              <span className="font-semibold text-slate-800">{chosen.length}</span> of {boxes.length} boxes selected
              {room < boxes.length && <span> (room for {room} more on this card)</span>}
            </span>
            <span className="text-xs text-slate-500">Tap a box to include or leave it out.</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {boxes.map((b) => {
              const on = !!picked[b.index]
              return (
                <button
                  key={b.index}
                  type="button"
                  onClick={() => toggle(b)}
                  disabled={b.empty}
                  className={`relative rounded-xl border-2 bg-white p-2 text-left transition ${
                    on ? 'border-brand-500 shadow-sm' : 'border-slate-200 opacity-60 hover:opacity-90'
                  } ${b.empty ? 'cursor-not-allowed' : ''}`}
                >
                  <span className={`absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-md border ${on ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 bg-white'}`}>
                    {on && <Check className="h-3.5 w-3.5" />}
                  </span>
                  <span className="text-xs font-medium text-slate-500">Box {b.index}</span>
                  <img src={b.model_view || b.image} alt={`Box ${b.index}`} className="mt-1 h-20 w-full object-contain" />
                  {(b.empty || b.issues.length > 0) && (
                    <div className={`mt-1 text-[12px] ${b.usable || b.cut_off ? 'text-amber-700' : 'text-bad-600'}`}>
                      {b.empty ? 'Empty box' : b.issues.join(' ')}
                    </div>
                  )}
                </button>
              )
            })}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={save} disabled={!chosen.length} loading={busy === 'save'}>
              Add {chosen.length || ''} reference{chosen.length === 1 ? '' : 's'}
            </Button>
            <Button variant="ghost" onClick={() => { setBoxes(null); setPicked({}) }}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  )
}
