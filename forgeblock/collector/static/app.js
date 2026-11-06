// ForgeBlock data collection: a small no-build single page app (hash routes).
'use strict'

const $view = document.getElementById('view')
const KEY_STORE = 'fbc-key'
let key = ''
try { key = sessionStorage.getItem(KEY_STORE) || '' } catch { /* private mode */ }

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const h = (html) => { $view.innerHTML = html }

async function api(path, opts = {}) {
  const headers = { 'X-Collector-Key': key, ...(opts.json ? { 'Content-Type': 'application/json' } : {}) }
  const res = await fetch(path, { ...opts, headers, body: opts.json ? JSON.stringify(opts.json) : opts.body })
  if (res.status === 401) { key = ''; route(); throw new Error('Wrong researcher key.') }
  if (!res.ok) {
    let msg = `Request failed (${res.status})`
    try { const d = await res.json(); msg = typeof d.detail === 'string' ? d.detail : msg } catch { /* not json */ }
    throw new Error(msg)
  }
  return res.headers.get('content-type')?.includes('json') ? res.json() : res.blob()
}

async function openBlob(path) {
  const blob = await api(path)
  window.open(URL.createObjectURL(blob), '_blank')
}

// ---------------------------------------------------------------- views ---

function loginView() {
  h(`<div class="card login">
    <h1>Researcher key</h1>
    <p class="lead">This tool is for the research team only. Participants never sign in.</p>
    <form id="f"><label class="f">Key<input type="password" id="k" autofocus required></label>
    <div id="err"></div><button>Continue</button></form></div>`)
  document.getElementById('f').onsubmit = async (e) => {
    e.preventDefault()
    key = document.getElementById('k').value
    try {
      await api('/api/check-key')
      try { sessionStorage.setItem(KEY_STORE, key) } catch { /* private mode */ }
      route()
    } catch (err) {
      document.getElementById('err').innerHTML = `<div class="alert">${esc(err.message)}</div>`
    }
  }
}

const fmtDate = (iso) => new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const remotePills = (s) => [
  s.link_expires_at ? `<span class="pill ok">link until ${esc(fmtDate(s.link_expires_at))}</span>` : '',
  s.finished_at ? '<span class="pill">finished online</span>' : '',
  s.pending_sheets?.length ? '<a href="#/import" class="pill warn">sheet to review</a>' : '',
].filter(Boolean).join(' ') || '<span class="muted">-</span>'

const pill = (n, total) => `<span class="pill ${n >= total ? 'ok' : n ? 'warn' : ''}">${n}/${total}</span>`

async function sessionsView() {
  const { sessions, next_code } = await api('/api/sessions')
  h(`<h1>Sessions</h1>
  <p class="lead">One session of about 15 minutes per participant. Forgery targets are assigned automatically: the earliest participant with all 20 iPad genuine signatures who has no forger yet.</p>
  <div class="card"><h2>New session</h2>
    <form id="f" class="row" style="align-items:flex-end">
      <label class="f" style="width:160px">Participant code<input id="code" value="${esc(next_code)}" pattern="P\\d{3,4}" required></label>
      <label class="f grow">Researcher<input id="res" required placeholder="Your name"></label>
      <label class="f" style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="consent" style="width:auto;margin:0">Signed consent form received</label>
      <button style="margin-bottom:12px">Start session</button>
    </form><div id="err"></div></div>
  <div class="card"><table>
    <thead><tr><th>Code</th><th>Paper genuine</th><th>iPad genuine</th><th>Forges</th><th>Paper forgeries</th><th>iPad forgeries</th><th>Forged by</th><th>Remote</th><th>Started</th></tr></thead>
    <tbody>${sessions.map((s) => `<tr>
      <td><a href="#/session/${s.code}">${s.code}</a>${s.withdrawn ? ' <span class="pill bad">withdrawn</span>' : ''}</td>
      <td>${pill(s.progress.paper_genuine, 20)}</td><td>${pill(s.progress.dynamic_genuine, 20)}</td>
      <td>${s.target ? esc(s.target) : '<span class="muted">none</span>'}</td>
      <td>${s.target ? pill(s.progress.paper_forged, 20) : '-'}</td><td>${s.target ? pill(s.progress.dynamic_forged, 10) : '-'}</td>
      <td>${s.progress.forged_by ? esc(s.progress.forged_by) : '<span class="muted">-</span>'}</td>
      <td>${remotePills(s)}</td>
      <td class="muted">${esc(s.created_at.slice(0, 10))}</td></tr>`).join('') || '<tr><td colspan="9" class="muted">No sessions yet.</td></tr>'}
    </tbody></table></div>`)
  document.getElementById('f').onsubmit = async (e) => {
    e.preventDefault()
    try {
      const s = await api('/api/sessions', { method: 'POST', json: { code: document.getElementById('code').value.trim().toUpperCase(), researcher: document.getElementById('res').value, consent: document.getElementById('consent').checked } })
      location.hash = `#/session/${s.code}`
    } catch (err) {
      document.getElementById('err').innerHTML = `<div class="alert">${esc(err.message)}</div>`
    }
  }
}

const STEPS = [
  { id: 'paper-genuine', label: '1 · Paper genuine' },
  { id: 'ipad-genuine', label: '2 · iPad genuine' },
  { id: 'paper-forged', label: '3 · Paper forgeries' },
  { id: 'practice', label: '4 · Tracing practice' },
  { id: 'ipad-forged', label: '5 · iPad forgeries' },
  { id: 'done', label: '6 · Finish' },
]

function bindRemote(code) {
  const mk = document.getElementById('mklink')
  if (!mk) return
  mk.onclick = async () => {
    try {
      const r = await api(`/api/sessions/${code}/link`, { method: 'POST', json: { hours: +document.getElementById('hours').value } })
      const url = new URL(r.path, location.href).href
      document.getElementById('linkstate').innerHTML = `Active until <b>${esc(fmtDate(r.expires_at))}</b>. Send this link to the participant privately (email or direct message). It is shown only once.`
      document.getElementById('linkout').innerHTML = `<div class="row" style="margin-top:10px"><input id="linkurl" class="grow mono" readonly value="${esc(url)}" style="padding:9px 12px;border:1px solid #cbd5e1;border-radius:8px;font-size:13px"><button id="copy">Copy</button></div>`
      document.getElementById('copy').onclick = async () => {
        const inp = document.getElementById('linkurl')
        try { await navigator.clipboard.writeText(inp.value) } catch { inp.select(); document.execCommand('copy') }
        document.getElementById('copy').textContent = 'Copied'
      }
      mk.textContent = 'New link'
    } catch (err) { document.getElementById('linkout').innerHTML = `<div class="alert">${esc(err.message)}</div>` }
  }
  const rm = document.getElementById('rmlink')
  if (rm) rm.onclick = async () => {
    if (!confirm('Stop the current link? The participant will not be able to continue with it.')) return
    await api(`/api/sessions/${code}/link`, { method: 'DELETE' })
    route()
  }
}

async function sessionView(code, step) {
  let s = await api(`/api/sessions/${code}`)
  step = step || 'paper-genuine'
  const pr = s.progress
  const done = { 'paper-genuine': pr.paper_genuine >= 20, 'ipad-genuine': pr.dynamic_genuine >= 20, 'paper-forged': pr.paper_forged >= 20, 'ipad-forged': pr.dynamic_forged >= 10 }
  const go = (id) => `#/session/${code}/${id}`
  const head = `<div class="row"><div class="grow"><h1>${esc(code)}</h1>
    <p class="lead">User ${s.user} in the SVC2004 files · ${s.target ? `forges <b>${esc(s.target)}</b>` : 'no forgery target'} · consent ${esc(s.consent_at.slice(0, 10))} · ${esc(s.researcher)}</p></div>
    <a class="btn secondary" href="#/">All sessions</a></div>
    ${s.withdrawn ? '<div class="alert">This participant withdrew. Their signature data was deleted.</div>' : ''}
    ${s.withdrawn ? '' : `<div class="card remote"><div class="row"><div class="grow"><h2>Remote link</h2>
      <p class="muted" id="linkstate">${s.link_expires_at ? `A personal link is active until <b>${esc(fmtDate(s.link_expires_at))}</b>. For safety it is shown only once; make a new one if it was lost (the old one stops working).` : s.finished_at ? `The participant finished online on ${esc(fmtDate(s.finished_at))}.` : 'For a participant doing the session on their own iPad. They never see the researcher key.'}</p></div>
      <label class="f" style="width:150px;margin:0">Valid for<select id="hours"><option value="24">1 day</option><option value="72" selected>3 days</option><option value="168">7 days</option><option value="336">14 days</option></select></label>
      <button id="mklink" class="secondary">${s.link_expires_at ? 'New link' : 'Create link'}</button>
      ${s.link_expires_at ? '<button id="rmlink" class="ghost">Revoke</button>' : ''}</div>
      <div id="linkout"></div></div>`}
    <div class="steps">${STEPS.map((x) => `<button data-go="${x.id}" class="${x.id === step ? 'on' : ''} ${done[x.id] ? 'done' : ''}">${done[x.id] ? '✓ ' : ''}${x.label}</button>`).join('')}</div>`
  const bindSteps = () => {
    document.querySelectorAll('[data-go]').forEach((b) => { b.onclick = () => { location.hash = go(b.dataset.go) } })
    bindRemote(code)
  }
  const noTarget = `<div class="card"><h2>No forgery target yet</h2><p class="muted">Early participants have no one to forge yet. Skip this step, or assign a target now if someone is ready.</p>
    <div id="err"></div><div class="row"><button id="assign" class="secondary">Assign a target</button><button id="skip">Skip to finish</button></div></div>`
  const bindNoTarget = () => {
    document.getElementById('assign').onclick = async () => {
      try { await api(`/api/sessions/${code}/assign-target`, { method: 'POST' }); route() } catch (err) { document.getElementById('err').innerHTML = `<div class="alert">${esc(err.message)}</div>` }
    }
    document.getElementById('skip').onclick = () => { location.hash = go('done') }
  }

  if (step === 'paper-genuine' || step === 'paper-forged') {
    const forged = step === 'paper-forged'
    if (forged && !s.target) { h(head + noTarget); bindSteps(); bindNoTarget(); return }
    h(`${head}<div class="card"><div class="row"><div class="grow">
      <h2>${forged ? `Paper: 20 forgeries of ${esc(s.target)}` : 'Paper: 20 genuine signatures'}</h2>
      <p class="muted">${forged ? `Give the participant the forgery sheet and ${esc(s.target)}'s signature to study. They imitate it once in each box.` : 'Give the participant the genuine sheet. They sign once in each of the 20 boxes, as they normally sign.'}
      Scan the sheet later in Sheet import.</p></div>
      <button id="print" class="secondary">Print ${forged ? 'forgery' : 'genuine'} sheet</button></div>
      ${forged ? '<p class="muted">Signature to imitate (first iPad genuine of the target):</p><canvas id="ref" class="ref" style="width:100%;height:180px"></canvas>' : ''}
      <p class="muted">Imported so far: ${pill(forged ? pr.paper_forged : pr.paper_genuine, 20)}</p>
      <button id="next">Next step</button></div>`)
    document.getElementById('print').onclick = () => openBlob(`/api/template?participant=${code}&kind=${forged ? 'forgery' : 'genuine'}&target=${forged ? s.target : ''}`)
    document.getElementById('next').onclick = () => { location.hash = go(forged ? 'practice' : 'ipad-genuine') }
    if (forged) api(`/api/sessions/${code}/reference`).then((r) => drawRef(document.getElementById('ref'), r.points)).catch(() => {})
    bindSteps()
    return
  }

  if (step === 'practice') {
    if (!s.target) { h(head + noTarget); bindSteps(); bindNoTarget(); return }
    h(`${head}<div class="card"><h2>Tracing practice (not saved)</h2>
      <p class="muted">The participant traces over ${esc(s.target)}'s signature to learn its shape. Nothing here is saved. Clear and repeat as often as needed.</p>
      <div class="padwrap" id="pad"></div>
      <div class="row" style="margin-top:12px"><button id="clear" class="secondary">Clear</button><span class="grow"></span><button id="next">Start the 10 forgeries</button></div></div>`)
    const pad = makePad(document.getElementById('pad'))
    api(`/api/sessions/${code}/reference`).then((r) => {
      const wrap = document.getElementById('pad')
      pad.setOverlay(fitPoints(r.points, wrap.clientWidth, pad.height, 40))
    }).catch((err) => { document.getElementById('pad').insertAdjacentHTML('afterend', `<div class="alert">${esc(err.message)}</div>`) })
    document.getElementById('clear').onclick = () => pad.clear()
    document.getElementById('next').onclick = () => { location.hash = go('ipad-forged') }
    bindSteps()
    return
  }

  if (step === 'ipad-genuine' || step === 'ipad-forged') {
    const forged = step === 'ipad-forged'
    if (forged && !s.target) { h(head + noTarget); bindSteps(); bindNoTarget(); return }
    const total = forged ? 10 : 20
    h(`${head}<div class="card">
      <div class="row"><div class="grow"><h2>${forged ? `iPad: 10 forgeries of ${esc(s.target)}` : 'iPad: 20 genuine signatures'}</h2>
      <p class="muted">Use the Apple Pencil. Sign on the line, then tap Save. ${forged ? 'The signature to imitate is shown above the pad; no tracing here.' : 'Sign naturally each time.'}</p></div>
      <div class="counter" id="count"></div></div>
      <div class="bar" style="margin-bottom:14px"><div id="bar"></div></div>
      ${forged ? '<canvas id="ref" class="ref" style="width:100%;height:150px;margin-bottom:12px"></canvas>' : ''}
      <div class="padwrap" id="pad"></div>
      <div id="msg"></div>
      <div class="row" style="margin-top:12px">
        <button id="undo" class="ghost">Delete last saved</button><span class="grow"></span>
        <button id="clear" class="secondary">Clear</button><button id="save" class="big" disabled>Save signature</button></div></div>`)
    let n = forged ? pr.dynamic_forged : pr.dynamic_genuine
    const show = () => {
      document.getElementById('count').innerHTML = `${n}<small> / ${total}</small>`
      document.getElementById('bar').style.width = `${(100 * n) / total}%`
    }
    show()
    const msg = (html) => { document.getElementById('msg').innerHTML = html }
    const save = document.getElementById('save')
    const pad = makePad(document.getElementById('pad'), { onStroke: () => { save.disabled = pad.penCount() < 10 || n >= total } })
    if (forged) api(`/api/sessions/${code}/reference`).then((r) => drawRef(document.getElementById('ref'), r.points)).catch(() => {})
    document.getElementById('clear').onclick = () => { pad.clear(); msg('') }
    save.onclick = async () => {
      save.disabled = true
      try {
        const r = await api(`/api/sessions/${code}/dynamic`, { method: 'POST', json: { kind: forged ? 'forged' : 'genuine', points: pad.points, height: pad.height, pointer: pad.pointer } })
        n += 1
        show()
        pad.clear()
        msg(`<div class="alert ok">Saved ${esc(r.file)}${pad.pointer !== 'pen' ? ' (not an Apple Pencil: no real pressure or tilt)' : ''}.</div>`)
        if (n >= total) msg(`<div class="alert ok">All ${total} saved. <a href="${go(forged ? 'done' : 'paper-forged')}">Continue</a></div>`)
      } catch (err) {
        msg(`<div class="alert">${esc(err.message)}</div>`)
        save.disabled = false
      }
    }
    document.getElementById('undo').onclick = async () => {
      if (!confirm('Delete the most recently saved signature?')) return
      try {
        const r = await api(`/api/sessions/${code}/dynamic/last?kind=${forged ? 'forged' : 'genuine'}`, { method: 'DELETE' })
        n -= 1
        show()
        msg(`<div class="alert info">Deleted ${esc(r.deleted)}.</div>`)
      } catch (err) { msg(`<div class="alert">${esc(err.message)}</div>`) }
    }
    bindSteps()
    return
  }

  // Finish
  h(`${head}<div class="card"><h2>Finish</h2>
    <p class="muted">Paper genuine ${pill(pr.paper_genuine, 20)} · iPad genuine ${pill(pr.dynamic_genuine, 20)}${s.target ? ` · Paper forgeries ${pill(pr.paper_forged, 20)} · iPad forgeries ${pill(pr.dynamic_forged, 10)}` : ''}</p>
    <label class="f">Session notes<textarea id="notes" rows="3">${esc(s.notes)}</textarea></label>
    <div class="row"><button id="savenotes" class="secondary">Save notes</button><span id="saved" class="muted"></span><span class="grow"></span>
    ${s.withdrawn ? '' : '<button id="withdraw" class="danger">Participant withdrew</button>'}</div></div>`)
  bindSteps()
  document.getElementById('savenotes').onclick = async () => {
    s = await api(`/api/sessions/${code}/notes`, { method: 'PUT', json: { notes: document.getElementById('notes').value } })
    document.getElementById('saved').textContent = 'Saved.'
  }
  const w = document.getElementById('withdraw')
  if (w) w.onclick = async () => {
    if (!confirm(`Delete all signature data of ${code}, including forgeries they made? This cannot be undone.`)) return
    await api(`/api/sessions/${code}/withdraw`, { method: 'POST' })
    route()
  }
}

async function importView() {
  const [{ sessions }, { pending }] = await Promise.all([api('/api/sessions'), api('/api/sheets/pending')])
  const active = sessions.filter((s) => !s.withdrawn)
  const kindLabel = (k) => (k === 'genuine' ? 'genuine sheet' : 'forgery sheet')
  h(`<h1>Sheet import</h1>
  <p class="lead">Upload a scan or a flat phone photo of a filled sheet. The four black corner squares are used to straighten it, then the 20 boxes are cropped. Check the crops, untick any bad box, and save.</p>
  ${pending.length ? `<div class="card"><h2>Waiting for review</h2><p class="muted">Photos sent through remote links, and earlier previews that were not saved. Nothing enters the dataset until you save it.</p>
    <table><tbody>${pending.map((x, i) => `<tr><td><b>${esc(x.code)}</b> · ${kindLabel(x.kind)}</td>
      <td class="muted">${x.source === 'participant' ? 'sent by participant' : 'researcher preview'} · ${esc(fmtDate(x.uploaded_at))} · ${x.boxes.filter((b) => !b.empty).length}/20 boxes with ink</td>
      <td style="text-align:right"><button class="secondary" data-review="${i}">Review</button> <button class="ghost" data-discard="${i}">Discard</button></td></tr>`).join('')}</tbody></table></div>` : ''}
  <div class="card"><form id="f" class="row" style="align-items:flex-end">
    <label class="f" style="width:160px">Participant<select id="code">${active.map((s) => `<option value="${s.code}">${s.code}</option>`).join('')}</select></label>
    <label class="f" style="width:220px">Sheet<select id="kind"><option value="genuine">Genuine signatures</option><option value="forged">Forgeries (of their target)</option></select></label>
    <label class="f grow">Scan<input type="file" id="scan" accept="image/*" required></label>
    <button style="margin-bottom:12px">Crop boxes</button></form>
    <div class="row"><button id="blank" class="secondary" type="button">Print a blank sheet</button><span class="muted">Short bond, landscape, actual size (no "fit to page").</span></div>
    <div id="err"></div></div>
  <div id="out"></div>`)
  document.getElementById('blank').onclick = () => openBlob('/api/template')
  const out = document.getElementById('out')
  document.querySelectorAll('[data-review]').forEach((b) => {
    b.onclick = () => { const x = pending[+b.dataset.review]; showReview(out, x.code, x.kind, x.boxes); out.scrollIntoView({ behavior: 'smooth' }) }
  })
  document.querySelectorAll('[data-discard]').forEach((b) => {
    b.onclick = async () => {
      const x = pending[+b.dataset.discard]
      if (!confirm(`Discard the ${kindLabel(x.kind)} photo of ${x.code}? The participant can send a new one while their link is active.`)) return
      await api(`/api/sheets/staging/${x.code}/${x.kind}`, { method: 'DELETE' })
      route()
    }
  })
  document.getElementById('f').onsubmit = async (e) => {
    e.preventDefault()
    const code = document.getElementById('code').value
    const kind = document.getElementById('kind').value
    const fd = new FormData()
    fd.append('code', code); fd.append('kind', kind); fd.append('scan', document.getElementById('scan').files[0])
    const err = document.getElementById('err')
    err.innerHTML = '<div class="alert info">Straightening and cropping…</div>'
    out.innerHTML = ''
    try {
      const r = await api('/api/sheets/preview', { method: 'POST', body: fd })
      err.innerHTML = ''
      await showReview(out, code, kind, r.boxes)
    } catch (e2) {
      err.innerHTML = `<div class="alert">${esc(e2.message)}</div>`
    }
  }
}

async function showReview(out, code, kind, boxes) {
  const keep = new Set(boxes.filter((b) => !b.empty).map((b) => b.index))
  const img = async (name) => URL.createObjectURL(await api(`/api/sheets/staging/${code}/${kind}/${name}`))
  out.innerHTML = `<div class="card"><h2>Straightened sheet</h2><img id="sheet" style="width:100%;border:1px solid var(--line);border-radius:8px"></div>
    <div class="card"><div class="row"><h2 class="grow">Crops (${esc(code)}, ${esc(kind)})</h2><span class="muted">Click a box to include or exclude it. Empty boxes start excluded.</span></div>
    <div class="grid5" style="margin-top:12px">${boxes.map((b) => `<div class="crop ${keep.has(b.index) ? '' : 'off'}" data-i="${b.index}"><span class="n">${b.index}</span>${b.empty ? '<span class="e pill warn">empty</span>' : ''}<img data-name="box${String(b.index).padStart(2, '0')}.png"></div>`).join('')}</div>
    <div class="row" style="margin-top:16px"><span class="muted grow" id="count"></span><button id="save">Save crops to the dataset</button></div><div id="done"></div></div>`
  document.getElementById('sheet').src = await img('sheet.png')
  for (const el of out.querySelectorAll('img[data-name]')) el.src = await img(el.dataset.name)
  const count = () => { document.getElementById('count').textContent = `${keep.size} of 20 selected` }
  count()
  out.querySelectorAll('.crop').forEach((el) => {
    el.onclick = () => {
      const i = +el.dataset.i
      if (keep.has(i)) keep.delete(i); else keep.add(i)
      el.classList.toggle('off', !keep.has(i))
      count()
    }
  })
  document.getElementById('save').onclick = async () => {
    try {
      const s = await api('/api/sheets/save', { method: 'POST', json: { code, kind, keep: [...keep] } })
      document.getElementById('done').innerHTML = `<div class="alert ok">Saved ${s.saved.length} labeled crops. <a href="#/import" onclick="setTimeout(route)">Back to the list</a></div>`
      document.getElementById('save').disabled = true
    } catch (e2) { document.getElementById('done').innerHTML = `<div class="alert">${esc(e2.message)}</div>` }
  }
}

async function datasetView() {
  const { sessions } = await api('/api/sessions')
  const sum = (k) => sessions.reduce((a, s) => a + s.progress[k], 0)
  h(`<h1>Dataset</h1>
  <p class="lead">Export for training and evaluation. The zip holds personal research data: save it only to the secured research device.</p>
  <div class="card two">
    <div><div class="muted">Participants</div><div class="counter">${sessions.filter((s) => !s.withdrawn).length}</div></div>
    <div><div class="muted">iPad signatures (SVC2004 files)</div><div class="counter">${sum('dynamic_genuine') + sum('dynamic_forged')}</div>
      <div class="muted">${sum('dynamic_genuine')} genuine · ${sum('dynamic_forged')} forged</div></div>
    <div><div class="muted">Paper crops</div><div class="counter">${sum('paper_genuine') + sum('paper_forged')}</div>
      <div class="muted">${sum('paper_genuine')} genuine · ${sum('paper_forged')} forged</div></div>
    <div style="align-self:end"><button id="export" class="big">Export dataset (.zip)</button></div>
  </div>
  <div class="card"><h2>Format</h2><p class="muted mono" style="line-height:1.7">
    dynamic/U{user}S{n}.TXT · SVC2004: first line = point count, then X Y TIME PEN AZIMUTH ALTITUDE PRESSURE<br>
    S1–S20 genuine · S21–S30 forgeries of that user by another participant<br>
    static/P###/genuine/P###_G##.png · static/P###/forged/P###_F##_by_P###.png<br>
    manifest.csv lists every file with its label and who wrote it</p></div>`)
  document.getElementById('export').onclick = async () => {
    const blob = await api('/api/export')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `forgeblock-dataset-${new Date().toISOString().slice(0, 10)}.zip`
    a.click()
  }
}

async function route() {
  if (!key) return loginView()
  const parts = location.hash.replace(/^#\/?/, '').split('/')
  document.querySelectorAll('.top nav a').forEach((a) => a.classList.toggle('active', a.getAttribute('href') === `#/${parts[0] === 'session' ? '' : parts[0]}`))
  try {
    if (parts[0] === 'session' && parts[1]) await sessionView(parts[1], parts[2])
    else if (parts[0] === 'import') await importView()
    else if (parts[0] === 'dataset') await datasetView()
    else await sessionsView()
  } catch (err) {
    if (key) h(`<div class="alert">${esc(err.message)}</div>`)
  }
}

window.addEventListener('hashchange', route)
route()
