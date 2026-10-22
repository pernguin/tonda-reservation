import { describe, it, expect } from 'vitest'
import { confirmationPlan } from '../../supabase/functions/_shared/confirmationKind.ts'
import { buildConfirmationEmail } from '../../supabase/functions/_shared/emails.ts'

const reservation = {
  id: 'abc-123',
  reservation_date: '2026-10-18',
  reservation_time: '19:30:00',
  guest_count: 4,
  baby_chairs: 0,
  pets: false,
}
const customer = { full_name: 'Eve', email: 'eve@example.com' }

describe('confirmationPlan', () => {
  it('approval + confirmed claims approval_sent_at and renders Confirmed', () => {
    expect(confirmationPlan('approved', 'confirmed')).toEqual({ send: true, claimColumn: 'approval_sent_at' })
    const { html } = buildConfirmationEmail({ ...reservation, status: 'confirmed' }, customer)
    expect(html).toContain('Reservation Confirmed')
  })
  it('approval + pending skips', () => {
    const plan = confirmationPlan('approved', 'pending')
    expect(plan.send).toBe(false)
  })
  it('approval + other or missing status skips', () => {
    expect(confirmationPlan('approved', 'cancelled').send).toBe(false)
    expect(confirmationPlan('approved', null).send).toBe(false)
    expect(confirmationPlan('approved', undefined).send).toBe(false)
  })
  it('insert + pending claims confirmation_sent_at and renders Request Received', () => {
    expect(confirmationPlan(undefined, 'pending')).toEqual({ send: true, claimColumn: 'confirmation_sent_at' })
    const { html } = buildConfirmationEmail({ ...reservation, status: 'pending' }, customer)
    expect(html).toContain('Reservation Request Received')
  })
  it('insert + confirmed claims confirmation_sent_at and renders Confirmed', () => {
    expect(confirmationPlan(undefined, 'confirmed')).toEqual({ send: true, claimColumn: 'confirmation_sent_at' })
    const { html } = buildConfirmationEmail({ ...reservation, status: 'confirmed' }, customer)
    expect(html).toContain('Reservation Confirmed')
  })
  it('insert + other statuses skip', () => {
    expect(confirmationPlan(undefined, 'cancelled').send).toBe(false)
    expect(confirmationPlan('insert', 'completed').send).toBe(false)
  })
})
