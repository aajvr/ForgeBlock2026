import { Crop, RotateCcw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button, Modal } from './ui'

// Crop step for a questioned static signature (v8.6.2). The model scores best
// when the questioned photo is framed like the enrollment-sheet boxes: the
// signature with a little paper around it, no printed lines, no other writing.
// The examiner drags a box around the signature; only that part is sent.
const MIN = 0.04 // smallest box side, as a share of the image

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

export default function SignatureCrop({ file, onDone, onCancel }) {
  const [url, setUrl] = useState(null)
  const [box, setBox] = useState({ x: 0.1, y: 0.15, w: 0.8, h: 0.7 }) // fractions of the image
  const [busy, setBusy] = useState(false)
  const imgRef = useRef(null)
  const drag = useRef(null)

  useEffect(() => {
    if (!file) return
    const u = URL.createObjectURL(file)
    setUrl(u)
    setBox({ x: 0.1, y: 0.15, w: 0.8, h: 0.7 })
    return () => URL.revokeObjectURL(u)
  }, [file])

  const point = (e) => {
    const r = imgRef.current.getBoundingClientRect()
    return { x: clamp((e.clientX - r.left) / r.width, 0, 1), y: clamp((e.clientY - r.top) / r.height, 0, 1) }
  }

  const start = (mode) => (e) => {
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    const p = point(e)
    drag.current = { mode, p, box: { ...box } }
    if (mode === 'new') setBox({ x: p.x, y: p.y, w: 0, h: 0 })
  }

  const move = (e) => {
    const d = drag.current
    if (!d) return
    const p = point(e)
    const b = d.box
    if (d.mode === 'move') {
      setBox({ ...b, x: clamp(b.x + p.x - d.p.x, 0, 1 - b.w), y: clamp(b.y + p.y - d.p.y, 0, 1 - b.h) })
      return
    }
    // 'new' or a corner: the fixed corner stays, the dragged one follows the pointer
    const fixed = d.mode === 'new' ? d.p : {
      x: d.mode.includes('l') ? b.x + b.w : b.x,
      y: d.mode.includes('t') ? b.y + b.h : b.y,
    }
    setBox({ x: Math.min(fixed.x, p.x), y: Math.min(fixed.y, p.y), w: Math.abs(p.x - fixed.x), h: Math.abs(p.y - fixed.y) })
  }

  const end = () => {
    drag.current = null
    setBox((b) => (b.w < MIN || b.h < MIN ? { x: 0.1, y: 0.15, w: 0.8, h: 0.7 } : b))
  }

  const confirm = async (whole) => {
    setBusy(true)
    try {
      const img = imgRef.current
      const W = img.naturalWidth
      const H = img.naturalHeight
      const b = whole ? { x: 0, y: 0, w: 1, h: 1 } : box
      const sx = Math.round(b.x * W)
      const sy = Math.round(b.y * H)
      const sw = Math.max(1, Math.round(b.w * W))
      const sh = Math.max(1, Math.round(b.h * H))
      const canvas = document.createElement('canvas')
      canvas.width = sw
      canvas.height = sh
      canvas.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh)
      const big = sw * sh > 4_000_000
      const blob = await new Promise((res) => canvas.toBlob(res, big ? 'image/jpeg' : 'image/png', 0.95))
      const base = (file.name || 'signature').replace(/\.[^.]+$/, '')
      onDone(new File([blob], `${base}-crop.${big ? 'jpg' : 'png'}`, { type: blob.type }))
    } finally {
      setBusy(false)
    }
  }

  const corner = (pos, cls) => (
    <span
      onPointerDown={start(pos)}
      className={`absolute h-5 w-5 touch-none rounded-full border-2 border-white bg-brand-600 shadow ${cls}`}
      style={{ cursor: pos === 'tl' || pos === 'br' ? 'nwse-resize' : 'nesw-resize' }}
    />
  )

  return (
    <Modal open={!!file} title="Crop the signature" onClose={onCancel} wide>
      <p className="mb-3 text-sm text-slate-600">
        Drag a box around the signature with a little space around it, like a box on the enrollment sheet.
        Leave out printed lines, stamps and other writing.
      </p>
      <div className="flex justify-center rounded-lg bg-slate-100 p-2">
        {url && (
          <div
            className="relative inline-block touch-none select-none overflow-hidden"
            onPointerDown={start('new')}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
          >
            <img ref={imgRef} src={url} alt="Questioned signature" draggable={false} className="block max-h-[60vh] max-w-full" />
            <div
              onPointerDown={start('move')}
              className="absolute cursor-move border-2 border-brand-600"
              style={{
                left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%`,
                boxShadow: '0 0 0 9999px rgba(15, 23, 42, 0.45)',
              }}
            >
              {corner('tl', '-left-2.5 -top-2.5')}
              {corner('tr', '-right-2.5 -top-2.5')}
              {corner('bl', '-bottom-2.5 -left-2.5')}
              {corner('br', '-bottom-2.5 -right-2.5')}
            </div>
          </div>
        )}
      </div>
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={() => setBox({ x: 0.1, y: 0.15, w: 0.8, h: 0.7 })}>
          <RotateCcw className="h-4 w-4" /> Reset
        </Button>
        <Button variant="secondary" onClick={() => confirm(true)} disabled={busy}>Use whole photo</Button>
        <Button onClick={() => confirm(false)} loading={busy}>
          <Crop className="h-4 w-4" /> Use this crop
        </Button>
      </div>
    </Modal>
  )
}
