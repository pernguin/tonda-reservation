import { describe, it, expect } from 'vitest'
import { isSlotBookable, LEAD_TIME_MINUTES } from './slotCutoff'

// `now` is passed in rather than read from the clock so these stay deterministic.
const now = new Date(2026, 8, 22, 19, 20) // 2026-09-22 19:20 local

describe('isSlotBookable', () => {
  it('allows any slot on a future date', () => {
    expect(isSlotBookable('12:00', '2026-09-23', now)).toBe(true)
  })

  it('rejects a slot already past today', () => {
    expect(isSlotBookable('12:00', '2026-09-22', now)).toBe(false)
  })

  it('rejects a slot inside the lead time', () => {
    expect(isSlotBookable('19:30', '2026-09-22', now)).toBe(false)
  })

  it('allows a slot exactly at the lead-time boundary', () => {
    expect(isSlotBookable('19:50', '2026-09-22', now)).toBe(true)
  })

  it('allows a slot comfortably later today', () => {
    expect(isSlotBookable('20:00', '2026-09-22', now)).toBe(true)
  })

  it('handles seconds in the slot value', () => {
    expect(isSlotBookable('20:00:00', '2026-09-22', now)).toBe(true)
  })

  it('exposes the lead time it enforces', () => {
    expect(LEAD_TIME_MINUTES).toBe(30)
  })
})
