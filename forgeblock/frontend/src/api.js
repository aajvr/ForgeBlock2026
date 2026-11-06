// Thin fetch wrapper around the FastAPI backend.
const BASE = import.meta.env.VITE_API_URL || ''
const TOKEN_KEY = 'forgeblock_token'

export const getToken = () => localStorage.getItem(TOKEN_KEY)
export const setToken = (t) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY))

async function request(path, { method = 'GET', body, form, raw } = {}) {
  const headers = {}
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`
  let payload
  if (form) payload = form
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    payload = JSON.stringify(body)
  }
  let res
  try {
    res = await fetch(`${BASE}${path}`, { method, headers, body: payload })
  } catch {
    throw new Error('Cannot reach the ForgeBlock server. Is the backend running?')
  }
  if (!res.ok) {
    let msg = `Request failed (${res.status})`
    try {
      const data = await res.json()
      if (typeof data.detail === 'string') msg = data.detail
      else if (Array.isArray(data.detail)) msg = data.detail.map((d) => d.msg).join('; ')
    } catch { /* not JSON */ }
    if (res.status === 401 && token) {
      setToken(null)
      window.dispatchEvent(new CustomEvent('forgeblock:logout', { detail: msg }))
    }
    throw new Error(msg)
  }
  if (raw) return res
  return res.status === 204 ? null : res.json()
}

export const api = {
  get: (p) => request(p),
  post: (p, body) => request(p, { method: 'POST', body }),
  patch: (p, body) => request(p, { method: 'PATCH', body }),
  put: (p, body) => request(p, { method: 'PUT', body }),
  del: (p) => request(p, { method: 'DELETE' }),
  upload: (p, form) => request(p, { method: 'POST', form }),
  blob: async (p, opts = {}) => (await request(p, { ...opts, raw: true })).blob(),
  raw: (p, opts = {}) => request(p, { ...opts, raw: true }),
}
