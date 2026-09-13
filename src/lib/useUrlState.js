import { useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'

export function readParam(params, key, def) {
  const v = params.get(key)
  return v == null || v === '' ? def : v
}
export function writeParam(params, key, value, def) {
  const next = new URLSearchParams(params)
  if (value == null || value === '' || value === def) next.delete(key); else next.set(key, value)
  return next
}
export function writeParams(params, values, defaults) {
  let next = new URLSearchParams(params)
  for (const [k, v] of Object.entries(values)) next = writeParam(next, k, v, defaults[k] ?? '')
  return next
}
// Single string param mirrored in the URL (replace navigation; default/empty deletes it).
export function useUrlState(key, def = '') {
  const [params, setParams] = useSearchParams()
  const value = readParam(params, key, def)
  const setValue = useCallback(v => setParams(p => writeParam(p, key, v, def), { replace: true }), [key, def, setParams])
  return [value, setValue]
}
// Several params at once: values object + one setter that merges a partial.
export function useUrlStateBatch(defaults) {
  const [params, setParams] = useSearchParams()
  const values = {}
  for (const k of Object.keys(defaults)) values[k] = readParam(params, k, defaults[k])
  const setValues = useCallback(partial => setParams(p => writeParams(p, partial, defaults), { replace: true }), [setParams]) // eslint-disable-line react-hooks/exhaustive-deps
  return [values, setValues]
}
