import { describe, it, expect } from 'vitest'
import { DAYS_BY_TYPE, HIDDEN_DAY_TYPES } from './slotRuleDays'

describe('slotRuleDays', () => {
  it('DAYS_BY_TYPE.weekday is exactly Sun-Thu in order', () => {
    expect(DAYS_BY_TYPE.weekday).toEqual(['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday'])
  })

  it('DAYS_BY_TYPE.weekend is Friday, Saturday', () => {
    expect(DAYS_BY_TYPE.weekend).toEqual(['Friday', 'Saturday'])
  })

  it('DAYS_BY_TYPE.public_holiday is undefined', () => {
    expect(DAYS_BY_TYPE.public_holiday).toBeUndefined()
  })

  it('every HIDDEN_DAY_TYPES entry has no DAYS_BY_TYPE entry', () => {
    HIDDEN_DAY_TYPES.forEach(dayType => {
      expect(DAYS_BY_TYPE[dayType]).toBeUndefined()
    })
  })
})
