// Built-in page scanner (v8.26), a Notebloc-like step that runs in the browser.
//
// 1. Find the page in a camera photo (paper detection from opencv-document-scanner
//    by tony-xlh, MIT License, https://github.com/tony-xlh/opencvjs-document-scanner;
//    the detect and corner logic below is adapted from its 1.2.2 release).
// 2. Straighten it with a perspective warp that keeps the paper's true proportions.
// 3. Clean it: estimate the paper background without the ink (dilate + median),
//    divide it out (shadows removed, paper white), then a soft contrast stretch
//    (0..240 -> 0..255). Ink stays grey; there is no hard black and white.
//    Tested 2026-11-18 on a real enrollment sheet: scores matched the Notebloc
//    scan of the same sheet (7C/3?/0X both). A harder stretch (40..225) made every
//    box Inconsistent, so do not raise LO without re-testing.
//
// OpenCV.js (about 9 MB) loads on first use only and is then cached by the browser.

const OPENCV_URL = 'https://cdn.jsdelivr.net/npm/jscanify@1.4.0/src/opencv.js'
const MAX_SIDE = 2600 // photos are scaled down to this before scanning
const LO = 0
const HI = 240

let loading = null

// The OpenCV.js build is an Emscripten module that is itself "thenable" (it has
// a .then). Resolving a Promise with it makes the browser call .then again and
// again, forever: the page freezes on "Loading the scanner..." until the browser
// says it is not responding. So the module's .then is removed before it is
// handed to any Promise.
function settle(cv, resolve) {
  if (cv && typeof cv.then === 'function') {
    try {
      delete cv.then
    } catch {
      cv.then = undefined
    }
  }
  window.cv = cv
  resolve(cv)
}

export function loadOpenCV() {
  if (window.cv?.Mat) {
    const cv = window.cv
    return new Promise((resolve) => settle(cv, resolve))
  }
  if (loading) return loading
  loading = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      loading = null
      reject(new Error('The scanner took too long to start. Check the internet connection and try again.'))
    }, 60000)
    const done = (cv) => {
      clearTimeout(timer)
      settle(cv, resolve)
    }
    const ready = () => {
      const cv = window.cv
      if (cv?.Mat) return done(cv)
      if (cv && typeof cv.then === 'function') {
        // The callback's argument is the module itself: take it without returning it.
        cv.then((m) => {
          done(m)
        })
        return
      }
      if (cv) cv.onRuntimeInitialized = () => done(window.cv)
      else {
        clearTimeout(timer)
        loading = null
        reject(new Error('OpenCV did not start.'))
      }
    }
    const s = document.createElement('script')
    s.src = OPENCV_URL
    s.async = true
    s.onload = ready
    s.onerror = () => {
      clearTimeout(timer)
      loading = null
      reject(new Error('Could not load the scanner. Check the internet connection and try again.'))
    }
    document.head.appendChild(s)
  })
  return loading
}

// File -> canvas, scaled so the longer side is at most MAX_SIDE.
export async function fileToCanvas(file) {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image()
      i.onload = () => res(i)
      i.onerror = () => rej(new Error('This file is not a readable image.'))
      i.src = url
    })
    const k = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight))
    const c = document.createElement('canvas')
    c.width = Math.round(img.naturalWidth * k)
    c.height = Math.round(img.naturalHeight * k)
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
    return c
  } finally {
    URL.revokeObjectURL(url)
  }
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)

function area(p) {
  let a = 0
  for (let i = 0; i < 4; i++) {
    const q = p[i]
    const r = p[(i + 1) % 4]
    a += q.x * r.y - r.x * q.y
  }
  return Math.abs(a) / 2
}

// Corners of the biggest contour, as [top-left, top-right, bottom-right, bottom-left].
function cornerPoints(cv, contour) {
  const c = cv.minAreaRect(contour).center
  const best = { tl: [0, null], tr: [0, null], br: [0, null], bl: [0, null] }
  const d = contour.data32S
  for (let i = 0; i < d.length; i += 2) {
    const p = { x: d[i], y: d[i + 1] }
    const k = (p.y < c.y ? 't' : 'b') + (p.x < c.x ? 'l' : 'r')
    const r = dist(p, c)
    if (r > best[k][0]) best[k] = [r, p]
  }
  return [best.tl[1], best.tr[1], best.br[1], best.bl[1]]
}

function detectOnce(cv, canvas, useCanny) {
  const src = cv.imread(canvas)
  const g = new cv.Mat()
  const b = new cv.Mat()
  const t = new cv.Mat()
  const contours = new cv.MatVector()
  const hier = new cv.Mat()
  try {
    if (useCanny) cv.Canny(src, g, 50, 200)
    else cv.cvtColor(src, g, cv.COLOR_RGBA2GRAY)
    cv.GaussianBlur(g, b, new cv.Size(3, 3), 0, 0, cv.BORDER_DEFAULT)
    cv.threshold(b, t, 0, 255, cv.THRESH_OTSU)
    cv.findContours(t, contours, hier, cv.RETR_CCOMP, cv.CHAIN_APPROX_SIMPLE)
    let max = 0
    let idx = -1
    for (let i = 0; i < contours.size(); i++) {
      const a = cv.contourArea(contours.get(i))
      if (a > max) {
        max = a
        idx = i
      }
    }
    if (idx < 0) return null
    const pts = cornerPoints(cv, contours.get(idx))
    return pts.every(Boolean) ? pts : null
  } finally {
    ;[src, g, b, t, contours, hier].forEach((m) => m.delete())
  }
}

// Default corners when no page is found: 4% in from each edge.
export function insetCorners(canvas) {
  const w = canvas.width
  const h = canvas.height
  const m = 0.04
  return [
    { x: w * m, y: h * m },
    { x: w * (1 - m), y: h * m },
    { x: w * (1 - m), y: h * (1 - m) },
    { x: w * m, y: h * (1 - m) },
  ]
}

// Returns { points, found }. found is false when no page covering a quarter of the photo was seen.
// Finding the page runs on a copy at most DETECT_SIDE px (much faster on phones);
// the corners are scaled back up, and the scan itself still uses the full photo.
const DETECT_SIDE = 1000

export function detectPage(cv, canvas) {
  const k = Math.min(1, DETECT_SIDE / Math.max(canvas.width, canvas.height))
  let small = canvas
  if (k < 1) {
    small = document.createElement('canvas')
    small.width = Math.round(canvas.width * k)
    small.height = Math.round(canvas.height * k)
    small.getContext('2d').drawImage(canvas, 0, 0, small.width, small.height)
  }
  let best = null
  for (const useCanny of [false, true]) {
    try {
      const p = detectOnce(cv, small, useCanny)
      if (p && (!best || area(p) > area(best))) best = p
    } catch {
      // try the other mode
    }
  }
  if (best && area(best) > small.width * small.height * 0.25) {
    return { points: best.map((q) => ({ x: q.x / k, y: q.y / k })), found: true }
  }
  return { points: insetCorners(canvas), found: false }
}

// Start downloading OpenCV in the background (call when a page with a scanner
// opens), so it is usually ready by the time a photo is picked.
export function preloadScanner() {
  const go = () => loadOpenCV().catch(() => {})
  if ('requestIdleCallback' in window) window.requestIdleCallback(go, { timeout: 3000 })
  else setTimeout(go, 1000)
}

// Straighten + clean. Returns a grayscale JPEG File.
export async function scanPage(cv, canvas, pts, name = 'scan') {
  const [tl, tr, br, bl] = pts
  const w = Math.round(Math.max(dist(tl, tr), dist(bl, br)))
  const h = Math.round(Math.max(dist(tl, bl), dist(tr, br)))
  const src = cv.imread(canvas)
  const flat = new cv.Mat()
  const gray = new cv.Mat()
  const bg = new cv.Mat()
  const bg2 = new cv.Mat()
  const norm = new cv.Mat()
  const out = new cv.Mat()
  const from = cv.matFromArray(4, 1, cv.CV_32FC2, [tl.x, tl.y, tr.x, tr.y, bl.x, bl.y, br.x, br.y])
  const to = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, w, 0, 0, h, w, h])
  let k = Math.round(Math.max(w, h) / 45)
  if (k % 2 === 0) k += 1
  const kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(k, k))
  try {
    const M = cv.getPerspectiveTransform(from, to)
    cv.warpPerspective(src, flat, M, new cv.Size(w, h), cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar())
    M.delete()
    cv.cvtColor(flat, gray, cv.COLOR_RGBA2GRAY)
    cv.dilate(gray, bg, kernel)
    cv.medianBlur(bg, bg2, 21)
    // The dilate leaves round plateaus on grainy paper that show up as grey spots
    // after the divide; a wide blur of the background removes them. Tested
    // 2026-11-18 (flash photo of sheet B vs Notebloc sheet A refs): 5C/5?/0X
    // before, 7C/3?/0X after. Do NOT force light paper to pure white instead:
    // that made the same boxes 0C/0?/10X.
    // (blurred at quarter size and scaled back up: same result, ~25x faster)
    const small = new cv.Mat()
    try {
      cv.resize(bg2, small, new cv.Size(Math.max(1, Math.round(w / 4)), Math.max(1, Math.round(h / 4))), 0, 0, cv.INTER_AREA)
      cv.GaussianBlur(small, small, new cv.Size(0, 0), k / 4, k / 4, cv.BORDER_REPLICATE)
      cv.resize(small, bg, new cv.Size(w, h), 0, 0, cv.INTER_LINEAR)
    } finally {
      small.delete()
    }
    cv.divide(gray, bg, norm, 255)
    const a = 255 / (HI - LO)
    norm.convertTo(out, -1, a, -LO * a)
    const c = document.createElement('canvas')
    cv.imshow(c, out)
    const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.95))
    return new File([blob], `${name.replace(/\.[^.]+$/, '')}-scan.jpg`, { type: 'image/jpeg' })
  } finally {
    ;[src, flat, gray, bg, bg2, norm, out, from, to, kernel].forEach((m) => m.delete())
  }
}
