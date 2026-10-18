import { describe, it, expect, vi } from 'vitest'
import { buildLogVisitArgs, logVisit } from './customerVisits'

const reservation = {
  id: 'res-1',
  customer_id: 'cust-1',
  guest_count: 4,
  reservation_date: '2026-10-17',
}

describe('buildLogVisitArgs', () => {
  it('returns null without a customer id', () => {
    expect(buildLogVisitArgs({ id: 'r', reservation_date: '2026-10-17' }, 'completed', 'tonda', 10)).toBeNull()
    expect(buildLogVisitArgs(null, 'completed', 'tonda', 10)).toBeNull()
  })

  it('sends the amount for completed', () => {
    expect(buildLogVisitArgs(reservation, 'completed', 'tonda', 120).p_amount_spent).toBe(120)
  })

  it('sends null for completed with an undefined amount', () => {
    expect(buildLogVisitArgs(reservation, 'completed', 'tonda', undefined).p_amount_spent).toBeNull()
  })

  it('ignores a supplied amount for no_show', () => {
    expect(buildLogVisitArgs(reservation, 'no_show', 'tonda', 50).p_amount_spent).toBeNull()
  })

  it.each(['pending', 'confirmed', 'seated', 'cancelled'])('passes %s through with a null amount', status => {
    const args = buildLogVisitArgs(reservation, status, 'tonda', 50)
    expect(args.p_status).toBe(status)
    expect(args.p_amount_spent).toBeNull()
  })

  it('builds the full argument object', () => {
    expect(buildLogVisitArgs(reservation, 'completed', 'tonda', 120)).toEqual({
      p_reservation_id: 'res-1',
      p_customer_id: 'cust-1',
      p_restaurant: 'tonda',
      p_status: 'completed',
      p_pax: 4,
      p_visited_at: '2026-10-17',
      p_amount_spent: 120,
    })
  })
})

describe('logVisit', () => {
  it('skips the rpc when there is no customer id', async () => {
    const client = { rpc: vi.fn() }
    expect(await logVisit(client, { id: 'r' }, 'completed', 'tonda', 10)).toBeNull()
    expect(client.rpc).not.toHaveBeenCalled()
  })

  it('returns null on success', async () => {
    const client = { rpc: vi.fn().mockResolvedValue({ error: null }) }
    expect(await logVisit(client, reservation, 'completed', 'tonda', 10)).toBeNull()
    expect(client.rpc).toHaveBeenCalledWith('log_visit', expect.objectContaining({ p_status: 'completed' }))
  })

  it('returns the rpc error', async () => {
    const error = { message: 'x' }
    const client = { rpc: vi.fn().mockResolvedValue({ error }) }
    expect(await logVisit(client, reservation, 'completed', 'tonda', 10)).toBe(error)
    expect(client.rpc).toHaveBeenCalledWith('log_visit', expect.any(Object))
  })

  it('returns a thrown error instead of throwing', async () => {
    const client = { rpc: vi.fn().mockRejectedValue(new Error('boom')) }
    const result = await logVisit(client, reservation, 'no_show', 'tonda')
    expect(result).toBeInstanceOf(Error)
    expect(result.message).toBe('boom')
    expect(client.rpc).toHaveBeenCalledWith('log_visit', expect.any(Object))
  })
})
