import { describe, it, expect } from 'vitest'
import { isBirthdayOn, visitStage, getGuestPills, GUEST_TAGS } from './guestPills'
import { BRAND } from './adminTheme'

describe('isBirthdayOn', () => {
  it('same month and day matches', () => {
    expect(isBirthdayOn('1990-10-03', '2026-10-03')).toBe(true)
  })

  it('day before does not match', () => {
    expect(isBirthdayOn('1990-10-03', '2026-10-02')).toBe(false)
  })

  it('day after does not match', () => {
    expect(isBirthdayOn('1990-10-03', '2026-10-04')).toBe(false)
  })

  it('29 Feb matches 28 Feb in a non-leap year', () => {
    expect(isBirthdayOn('2000-02-29', '2027-02-28')).toBe(true)
  })

  it('29 Feb does not match 28 Feb in a leap year', () => {
    expect(isBirthdayOn('2000-02-29', '2028-02-28')).toBe(false)
  })

  it('29 Feb matches 29 Feb in a leap year', () => {
    expect(isBirthdayOn('2000-02-29', '2028-02-29')).toBe(true)
  })

  it('null birthdate is false', () => {
    expect(isBirthdayOn(null, '2026-10-03')).toBe(false)
  })

  it('blank birthdate is false', () => {
    expect(isBirthdayOn('', '2026-10-03')).toBe(false)
  })

  it('null date is false', () => {
    expect(isBirthdayOn('1990-10-03', null)).toBe(false)
  })
})

describe('GUEST_TAGS', () => {
  it('has the six tags in chip order', () => {
    expect(GUEST_TAGS.map((t) => t.key)).toEqual([
      'vip',
      'difficult',
      'allergy',
      'big_spender',
      'friends_family',
      'press'
    ])
  })
})

describe('visitStage', () => {
  it('0 visits is 1st visit', () => {
    expect(visitStage(0)).toBe('1st visit')
  })

  it('1 visit is 2nd visit', () => {
    expect(visitStage(1)).toBe('2nd visit')
  })

  it('2 visits is 3rd visit', () => {
    expect(visitStage(2)).toBe('3rd visit')
  })

  it('3 visits is Regular', () => {
    expect(visitStage(3)).toBe('Regular')
  })

  it('39 visits is Regular', () => {
    expect(visitStage(39)).toBe('Regular')
  })

  it('null count is 1st visit', () => {
    expect(visitStage(null)).toBe('1st visit')
  })

  it('undefined count is 1st visit', () => {
    expect(visitStage(undefined)).toBe('1st visit')
  })
})

describe('getGuestPills', () => {
  const today = '2026-09-24'

  it('returns [] when customer is null', () => {
    expect(getGuestPills(null, { status: 'confirmed', date: today }, today)).toEqual([])
  })

  it('omits visit pill for a completed booking', () => {
    const pills = getGuestPills(
      { visit_count: 0 },
      { status: 'completed', date: today },
      today
    )
    expect(pills.find((p) => p.key === 'visit')).toBeUndefined()
  })

  it('omits visit pill for a no_show booking', () => {
    const pills = getGuestPills(
      { visit_count: 0 },
      { status: 'no_show', date: today },
      today
    )
    expect(pills.find((p) => p.key === 'visit')).toBeUndefined()
  })

  it('omits visit pill for a cancelled booking', () => {
    const pills = getGuestPills(
      { visit_count: 0 },
      { status: 'cancelled', date: today },
      today
    )
    expect(pills.find((p) => p.key === 'visit')).toBeUndefined()
  })

  it('omits visit pill for a past-dated confirmed booking', () => {
    const pills = getGuestPills(
      { visit_count: 0 },
      { status: 'confirmed', date: '2026-09-23' },
      today
    )
    expect(pills.find((p) => p.key === 'visit')).toBeUndefined()
  })

  it('includes visit pill for a pending booking today', () => {
    const pills = getGuestPills(
      { visit_count: 0 },
      { status: 'pending', date: today },
      today
    )
    expect(pills.find((p) => p.key === 'visit')).toEqual({
      key: 'visit',
      label: '1st visit',
      className: 'border border-gray-300 text-gray-600'
    })
  })

  it('includes visit pill for a confirmed booking today', () => {
    const pills = getGuestPills(
      { visit_count: 0 },
      { status: 'confirmed', date: today },
      today
    )
    expect(pills.find((p) => p.key === 'visit')).toBeTruthy()
  })

  it('includes visit pill for a seated booking today', () => {
    const pills = getGuestPills(
      { visit_count: 0 },
      { status: 'seated', date: today },
      today
    )
    expect(pills.find((p) => p.key === 'visit')).toBeTruthy()
  })

  it('includes visit pill for a future-dated confirmed booking', () => {
    const pills = getGuestPills(
      { visit_count: 0 },
      { status: 'confirmed', date: '2026-09-25' },
      today
    )
    expect(pills.find((p) => p.key === 'visit')).toBeTruthy()
  })

  it('Regular visit pill uses BRAND border style', () => {
    const pills = getGuestPills(
      { visit_count: 3 },
      { status: 'confirmed', date: today },
      today
    )
    expect(pills.find((p) => p.key === 'visit')).toEqual({
      key: 'visit',
      label: 'Regular',
      style: { border: `1px solid ${BRAND}`, color: BRAND }
    })
  })

  it('no_show_count 0 omits the no_show pill', () => {
    const pills = getGuestPills(
      { visit_count: 0, no_show_count: 0 },
      { status: 'confirmed', date: today },
      today
    )
    expect(pills.find((p) => p.key === 'no_show')).toBeUndefined()
  })

  it('no_show_count 1 shows No-show x1', () => {
    const pills = getGuestPills(
      { visit_count: 0, no_show_count: 1 },
      { status: 'confirmed', date: today },
      today
    )
    expect(pills.find((p) => p.key === 'no_show')).toEqual({
      key: 'no_show',
      label: 'No-show ×1',
      className: 'bg-orange-100 text-orange-800'
    })
  })

  it('blank notes produce no note pill', () => {
    const pills = getGuestPills(
      { visit_count: 0, notes: '  ' },
      { status: 'confirmed', date: today },
      today
    )
    expect(pills.find((p) => p.key === 'note')).toBeUndefined()
  })

  it('null/missing tags treated as []', () => {
    const pills = getGuestPills(
      { visit_count: 0, tags: null },
      { status: 'confirmed', date: today },
      today
    )
    expect(pills.filter((p) => ['allergy', 'difficult', 'vip', 'big_spender', 'friends_family', 'press'].includes(p.key))).toEqual([])
  })

  it('shows birthday pill when booking is on the exact birthday', () => {
    const pills = getGuestPills(
      { birthdate: '1990-10-03' },
      { status: 'confirmed', date: '2026-10-03' },
      today
    )
    expect(pills.find((p) => p.key === 'birthday')).toMatchObject({
      key: 'birthday',
      label: '🎂 Birthday'
    })
  })

  it('omits birthday pill when booking is not on the exact birthday', () => {
    const pills = getGuestPills(
      { birthdate: '1990-10-03' },
      { status: 'confirmed', date: '2026-10-04' },
      today
    )
    expect(pills.find((p) => p.key === 'birthday')).toBeUndefined()
  })

  it('shows birthday pill for a completed booking on the exact birthday', () => {
    const pills = getGuestPills(
      { birthdate: '1990-10-03' },
      { status: 'completed', date: '2026-10-03' },
      today
    )
    expect(pills.find((p) => p.key === 'birthday')).toMatchObject({
      key: 'birthday',
      label: '🎂 Birthday'
    })
  })

  it('produces every pill in order when everything is set', () => {
    const customer = {
      tags: ['vip', 'difficult', 'allergy', 'big_spender', 'friends_family', 'press'],
      no_show_count: 2,
      birthdate: '1990-09-24',
      visit_count: 0,
      notes: 'Loves the window table'
    }
    const booking = { status: 'confirmed', date: today }
    const pills = getGuestPills(customer, booking, today)
    expect(pills.map((p) => p.key)).toEqual([
      'allergy',
      'difficult',
      'no_show',
      'vip',
      'big_spender',
      'friends_family',
      'press',
      'birthday',
      'visit',
      'note'
    ])
  })
})
