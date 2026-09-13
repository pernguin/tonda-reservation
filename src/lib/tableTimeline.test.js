import { describe, it, expect, vi } from 'vitest'

vi.mock('../supabase', () => ({ supabase: {} }))

import { buildTimeline, formatClock, AXIS_START, AXIS_END } from './tableTimeline'

describe('buildTimeline', () => {
  it('defaults to the 11:00-23:00 axis and no segments when nothing falls outside', () => {
    const result = buildTimeline({})
    expect(result.axisStart).toBe(AXIS_START)
    expect(result.axisEnd).toBe(AXIS_END)
    expect(result.segments).toEqual([])
  })

  it('lays out one reservation at 19:30 with a 120min hold', () => {
    const result = buildTimeline({
      reservations: [{ id: 'r1', reservation_time: '19:30:00', status: 'confirmed', guest_count: 4, customers: { full_name: 'Jane Doe' } }],
      holdMinutes: 120
    })
    expect(result.segments).toHaveLength(1)
    const seg = result.segments[0]
    expect(seg.kind).toBe('reservation')
    expect(seg.left).toBeCloseTo(70.83, 1)
    expect(seg.width).toBeCloseTo(16.67, 1)
    expect(seg.label).toBe('7:30pm — Jane (4)')
    expect(seg.status).toBe('confirmed')
  })

  it('extends axisStart for an early reservation and axisEnd for a late one', () => {
    const result = buildTimeline({
      reservations: [
        { id: 'r1', reservation_time: '09:00:00', status: 'confirmed', guest_count: 2 },
        { id: 'r2', reservation_time: '22:30:00', status: 'confirmed', guest_count: 2 }
      ],
      holdMinutes: 120
    })
    expect(result.axisStart).toBe(540)
    expect(result.axisEnd).toBe(1470)
  })

  it('lays out a block with a label of its reason', () => {
    const result = buildTimeline({
      blocks: [{ id: 'b1', start_time: '12:00:00', end_time: '14:00:00', reason: 'Deep clean' }]
    })
    const seg = result.segments.find(s => s.kind === 'block')
    expect(seg.label).toBe('Deep clean')
    expect(seg.status).toBe('blocked')
  })

  it('a block with null times spans the whole axis without changing it', () => {
    const result = buildTimeline({
      blocks: [{ id: 'b1', start_time: null, end_time: null, reason: 'All day' }]
    })
    expect(result.axisStart).toBe(AXIS_START)
    expect(result.axisEnd).toBe(AXIS_END)
    const seg = result.segments[0]
    expect(seg.left).toBe(0)
    expect(seg.width).toBe(100)
  })

  it('sorts segments by start time regardless of input order', () => {
    const result = buildTimeline({
      reservations: [
        { id: 'r2', reservation_time: '20:00:00', status: 'confirmed', guest_count: 2 },
        { id: 'r1', reservation_time: '12:00:00', status: 'confirmed', guest_count: 2 }
      ],
      blocks: [{ id: 'b1', start_time: '16:00:00', end_time: '17:00:00', reason: 'x' }]
    })
    expect(result.segments.map(s => s.id)).toEqual(['r1', 'b1', 'r2'])
  })
})

describe('formatClock', () => {
  it('formats midnight', () => {
    expect(formatClock(0)).toBe('12:00am')
  })
  it('formats a half past noon', () => {
    expect(formatClock(750)).toBe('12:30pm')
  })
  it('formats a evening time', () => {
    expect(formatClock(1170)).toBe('7:30pm')
  })
})
