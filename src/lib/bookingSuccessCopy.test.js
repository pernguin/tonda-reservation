import { describe, it, expect } from 'vitest'
import {
  bookingSuccessCopy,
  PENDING_HEADING,
  PENDING_MESSAGE,
  CONFIRMED_HEADING,
  CONFIRMED_FALLBACK
} from './bookingSuccessCopy'

describe('bookingSuccessCopy', () => {
  it('pending ignores the settings text', () => {
    expect(bookingSuccessCopy('pending', 'Custom text')).toEqual({
      heading: PENDING_HEADING,
      message: PENDING_MESSAGE
    })
  })

  it('confirmed uses the settings text', () => {
    expect(bookingSuccessCopy('confirmed', 'Custom text')).toEqual({
      heading: CONFIRMED_HEADING,
      message: 'Custom text'
    })
  })

  it('confirmed with null, empty or whitespace settings uses the fallback', () => {
    for (const s of [null, '', '   \n']) {
      expect(bookingSuccessCopy('confirmed', s)).toEqual({
        heading: CONFIRMED_HEADING,
        message: CONFIRMED_FALLBACK
      })
    }
  })
})
