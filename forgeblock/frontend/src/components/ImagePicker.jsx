import { Camera, Crop, ImagePlus, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import SignatureCrop from './SignatureCrop'

// Image upload box with preview. "Take photo" opens the camera on phones and tablets.
// With `crop` (single image only), every picked photo first opens the crop step
// so the examiner frames just the signature (see SignatureCrop).
export default function ImagePicker({ label, files, onChange, multiple = false, hint, crop = false }) {
  const inputRef = useRef(null)
  const cameraRef = useRef(null)
  const [previews, setPreviews] = useState([])
  const [drag, setDrag] = useState(false)
  const [original, setOriginal] = useState(null) // the photo as taken, kept for "Crop again"
  const [cropping, setCropping] = useState(null)

  useEffect(() => {
    const urls = (files || []).map((f) => URL.createObjectURL(f))
    setPreviews(urls)
    return () => urls.forEach((u) => URL.revokeObjectURL(u))
  }, [files])

  const take = (list) => {
    const imgs = [...list].filter((f) => f.type.startsWith('image/'))
    if (!imgs.length) return
    if (crop && !multiple) {
      setOriginal(imgs[0])
      setCropping(imgs[0])
      return
    }
    onChange(multiple ? [...(files || []), ...imgs] : [imgs[0]])
  }

  return (
    <div>
      {label && <div className="mb-1 text-sm font-medium text-slate-800">{label}</div>}
      <div
        onClick={() => inputRef.current.click()}
        onDragOver={(e) => {
          e.preventDefault()
          setDrag(true)
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDrag(false)
          take(e.dataTransfer.files)
        }}
        className={`flex min-h-36 cursor-pointer flex-wrap items-center justify-center gap-3 rounded-xl border-2 border-dashed p-4 transition ${
          drag ? 'border-brand-500 bg-brand-50' : 'border-slate-300 bg-white hover:border-brand-400'
        }`}
      >
        {previews.length ? (
          previews.map((u, i) => (
            <div key={u} className="relative rounded-md border border-slate-200 bg-white p-1 shadow-sm">
              <img src={u} alt="" className={`${multiple ? 'h-16' : 'h-32'} object-contain`} />
              <button
                className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-slate-800 text-white"
                onClick={(e) => {
                  e.stopPropagation()
                  onChange(files.filter((_, j) => j !== i))
                }}
                aria-label="Remove"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))
        ) : (
          <div className="flex flex-col items-center gap-1 text-center text-sm text-slate-500">
            <ImagePlus className="h-6 w-6 text-brand-500" />
            <div className="font-medium text-slate-700">Click or drop {multiple ? 'scanned signatures' : 'a scanned signature'}</div>
            {hint || 'PNG, JPG, BMP or TIFF, up to 10 MB'}
          </div>
        )}
      </div>
      <div className="mt-2 flex justify-end gap-4">
        {crop && !multiple && original && files?.length > 0 && (
          <button type="button" onClick={() => setCropping(original)} className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-700 hover:underline">
            <Crop className="h-3.5 w-3.5" /> Crop again
          </button>
        )}
        <button type="button" onClick={() => cameraRef.current.click()} className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-700 hover:underline">
          <Camera className="h-3.5 w-3.5" /> Take photo
        </button>
      </div>
      <input ref={inputRef} type="file" accept="image/*" multiple={multiple} className="hidden" onChange={(e) => { take(e.target.files); e.target.value = '' }} />
      {crop && (
        <SignatureCrop
          file={cropping}
          onCancel={() => setCropping(null)}
          onDone={(f) => {
            setCropping(null)
            onChange([f])
          }}
        />
      )}
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { take(e.target.files); e.target.value = '' }} />
    </div>
  )
}
