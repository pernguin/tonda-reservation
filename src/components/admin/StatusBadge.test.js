import { describe, it, expect } from 'vitest'
import { STATUS_COLORS, colorFor } from './StatusBadge'

describe('STATUS_COLORS', () => {
  it('has keys for every booking and experience status', () => {
    expect(Object.keys(STATUS_COLORS).sort()).toEqual(
      ['cancelled', 'completed', 'confirmed', 'draft', 'no_show', 'pending', 'published', 'seated'].sort()
    )
  })
})

describe('colorFor', () => {
  it('returns the gray fallback for an unknown status', () => {
    expect(colorFor('bogus')).toBe('bg-gray-100 text-gray-600')
  })
  it('returns the mapped color for a known status', () => {
    expect(colorFor('pending')).toBe(STATUS_COLORS.pending)
  })
})
