import { RotateCcw, ScanLine } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { detectPage, fileToCanvas, loadOpenCV, scanPage } from '../lib/pageScan'
import { Alert, Button, Modal } from './ui'

// Built-in scanner step (v8.26), used instead of a separate scanning app such as
// Notebloc. It finds the page in the photo, lets the examiner drag the 4 corners
// when it guesses wrong, then straightens and cleans the page (see lib/pageScan.js).
// The scanned page goes on to the normal upload (sheet import or signature crop).
// References and questioned signatures should both go through this same scanner.
export default function PageScanner({ file, onDone, onCancel, title = 'Scan the page' }) {
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [pts, setPts] = useState(null)
  const [found, setFound] = useState(true)
  const photo = useRef(null)
  const cvRef = useRef(null)
  const canvasRef = useRef(null)
  const scale = useRef(1)
  const drag = useRef(-1)

  // Load OpenCV and the photo, then find the page.
  useEffect(() => {
    if (!file) return
    let live = true
    setPts(null)
    setError('')
    setStatus('Loading the scanner…')
    ;(async () => {
      try {
        const [cv, canvas] = await Promise.all([loadOpenCV(), fileToCanvas(file)])
        if (!live) return
        cvRef.current = cv
        photo.current = canvas
        const r = detectPage(cv, canvas)
        setFound(r.found)
        setPts(r.points)
        setStatus('')
      } catch (err) {
        if (live) {
          setStatus('')
          setError(err.message)
        }
      }
    })()
    return () => {
      live = false
    }
  }, [file])

  const draw = useCallback(() => {
    const c = canvasRef.current
    const img = photo.current
    if (!c || !img || !pts) return
    const box = c.parentElement.clientWidth
    const k = Math.min(box / img.width, (window.innerHeight * 0.6) / img.height)
    scale.current = k
    c.width = Math.round(img.width * k)
    c.height = Math.round(img.height * k)
    const ctx = c.getContext('2d')
    ctx.drawImage(img, 0, 0, c.width, c.height)
    ctx.strokeStyle = '#16a34a'
    ctx.lineWidth = 3
    ctx.beginPath()
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x * k, p.y * k) : ctx.moveTo(p.x * k, p.y * k)))
    ctx.closePath()
    ctx.stroke()
    pts.forEach((p) => {
      ctx.beginPath()
      ctx.arc(p.x * k, p.y * k, 14, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(22,163,74,0.35)'
      ctx.fill()
      ctx.stroke()
    })
  }, [pts])

  useEffect(() => {
    draw()
    window.addEventListener('resize', draw)
    return () => window.removeEventListener('resize', draw)
  }, [draw])

  const at = (e) => {
    const c = canvasRef.current
    const r = c.getBoundingClientRect()
    const k = scale.current
    return { x: ((e.clientX - r.left) * (c.width / r.width)) / k, y: ((e.clientY - r.top) * (c.height / r.height)) / k }
  }

  const down = (e) => {
    if (!pts) return
    const p = at(e)
    let best = -1
    let d = Infinity
    pts.forEach((q, i) => {
      const k = Math.hypot(q.x - p.x, q.y - p.y)
      if (k < d) {
        d = k
        best = i
      }
    })
    if (d * scale.current > 60) return
    drag.current = best
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }

  const move = (e) => {
    if (drag.current < 0) return
    const img = photo.current
    const p = at(e)
    const next = [...pts]
    next[drag.current] = { x: Math.max(0, Math.min(img.width, p.x)), y: Math.max(0, Math.min(img.height, p.y)) }
    setPts(next)
  }

  const up = () => {
    drag.current = -1
  }

  const scan = async () => {
    setBusy(true)
    setError('')
    try {
      onDone(await scanPage(cvRef.current, photo.current, pts, file.name || 'page'))
    } catch (err) {
      setError(err.message || 'The scan failed. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const img = photo.current
  return (
    <Modal open={!!file} title={title} onClose={busy ? undefined : onCancel} wide>
      <p className="mb-3 text-sm text-slate-600">
        Check the green corners. If one is not on the corner of the page, drag it there. Then tap Scan.
      </p>
      {!found && pts && <Alert kind="warn" className="mb-3">The page edges were not found. Drag the 4 corners onto the corners of the page.</Alert>}
      <Alert className="mb-3">{error}</Alert>
      <div className="flex justify-center rounded-lg bg-slate-900 p-2">
        {pts ? (
          <canvas
            ref={canvasRef}
            className="block max-w-full touch-none select-none"
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={up}
          />
        ) : (
          <div className="py-16 text-sm text-slate-300">{status || 'Preparing…'}</div>
        )}
      </div>
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Button variant="ghost" disabled={!pts || busy} onClick={() => img && setPts(detectPage(cvRef.current, img).points)}>
          <RotateCcw className="h-4 w-4" /> Detect again
        </Button>
        <Button
          variant="secondary"
          disabled={!pts || busy}
          onClick={() => img && setPts([{ x: 0, y: 0 }, { x: img.width, y: 0 }, { x: img.width, y: img.height }, { x: 0, y: img.height }])}
        >
          Use whole photo
        </Button>
        <Button onClick={scan} loading={busy} disabled={!pts}>
          <ScanLine className="h-4 w-4" /> Scan
        </Button>
      </div>
    </Modal>
  )
}
