import { describe, it, expect } from 'vitest'
import { DAYS_BY_TYPE, HIDDEN_DAY_TYPES } from './slotRuleDays'

describe('slotRuleDays', () => {
  it('DAYS_BY_TYPE.weekday is exactly Mon-Fri in order', () => {
    expect(DAYS_BY_TYPE.weekday).toEqual(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'])
  })

  it('DAYS_BY_TYPE.weekend is Saturday, Sunday', () => {
    expect(DAYS_BY_TYPE.weekend).toEqual(['Saturday', 'Sunday'])
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
