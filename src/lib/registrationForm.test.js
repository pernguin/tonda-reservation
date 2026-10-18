import { describe, expect, it } from 'vitest'
import { validateRegistration } from './registrationForm'

const isValidPhone = (p) => /^\d{8,15}$/.test(p)

describe('validateRegistration', () => {
  it('rejects a bad phone', () => {
    expect(validateRegistration({ phone: '123', pax: '2' }, isValidPhone)).toBe('Please enter a valid phone number.')
  })
  it.each(['0', '-2', '1.5', ''])('rejects pax %j', (pax) => {
    expect(validateRegistration({ phone: '60123456789', pax }, isValidPhone)).toBe('Please enter at least 1 guest.')
  })
  it('accepts a valid phone and pax', () => {
    expect(validateRegistration({ phone: '60123456789', pax: '3' }, isValidPhone)).toBeNull()
    expect(validateRegistration({ phone: '60123456789', pax: 1 }, isValidPhone)).toBeNull()
  })
})
