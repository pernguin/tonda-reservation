import { describe, it, expect, vi } from 'vitest'

vi.mock('../supabase', () => ({ supabase: {} }))

import { computeTableStatus, timeToMinutes, getLocalToday } from './tableAvailability'

const dateString = '2026-09-13'

function makeReservation(overrides = {}) {
  return {
    id: 'r1',
    table_ids: ['t1'],
    status: 'confirmed',
    reservation_time: '19:00:00',
    ...overrides
  }
}

function makeTable(overrides = {}) {
  return {
    id: 't1',
    is_bookable: true,
    locked_until: null,
    ...overrides
  }
}

function statusFor(result, tableId = 't1') {
  return result.find(r => r.table_id === tableId)
}

describe('computeTableStatus with atMinutes (today view)', () => {
  it('is free before arriving window', () => {
    const result = computeTableStatus({
      dateString,
      tables: [makeTable()],
      reservations: [makeReservation()],
      blocks: [],
      atMinutes: 12 * 60,
      holdMinutes: 120
    })
    expect(statusFor(result).status).toBe('free')
  })

  it('is arriving at 18:31', () => {
    const result = computeTableStatus({
      dateString,
      tables: [makeTable()],
      reservations: [makeReservation()],
      blocks: [],
      atMinutes: 18 * 60 + 31,
      holdMinutes: 120
    })
    expect(statusFor(result).status).toBe('arriving')
  })

  it('is arriving at 18:30 (boundary: 19:00 - 18:30 = 30)', () => {
    const result = computeTableStatus({
      dateString,
      tables: [makeTable()],
      reservations: [makeReservation()],
      blocks: [],
      atMinutes: 18 * 60 + 30,
      holdMinutes: 120
    })
    expect(statusFor(result).status).toBe('arriving')
  })

  it('is free at 18:29', () => {
    const result = computeTableStatus({
      dateString,
      tables: [makeTable()],
      reservations: [makeReservation()],
      blocks: [],
      atMinutes: 18 * 60 + 29,
      holdMinutes: 120
    })
    expect(statusFor(result).status).toBe('free')
  })

  it('is occupied at 19:00', () => {
    const result = computeTableStatus({
      dateString,
      tables: [makeTable()],
      reservations: [makeReservation()],
      blocks: [],
      atMinutes: 19 * 60,
      holdMinutes: 120
    })
    expect(statusFor(result).status).toBe('occupied')
  })

  it('is occupied at 20:59', () => {
    const result = computeTableStatus({
      dateString,
      tables: [makeTable()],
      reservations: [makeReservation()],
      blocks: [],
      atMinutes: 20 * 60 + 59,
      holdMinutes: 120
    })
    expect(statusFor(result).status).toBe('occupied')
  })

  it('is free at 21:00', () => {
    const result = computeTableStatus({
      dateString,
      tables: [makeTable()],
      reservations: [makeReservation()],
      blocks: [],
      atMinutes: 21 * 60,
      holdMinutes: 120
    })
    expect(statusFor(result).status).toBe('free')
  })

  it('is seated regardless of time when reservation status is seated', () => {
    const result = computeTableStatus({
      dateString,
      tables: [makeTable()],
      reservations: [makeReservation({ status: 'seated' })],
      blocks: [],
      atMinutes: 12 * 60,
      holdMinutes: 120
    })
    expect(statusFor(result).status).toBe('seated')
  })

  it('is blocked with block_id inside block window', () => {
    const result = computeTableStatus({
      dateString,
      tables: [makeTable()],
      reservations: [],
      blocks: [{ id: 'b1', table_id: 't1', start_time: '12:00', end_time: '14:00' }],
      atMinutes: 13 * 60,
      holdMinutes: 120
    })
    const rec = statusFor(result)
    expect(rec.status).toBe('blocked')
    expect(rec.block_id).toBe('b1')
  })

  it('is free right at block end', () => {
    const result = computeTableStatus({
      dateString,
      tables: [makeTable()],
      reservations: [],
      blocks: [{ id: 'b1', table_id: 't1', start_time: '12:00', end_time: '14:00' }],
      atMinutes: 14 * 60,
      holdMinutes: 120
    })
    expect(statusFor(result).status).toBe('free')
  })

  it('is blocked with null start/end at 23:00', () => {
    const result = computeTableStatus({
      dateString,
      tables: [makeTable()],
      reservations: [],
      blocks: [{ id: 'b1', table_id: 't1', start_time: null, end_time: null }],
      atMinutes: 23 * 60,
      holdMinutes: 120
    })
    expect(statusFor(result).status).toBe('blocked')
  })

  it('ignores locked_until when atMinutes is set', () => {
    const farFuture = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    const result = computeTableStatus({
      dateString,
      tables: [makeTable({ locked_until: farFuture })],
      reservations: [],
      blocks: [],
      atMinutes: 12 * 60,
      holdMinutes: 120
    })
    expect(statusFor(result).status).toBe('free')
  })

  it('is blocked when is_bookable is false', () => {
    const result = computeTableStatus({
      dateString,
      tables: [makeTable({ is_bookable: false })],
      reservations: [],
      blocks: [],
      atMinutes: 12 * 60,
      holdMinutes: 120
    })
    expect(statusFor(result).status).toBe('blocked')
  })
})

describe('computeTableStatus without atMinutes (existing behaviour)', () => {
  it('shows locked when locked_until is in the future on today', () => {
    const farFuture = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    const result = computeTableStatus({
      dateString: getLocalToday(), // legacy path only reports 'locked' on today's date
      tables: [makeTable({ locked_until: farFuture })],
      reservations: [],
      blocks: []
    })
    expect(statusFor(result).status).toBe('locked')
  })
})

describe('timeToMinutes', () => {
  it('parses HH:MM:SS', () => {
    expect(timeToMinutes('19:30:00')).toBe(1170)
  })

  it('returns null for null', () => {
    expect(timeToMinutes(null)).toBe(null)
  })
})
