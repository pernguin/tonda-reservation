import { describe, it, expect } from 'vitest'
import { slotKey, findSlotRow, pickAvailableGroups, MAX_ONLINE_PARTY } from './availabilitySlots'

const rows = [
  { slot: '18:00:00', day_type: 'weekday', requires_approval: false },
  { slot: '19:00:00', day_type: 'weekday', requires_approval: false }
]

const groups = [
  { sessionLabel: 'Lunch', slots: [{ value: '12:00', label: '12:00 PM' }] },
  { sessionLabel: 'Dinner', slots: [
    { value: '18:00', label: '6:00 PM' },
    { value: '18:30', label: '6:30 PM' },
    { value: '19:00', label: '7:00 PM' }
  ] }
]

describe('slotKey', () => {
  it('trims seconds', () => {
    expect(slotKey('18:00:00')).toBe('18:00')
  })

  it('leaves HH:MM alone', () => {
    expect(slotKey('18:00')).toBe('18:00')
  })
})

describe('findSlotRow', () => {
  it('matches HH:MM against HH:MM:SS', () => {
    expect(findSlotRow(rows, '18:00')).toBe(rows[0])
  })

  it('returns undefined on a miss', () => {
    expect(findSlotRow(rows, '20:00')).toBeUndefined()
  })

  it('returns undefined for empty rows', () => {
    expect(findSlotRow([], '18:00')).toBeUndefined()
  })
})

describe('pickAvailableGroups', () => {
  it('keeps only returned slots and drops an emptied group', () => {
    const result = pickAvailableGroups(groups, rows, '2026-10-20')
    expect(result).toEqual([
      { sessionLabel: 'Dinner', slots: [
        { value: '18:00', label: '6:00 PM' },
        { value: '19:00', label: '7:00 PM' }
      ] }
    ])
  })

  it('honours an injected isBookable', () => {
    const result = pickAvailableGroups(groups, rows, '2026-10-20', time => time !== '18:00')
    expect(result).toEqual([
      { sessionLabel: 'Dinner', slots: [{ value: '19:00', label: '7:00 PM' }] }
    ])
  })

  it('returns [] for empty rows', () => {
    expect(pickAvailableGroups(groups, [], '2026-10-20')).toEqual([])
  })

  it('does not mutate the input', () => {
    pickAvailableGroups(groups, rows, '2026-10-20')
    expect(groups[1].slots).toHaveLength(3)
  })
})

describe('MAX_ONLINE_PARTY', () => {
  it('mirrors the server cap', () => {
    expect(MAX_ONLINE_PARTY).toBe(10)
  })
})
