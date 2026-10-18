// PostgREST returns a `returns table` function as an array of rows.
export function firstRow(data) {
  if (Array.isArray(data)) return data[0] ?? null
  return data ?? null
}

export function prefillName(currentName, row) {
  if (currentName) return currentName
  return row?.first_name || ''
}
