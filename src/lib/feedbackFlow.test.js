import { describe, expect, it } from 'vitest'
import { isEligibleReservation, viewForFeedbackState, parseSubmitResult } from './feedbackFlow'

describe('isEligibleReservation', () => {
  it('accepts a completed reservation only', () => {
    expect(isEligibleReservation({ status: 'completed' })).toBe(true)
    expect(isEligibleReservation({ status: 'confirmed' })).toBe(false)
    expect(isEligibleReservation(null)).toBe(false)
  })
})

describe('viewForFeedbackState', () => {
  it.each(['submitted', 'repeat', 'new'])('maps %s to itself', (s) => {
    expect(viewForFeedbackState(s)).toBe(s)
  })
  it('maps anything else to invalid', () => {
    expect(viewForFeedbackState(undefined)).toBe('invalid')
    expect(viewForFeedbackState('weird')).toBe('invalid')
  })
})

describe('parseSubmitResult', () => {
  const row = { voucher_code: 'NAPOLI-07', voucher_expires_at: '2026-11-17T00:00:00Z' }
  const expected = { code: 'NAPOLI-07', expiresAt: '2026-11-17T00:00:00Z' }
  it('reads an array with a voucher', () => {
    expect(parseSubmitResult([row])).toEqual(expected)
  })
  it('reads an object with a voucher', () => {
    expect(parseSubmitResult(row)).toEqual(expected)
  })
  it('returns null for a repeat (null code), empty array and null', () => {
    expect(parseSubmitResult([{ voucher_code: null, voucher_expires_at: null }])).toBeNull()
    expect(parseSubmitResult([])).toBeNull()
    expect(parseSubmitResult(null)).toBeNull()
  })
})
