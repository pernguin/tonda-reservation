// `phone` is already normalised by the caller.
export function validateRegistration({ phone, pax }, isValidPhone) {
  if (!isValidPhone(phone)) return 'Please enter a valid phone number.'
  if (!Number.isInteger(Number(pax)) || Number(pax) < 1) return 'Please enter at least 1 guest.'
  return null
}
