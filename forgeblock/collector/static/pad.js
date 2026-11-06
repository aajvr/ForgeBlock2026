// Shared signature pad and reference drawing (researcher pages and participant links).
'use strict'


// Signature pad recording SVC2004-style points: x, y, t (ms), pen (1 down, 0 hovering),
// azimuth and altitude (degrees) and pressure (0-1).
function makePad(wrap, { height = 320, overlay = null, onStroke } = {}) {
  wrap.innerHTML = '<canvas></canvas><div class="baseline"></div>'
  const canvas = wrap.querySelector('canvas')
  const ctx = canvas.getContext('2d')
  let points = []
  let down = false
  let pointer = 'pen'

  function size() {
    const r = wrap.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    canvas.width = r.width * dpr
    canvas.height = height * dpr
    canvas.style.height = `${height}px`
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    draw()
  }

  function angles(e) {
    if (typeof e.altitudeAngle === 'number' && typeof e.azimuthAngle === 'number') {
      return { azimuth: ((e.azimuthAngle * 180) / Math.PI + 360) % 360, altitude: (e.altitudeAngle * 180) / Math.PI }
    }
    const tx = Math.tan(((e.tiltX || 0) * Math.PI) / 180)
    const ty = Math.tan(((e.tiltY || 0) * Math.PI) / 180)
    const az = tx === 0 && ty === 0 ? 0 : ((Math.atan2(ty, tx) * 180) / Math.PI + 360) % 360
    const alt = tx === 0 && ty === 0 ? 90 : (Math.atan(1 / Math.hypot(tx, ty)) * 180) / Math.PI
    return { azimuth: az, altitude: alt }
  }

  function add(e, pen) {
    const r = canvas.getBoundingClientRect()
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e]
    for (const ev of evs.length ? evs : [e]) {
      const { azimuth, altitude } = angles(ev)
      const pressure = pen ? (ev.pointerType === 'mouse' ? 0.5 : ev.pressure || 0.5) : 0
      points.push({ x: ev.clientX - r.left, y: ev.clientY - r.top, t: ev.timeStamp, pen, azimuth, altitude, pressure: Math.min(1, pressure) })
    }
  }

  function draw() {
    const w = canvas.width / (window.devicePixelRatio || 1)
    ctx.clearRect(0, 0, w, height)
    if (overlay?.length) {
      ctx.strokeStyle = 'rgba(15,108,189,0.28)'
      ctx.lineWidth = 6
      ctx.lineCap = ctx.lineJoin = 'round'
      line(overlay)
    }
    ctx.strokeStyle = '#0f172a'
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]
      const b = points[i]
      if (!a.pen || !b.pen) continue
      ctx.lineWidth = 1 + 3 * b.pressure
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke()
    }
  }

  function line(pts) {
    // One path, so the translucent overlay has no darker dots at the joins.
    ctx.beginPath()
    for (let i = 0; i < pts.length; i++) {
      if (pts[i].pen && (i === 0 || !pts[i - 1].pen)) ctx.moveTo(pts[i].x, pts[i].y)
      else if (pts[i].pen) ctx.lineTo(pts[i].x, pts[i].y)
    }
    ctx.stroke()
  }

  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault()
    canvas.setPointerCapture(e.pointerId)
    down = true
    pointer = e.pointerType
    add(e, 1)
  })
  canvas.addEventListener('pointermove', (e) => {
    if (down) { add(e, 1); draw() } else if (e.pointerType === 'pen' && points.length) add(e, 0) // hover between strokes
  })
  const up = (e) => {
    if (!down) return
    down = false
    add(e, 0)
    draw()
    onStroke?.()
  }
  canvas.addEventListener('pointerup', up)
  canvas.addEventListener('pointercancel', up)
  window.addEventListener('resize', size)
  size()

  return {
    get points() { return points },
    get pointer() { return pointer },
    height,
    penCount: () => points.filter((p) => p.pen).length,
    clear() { points = []; draw(); onStroke?.() },
    setOverlay(o) { overlay = o; draw() },
  }
}

// Fit reference points (SVC y points up, 1/10 px already undone) into a box.
function fitPoints(pts, w, hgt, pad = 24) {
  const down = pts.filter((p) => p.pen)
  if (!down.length) return []
  const xs = down.map((p) => p.x)
  const ys = down.map((p) => -p.y)
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  const s = Math.min((w - 2 * pad) / (x1 - x0 || 1), (hgt - 2 * pad) / (y1 - y0 || 1))
  const ox = (w - (x1 - x0) * s) / 2
  const oy = (hgt - (y1 - y0) * s) / 2
  return pts.map((p) => ({ ...p, x: ox + (p.x - x0) * s, y: oy + (-p.y - y0) * s }))
}

function drawRef(canvas, pts) {
  const dpr = window.devicePixelRatio || 1
  const w = canvas.clientWidth
  const hgt = canvas.clientHeight
  canvas.width = w * dpr
  canvas.height = hgt * dpr
  const c = canvas.getContext('2d')
  c.setTransform(dpr, 0, 0, dpr, 0, 0)
  c.strokeStyle = '#0f172a'
  c.lineCap = c.lineJoin = 'round'
  const fit = fitPoints(pts, w, hgt)
  for (let i = 1; i < fit.length; i++) {
    if (!fit[i - 1].pen || !fit[i].pen) continue
    c.lineWidth = 1 + 2.5 * fit[i].pressure
    c.beginPath(); c.moveTo(fit[i - 1].x, fit[i - 1].y); c.lineTo(fit[i].x, fit[i].y); c.stroke()
  }
}

