import { describe, it, expect } from 'vitest'
import {
  windowStart,
  olderWindowStart,
  effectiveWindowStart,
  chunk,
  partitionBookings,
  releasesTables,
} from './bookingsList'

describe('window helpers', () => {
  it('windowStart goes back 60 days', () => {
    expect(windowStart('2026-10-17')).toBe('2026-08-18')
  })

  it('windowStart crosses a year boundary', () => {
    expect(windowStart('2026-01-10')).toBe('2025-11-11')
  })

  it('olderWindowStart pages back 60 days', () => {
    expect(olderWindowStart('2026-08-18')).toBe('2026-06-19')
  })

  it('effectiveWindowStart uses an older filter date', () => {
    expect(effectiveWindowStart('2026-08-18', '2026-05-01')).toBe('2026-05-01')
  })

  it('effectiveWindowStart ignores a newer filter date', () => {
    expect(effectiveWindowStart('2026-08-18', '2026-09-01')).toBe('2026-08-18')
  })

  it('effectiveWindowStart ignores an empty or missing filter date', () => {
    expect(effectiveWindowStart('2026-08-18', '')).toBe('2026-08-18')
    expect(effectiveWindowStart('2026-08-18', undefined)).toBe('2026-08-18')
  })
})

describe('chunk', () => {
  const ids = n => Array.from({ length: n }, (_, i) => i)
  const lengths = n => chunk(ids(n), 100).map(c => c.length)

  it('splits into chunks of at most 100', () => {
    expect(lengths(0)).toEqual([])
    expect(lengths(1)).toEqual([1])
    expect(lengths(100)).toEqual([100])
    expect(lengths(101)).toEqual([100, 1])
    expect(lengths(250)).toEqual([100, 100, 50])
  })

  it('throws RangeError for size below 1', () => {
    expect(() => chunk([1], 0)).toThrow(RangeError)
  })
})

describe('partitionBookings', () => {
  const today = '2026-10-17'
  const items = [
    { id: 'a', d: '2026-10-17', status: 'confirmed' },
    { id: 'b', d: '2026-10-20', status: 'pending' },
    { id: 'c', d: '2026-10-20', status: 'cancelled' },
    { id: 'd', d: '2026-10-16', status: 'confirmed' },
  ]

  it('puts today and future in upcoming; cancelled and earlier in past', () => {
    const { upcoming, past } = partitionBookings(items, 'd', today)
    expect(upcoming.map(i => i.id)).toEqual(['a', 'b'])
    expect(past.map(i => i.id)).toEqual(['c', 'd'])
  })

  it('loses no item', () => {
    const { upcoming, past } = partitionBookings(items, 'd', today)
    expect(upcoming.length + past.length).toBe(items.length)
  })
})

describe('releasesTables', () => {
  it('is true for completed, cancelled and no_show only', () => {
    expect(releasesTables('completed')).toBe(true)
    expect(releasesTables('cancelled')).toBe(true)
    expect(releasesTables('no_show')).toBe(true)
    expect(releasesTables('pending')).toBe(false)
    expect(releasesTables('confirmed')).toBe(false)
    expect(releasesTables('seated')).toBe(false)
  })
})
