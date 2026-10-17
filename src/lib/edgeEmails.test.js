import { describe, it, expect } from 'vitest'
import {
  buildConfirmationEmail,
  buildThankyouEmail,
  buildReminderEmail,
} from '../../supabase/functions/_shared/emails.ts'

const reservation = {
  id: 'abc-123',
  status: 'confirmed',
  reservation_date: '2026-10-18',
  reservation_time: '19:30:00',
  guest_count: 4,
  baby_chairs: 0,
  pets: false,
}
const customer = { full_name: "<b>Eve</b> O'Neil", email: 'eve@example.com' }

describe('buildConfirmationEmail', () => {
  it('escapes the customer name', () => {
    const { html } = buildConfirmationEmail(reservation, { full_name: '<b>Eve</b> O\'Neil' })
    expect(html).toContain('&lt;b&gt;Eve&lt;/b&gt;')
    expect(html).not.toContain('<b>Eve')
  })
  it('falls back to "there" with no name', () => {
    const { html } = buildConfirmationEmail(reservation, { full_name: null })
    expect(html).toContain('Hi there,')
  })
  it('confirmed copy', () => {
    const { html, subject } = buildConfirmationEmail(reservation, customer)
    expect(html).toContain('Reservation Confirmed')
    expect(subject.endsWith('is confirmed')).toBe(true)
  })
  it('pending copy', () => {
    const { html, subject } = buildConfirmationEmail({ ...reservation, status: 'pending' }, customer)
    expect(html).toContain('Reservation Request Received')
    expect(html).toContain('confirm your booking shortly')
    expect(html).not.toContain('Reservation Confirmed')
    expect(subject).toContain('received your reservation request')
  })
  it('includes the manage link', () => {
    const { html } = buildConfirmationEmail(reservation, customer)
    expect(html).toContain('https://tonda-reservation.vercel.app/booking/abc-123')
  })
  it('shows baby chairs and pets', () => {
    const { html } = buildConfirmationEmail({ ...reservation, baby_chairs: 2, pets: true }, customer)
    expect(html).toContain('Baby chairs: 2')
    expect(html).toContain('Pets: Yes')
  })
})

describe('buildThankyouEmail', () => {
  it('escapes & in the feedback url', () => {
    const { html, subject } = buildThankyouEmail(customer, 'https://x.test/feedback?reservation=1&restaurant=tonda')
    expect(html).toContain('https://x.test/feedback?reservation=1&amp;restaurant=tonda')
    expect(subject).toBe('Thank you for dining with us at Tonda Pizza Romana')
  })
})

describe('buildReminderEmail', () => {
  it('says tomorrow', () => {
    const { html, subject } = buildReminderEmail(reservation, customer, 'tomorrow')
    expect(html).toContain('reservation tomorrow')
    expect(subject).toContain('is tomorrow')
  })
  it('says today', () => {
    const { html, subject } = buildReminderEmail(reservation, customer, 'today')
    expect(html).toContain('reservation today')
    expect(subject).toContain('is today')
  })
})
