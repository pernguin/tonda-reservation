export function isEligibleReservation(row) {
  return !!row && row.status === 'completed'
}

const VIEWS = ['submitted', 'repeat', 'new']

export function viewForFeedbackState(state) {
  return VIEWS.includes(state) ? state : 'invalid'
}

// submit_feedback returns a table: an array of one row, or an object. Repeat feedback has a null code.
export function parseSubmitResult(data) {
  const row = Array.isArray(data) ? data[0] : data
  if (!row || !row.voucher_code) return null
  return { code: row.voucher_code, expiresAt: row.voucher_expires_at }
}
