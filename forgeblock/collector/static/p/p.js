// Participant page for remote sessions. The personal token is in the URL after '#',
// so it is never sent to the server in the address; it goes in a request header instead.
'use strict'

const $view = document.getElementById('view')
const token = location.hash.replace(/^#\/?/, '').split('/')[0]
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const h = (html) => { $view.innerHTML = html }
let s = null
let step = 'welcome'

async function api(path, opts = {}) {
  const headers = { 'X-Participant-Token': token, ...(opts.json ? { 'Content-Type': 'application/json' } : {}) }
  const res = await fetch(path, { ...opts, headers, body: opts.json ? JSON.stringify(opts.json) : opts.body })
  if (!res.ok) {
    let msg = `Something went wrong (${res.status}). Please try again.`
    try { const d = await res.json(); if (typeof d.detail === 'string') msg = d.detail } catch { /* not json */ }
    const err = new Error(msg)
    err.status = res.status
    throw err
  }
  return res.headers.get('content-type')?.includes('json') ? res.json() : res.blob()
}

const STEPS = () => [
  { id: 'paper-genuine', label: 'Paper: 20 signatures', done: s.sheets_uploaded.genuine },
  { id: 'ipad-genuine', label: 'iPad: 20 signatures', done: s.progress.dynamic_genuine >= 20 },
  ...(s.has_target ? [
    { id: 'paper-forged', label: 'Paper: 20 imitations', done: s.sheets_uploaded.forged },
    { id: 'practice', label: 'iPad: tracing practice', done: s.progress.dynamic_forged > 0 },
    { id: 'ipad-forged', label: 'iPad: 10 imitations', done: s.progress.dynamic_forged >= 10 },
  ] : []),
  { id: 'finish', label: 'Finish', done: false },
]

function go(id) { step = id; render(); window.scrollTo(0, 0) }

function nav() {
  const steps = STEPS()
  return `<div class="steps">${steps.map((x, i) => `<button data-go="${x.id}" class="${x.id === step ? 'on' : ''} ${x.done ? 'done' : ''}">${x.done ? '✓ ' : ''}${i + 1} · ${esc(x.label)}</button>`).join('')}</div>`
}
function bindNav() { document.querySelectorAll('[data-go]').forEach((b) => { b.onclick = () => go(b.dataset.go) }) }
function nextAfter(id) { const st = STEPS(); return st[st.findIndex((x) => x.id === id) + 1]?.id || 'finish' }

async function openPdf(kind) {
  const w = window.open('', '_blank')
  try {
    const blob = await api(`/api/p/template?kind=${kind}`)
    const url = URL.createObjectURL(blob)
    if (w) w.location = url; else location.href = url
  } catch (err) { if (w) w.close(); alert(err.message) }
}

function welcome() {
  const until = new Date(s.expires_at).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  h(`<div class="card" style="max-width:720px;margin:0 auto">
    <h1>Thank you for taking part</h1>
    <p class="lead">This takes about 15 to 20 minutes. You can stop and come back with the same link until <b>${esc(until)}</b>.</p>
    <h2>You will need</h2>
    <ul class="list">
      <li>This iPad with an <b>Apple Pencil</b> (finger signatures cannot be used)</li>
      <li>A printer and two sheets of short bond paper, or the printed sheets the researcher gave you</li>
      <li>A black ballpoint or gel pen</li>
      <li>A phone or this iPad's camera to photograph the filled sheets</li>
    </ul>
    <p class="muted">Your signatures are used only for this research study, as described in the consent form you signed. Your participant code is <b>${esc(s.code)}</b>. Please do not share this link.</p>
    <button class="big" id="start">Start</button></div>`)
  document.getElementById('start').onclick = () => go('paper-genuine')
}

function paperStep(forged) {
  const kind = forged ? 'forged' : 'genuine'
  const sent = s.sheets_uploaded[kind]
  h(`${nav()}<div class="card">
    <h2>${forged ? 'Paper: imitate a signature 20 times' : 'Paper: sign 20 times'}</h2>
    ${forged ? `<p class="muted">Below is another participant's signature. Study it, then copy it as closely as you can, once in each box of the imitation sheet.</p>
      <canvas id="ref" class="ref" style="width:100%;height:180px;margin-bottom:12px"></canvas>` : ''}
    <ol class="list">
      <li><button class="secondary" id="pdf">Open the ${forged ? 'imitation' : 'signature'} sheet (PDF)</button><br><span class="muted">Print it landscape at <b>actual size</b> (not "fit to page"). Skip this if the researcher already gave you the sheet.</span></li>
      <li>${forged ? 'Imitate the signature once in each of the 20 boxes.' : 'Sign once in each of the 20 boxes, the way you normally sign.'} Stay inside the boxes.</li>
      <li>Lay the sheet flat in good light and take a photo from straight above. All <b>four black corner squares</b> must be visible.</li>
    </ol>
    ${sent ? '<div class="alert ok">Photo received. The researcher will check it. You can send a better photo below if needed.</div>' : ''}
    <form id="f" class="row" style="align-items:flex-end">
      <label class="f grow">Photo of the filled sheet<input type="file" id="photo" accept="image/*" required></label>
      <button style="margin-bottom:12px">Send photo</button></form>
    <div id="msg"></div>
    <div class="row"><span class="grow"></span><button id="next" class="${sent ? '' : 'secondary'}">Next</button></div></div>`)
  bindNav()
  document.getElementById('pdf').onclick = () => openPdf(forged ? 'forgery' : 'genuine')
  if (forged) api('/api/p/reference').then((r) => drawRef(document.getElementById('ref'), r.points)).catch(() => {})
  document.getElementById('next').onclick = () => go(nextAfter(step))
  document.getElementById('f').onsubmit = async (e) => {
    e.preventDefault()
    const msg = document.getElementById('msg')
    const fd = new FormData()
    fd.append('kind', kind); fd.append('scan', document.getElementById('photo').files[0])
    msg.innerHTML = '<div class="alert info">Sending and checking the photo…</div>'
    try {
      const r = await api('/api/p/sheet', { method: 'POST', body: fd })
      s = r.session
      msg.innerHTML = r.boxes_found < 20
        ? `<div class="alert info">Photo received. We found ink in ${r.boxes_found} of 20 boxes. If you filled all 20, that is fine; the researcher will check.</div>`
        : '<div class="alert ok">Photo received. Thank you.</div>'
      document.getElementById('next').className = ''
    } catch (err) {
      msg.innerHTML = `<div class="alert">${err.status === 422 ? 'We could not find the four corner squares. Please retake the photo flat, from above, with all four corners visible.' : esc(err.message)}</div>`
    }
  }
}

function ipadStep(forged) {
  const total = forged ? 10 : 20
  let n = forged ? s.progress.dynamic_forged : s.progress.dynamic_genuine
  h(`${nav()}<div class="card">
    <div class="row"><div class="grow"><h2>${forged ? 'iPad: imitate the signature 10 times' : 'iPad: sign 20 times'}</h2>
    <p class="muted">Use the Apple Pencil. Sign on the line, then tap Save. ${forged ? 'Copy the signature shown above the pad; do not trace it.' : 'Sign naturally each time.'}</p></div>
    <div class="counter" id="count"></div></div>
    <div class="bar" style="margin-bottom:14px"><div id="bar"></div></div>
    ${forged ? '<canvas id="ref" class="ref" style="width:100%;height:150px;margin-bottom:12px"></canvas>' : ''}
    <div class="padwrap" id="pad"></div>
    <div id="msg"></div>
    <div class="row" style="margin-top:12px">
      <button id="undo" class="ghost">Delete my last one</button><span class="grow"></span>
      <button id="clear" class="secondary">Clear</button><button id="save" class="big" disabled>Save signature</button></div></div>`)
  bindNav()
  const show = () => {
    document.getElementById('count').innerHTML = `${n}<small> / ${total}</small>`
    document.getElementById('bar').style.width = `${(100 * n) / total}%`
  }
  show()
  const msg = (html) => { document.getElementById('msg').innerHTML = html }
  const save = document.getElementById('save')
  const pad = makePad(document.getElementById('pad'), {
    onStroke: () => {
      save.disabled = pad.penCount() < 10 || n >= total
      if (pad.points.length && pad.pointer !== 'pen') msg('<div class="alert">Please use the Apple Pencil. Finger signatures cannot be saved.</div>')
    },
  })
  if (forged) api('/api/p/reference').then((r) => drawRef(document.getElementById('ref'), r.points)).catch(() => {})
  if (n >= total) msg(`<div class="alert ok">All ${total} saved. <a href="#" id="cont">Continue</a></div>`)
  const bindCont = () => { const c = document.getElementById('cont'); if (c) c.onclick = (e) => { e.preventDefault(); go(nextAfter(step)) } }
  bindCont()
  document.getElementById('clear').onclick = () => { pad.clear(); msg('') }
  save.onclick = async () => {
    save.disabled = true
    try {
      const r = await api('/api/p/dynamic', { method: 'POST', json: { kind: forged ? 'forged' : 'genuine', points: pad.points, height: pad.height, pointer: pad.pointer } })
      s = r.session
      n += 1
      show()
      pad.clear()
      msg(n >= total ? `<div class="alert ok">All ${total} saved. <a href="#" id="cont">Continue</a></div>` : `<div class="alert ok">Saved ${n} of ${total}.</div>`)
      bindCont()
    } catch (err) {
      msg(`<div class="alert">${esc(err.message)}</div>`)
      save.disabled = false
    }
  }
  document.getElementById('undo').onclick = async () => {
    if (!n || !confirm('Delete the signature you saved last?')) return
    try {
      s = await api(`/api/p/dynamic/last?kind=${forged ? 'forged' : 'genuine'}`, { method: 'DELETE' })
      n -= 1
      show()
      msg('<div class="alert info">Deleted. Sign it again.</div>')
    } catch (err) { msg(`<div class="alert">${esc(err.message)}</div>`) }
  }
}

function practice() {
  h(`${nav()}<div class="card"><h2>Tracing practice (not saved)</h2>
    <p class="muted">Trace over the light blue signature with the Apple Pencil to learn its shape. Nothing here is saved. Clear and repeat as often as you like.</p>
    <div class="padwrap" id="pad"></div>
    <div class="row" style="margin-top:12px"><button id="clear" class="secondary">Clear</button><span class="grow"></span><button id="next">Start the 10 imitations</button></div></div>`)
  bindNav()
  const pad = makePad(document.getElementById('pad'))
  api('/api/p/reference').then((r) => {
    pad.setOverlay(fitPoints(r.points, document.getElementById('pad').clientWidth, pad.height, 40))
  }).catch((err) => { document.getElementById('pad').insertAdjacentHTML('afterend', `<div class="alert">${esc(err.message)}</div>`) })
  document.getElementById('clear').onclick = () => pad.clear()
  document.getElementById('next').onclick = () => go('ipad-forged')
}

function finish() {
  const missing = STEPS().filter((x) => x.id !== 'finish' && x.id !== 'practice' && !x.done)
  h(`${nav()}<div class="card"><h2>Finish</h2>
    ${missing.length ? `<div class="alert info">Not done yet: ${missing.map((x) => esc(x.label)).join(', ')}. You can go back, or finish now if you want to stop.</div>` : '<p>Everything is done. Thank you!</p>'}
    <p class="muted">When you tap Finish, this link stops working and nothing more can be added. If you want to withdraw later, contact the researcher; your data will be deleted.</p>
    <button id="done" class="big">Finish</button><div id="msg"></div></div>`)
  bindNav()
  document.getElementById('done').onclick = async () => {
    if (!confirm('Finish the session? This link will stop working.')) return
    try {
      await api('/api/p/finish', { method: 'POST' })
      h('<div class="card" style="max-width:560px;margin:60px auto;text-align:center"><h1>Thank you!</h1><p class="lead">Your session is complete. You can close this page.</p></div>')
    } catch (err) { document.getElementById('msg').innerHTML = `<div class="alert">${esc(err.message)}</div>` }
  }
}

function render() {
  if (step === 'welcome') return welcome()
  if (step === 'paper-genuine') return paperStep(false)
  if (step === 'paper-forged') return paperStep(true)
  if (step === 'ipad-genuine') return ipadStep(false)
  if (step === 'ipad-forged') return ipadStep(true)
  if (step === 'practice') return practice()
  return finish()
}

async function init() {
  if (!token) {
    h('<div class="card login"><h1>Link missing</h1><p class="lead">Please open the full link the researcher sent you.</p></div>')
    return
  }
  try {
    s = await api('/api/p/session')
    render()
  } catch (err) {
    h(`<div class="card login"><h1>Link not available</h1><p class="lead">${esc(err.message)}</p></div>`)
  }
}

init()
