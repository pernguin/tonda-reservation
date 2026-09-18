import { describe, it, expect } from 'vitest'
import { nextSpend, isLatestVisit } from './customerVisits'

describe('nextSpend', () => {
  it('treats null total_spent as 0', () => {
    expect(nextSpend({ total_spent: null }, 10, true)).toEqual({ total_spent: 10, last_visit_spent: 10 })
  })

  it('coerces numeric string total_spent from PostgREST', () => {
    expect(nextSpend({ total_spent: '12.50' }, 5, true)).toEqual({ total_spent: 17.5, last_visit_spent: 5 })
  })

  it('omits last_visit_spent when shouldUpdateLastVisited is false', () => {
    expect(nextSpend({ total_spent: 20 }, 5, false)).toEqual({ total_spent: 25 })
  })

  it('adds 0 and sets last_visit_spent to 0 when amount is 0', () => {
    expect(nextSpend({ total_spent: 10 }, 0, true)).toEqual({ total_spent: 10, last_visit_spent: 0 })
  })
})

describe('isLatestVisit', () => {
  it('is true when the customer has no previous visit', () => {
    expect(isLatestVisit('2026-09-18', null)).toBe(true)
  })

  it('is true for a later date', () => {
    expect(isLatestVisit('2026-09-18', '2026-09-01')).toBe(true)
  })

  it('is true for the same day (visited_at has no time)', () => {
    expect(isLatestVisit('2026-09-18', '2026-09-18')).toBe(true)
  })

  it('is false for an earlier date', () => {
    expect(isLatestVisit('2026-09-01', '2026-09-18')).toBe(false)
  })
})
