import { describe, it, expect } from 'vitest'
import { voucherExpiry } from './voucher'

describe('voucherExpiry', () => {
  it('adds one month', () => {
    expect(voucherExpiry(new Date('2026-09-18T10:00:00Z'))).toMatch(/^2026-10-18/)
  })

  it('rolls over the year', () => {
    expect(voucherExpiry(new Date('2026-12-18T10:00:00Z'))).toMatch(/^2027-01-18/)
  })
})
