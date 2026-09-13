import { describe, it, expect } from 'vitest'
import { formatWhen, describeBooking } from './bookingSummary'

describe('formatWhen', () => {
  it('formats a date + time as "Ddd D Mon HH:MM" without touching timezones', () => {
    expect(formatWhen('2026-09-13', '19:30:00')).toBe('Sun 13 Sep 19:30')
  })
  it('accepts HH:MM and single-digit days', () => {
    expect(formatWhen('2026-10-05', '12:00')).toBe('Mon 5 Oct 12:00')
  })
  it('tolerates missing time', () => {
    expect(formatWhen('2026-09-13', null)).toBe('Sun 13 Sep')
  })
})

describe('describeBooking', () => {
  const base = { guest_count: 4, reservation_date: '2026-09-13', reservation_time: '19:30:00', status: 'confirmed' }
  it('joins name, pax and when', () => {
    expect(describeBooking({ ...base, customer: { full_name: 'Jane Tan' } }))
      .toBe('Jane Tan · 4 pax · Sun 13 Sep 19:30')
  })
  it('falls back when the customer is missing', () => {
    expect(describeBooking({ ...base, customer: null })).toBe('Unknown customer · 4 pax · Sun 13 Sep 19:30')
  })
  it('flags pending bookings', () => {
    expect(describeBooking({ ...base, customer: { full_name: 'Jane Tan' }, status: 'pending' }))
      .toBe('Jane Tan · 4 pax · Sun 13 Sep 19:30 · needs approval')
  })
  it('flags bookings that got no table', () => {
    expect(describeBooking({ ...base, customer: { full_name: 'Jane Tan' }, needs_manual_assignment: true }))
      .toBe('Jane Tan · 4 pax · Sun 13 Sep 19:30 · no table')
  })
  it('orders both flags: approval then table', () => {
    expect(describeBooking({ ...base, customer: { full_name: 'Jane Tan' }, status: 'pending', needs_manual_assignment: true }))
      .toBe('Jane Tan · 4 pax · Sun 13 Sep 19:30 · needs approval · no table')
  })
})
