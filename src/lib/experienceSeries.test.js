import { describe, it, expect } from 'vitest'
import { collapseSeries } from './experienceSeries'

describe('collapseSeries', () => {
  it('passes standalone rows through in order with upcomingCount 1', () => {
    const rows = [
      { id: 'a', series_id: null, date: '2026-09-13' },
      { id: 'b', series_id: null, date: '2026-09-14' },
    ]
    expect(collapseSeries(rows)).toEqual([
      { id: 'a', series_id: null, date: '2026-09-13', upcomingCount: 1 },
      { id: 'b', series_id: null, date: '2026-09-14', upcomingCount: 1 },
    ])
  })

  it('collapses three rows in the same series to the first, with upcomingCount 3', () => {
    const rows = [
      { id: 'a', series_id: 's1', date: '2026-09-13' },
      { id: 'b', series_id: 's1', date: '2026-09-20' },
      { id: 'c', series_id: 's1', date: '2026-09-27' },
    ]
    expect(collapseSeries(rows)).toEqual([
      { id: 'a', series_id: 's1', date: '2026-09-13', upcomingCount: 3 },
    ])
  })

  it('handles a mix of series and standalone rows, preserving first-seen order', () => {
    const rows = [
      { id: 'A', series_id: 's1', date: '2026-09-13' },
      { id: 'B', series_id: null, date: '2026-09-14' },
      { id: 'C', series_id: 's1', date: '2026-09-20' },
      { id: 'D', series_id: 's2', date: '2026-09-15' },
    ]
    expect(collapseSeries(rows)).toEqual([
      { id: 'A', series_id: 's1', date: '2026-09-13', upcomingCount: 2 },
      { id: 'B', series_id: null, date: '2026-09-14', upcomingCount: 1 },
      { id: 'D', series_id: 's2', date: '2026-09-15', upcomingCount: 1 },
    ])
  })

  it('does not mutate the input array or its row objects', () => {
    const rowA = { id: 'a', series_id: 's1', date: '2026-09-13' }
    const rowB = { id: 'b', series_id: 's1', date: '2026-09-20' }
    const rows = [rowA, rowB]
    collapseSeries(rows)
    expect(rows).toEqual([rowA, rowB])
    expect(rowA).toEqual({ id: 'a', series_id: 's1', date: '2026-09-13' })
    expect(rowA.upcomingCount).toBeUndefined()
  })
})
