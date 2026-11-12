// Update some query params and keep the rest. Filters live in the URL so a
// refresh keeps them and other pages can link straight to a filtered list.
// A null/undefined/'' value removes the param.
export function patchParams(setParams, patch, replace = true) {
  setParams((cur) => {
    const next = new URLSearchParams(cur)
    Object.entries(patch).forEach(([k, v]) => (v === null || v === undefined || v === '' ? next.delete(k) : next.set(k, String(v))))
    return next
  }, { replace })
}
