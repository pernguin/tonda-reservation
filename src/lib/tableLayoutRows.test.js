import { describe, it, expect } from 'vitest'
import { toLayoutRows, firstDuplicateName } from './tableLayoutRows'

describe('toLayoutRows', () => {
  it('keeps only the editable layout columns and defaults rotated to false', () => {
    const rows = toLayoutRows([
      { id: 'a', table_number: 'T1', capacity: 4, x_position: 10, y_position: 20, is_bookable: true, rotated: undefined, locked_until: 'x', group_id: 'g' },
    ])
    expect(rows).toEqual([
      { id: 'a', table_number: 'T1', capacity: 4, x_position: 10, y_position: 20, is_bookable: true, rotated: false },
    ])
  })

  it('keeps rotated: true', () => {
    const [row] = toLayoutRows([
      { id: 'a', table_number: 'T1', capacity: 2, x_position: 0, y_position: 0, is_bookable: false, rotated: true },
    ])
    expect(row.rotated).toBe(true)
  })

  it('returns [] for no tables', () => {
    expect(toLayoutRows([])).toEqual([])
  })

  it('keeps a null capacity as null', () => {
    const [row] = toLayoutRows([
      { id: 'a', table_number: 'T1', capacity: null, x_position: 0, y_position: 0, is_bookable: true, rotated: false },
    ])
    expect(row.capacity).toBeNull()
  })
})

describe('firstDuplicateName', () => {
  it('returns null when every name is unique', () => {
    expect(firstDuplicateName([{ table_number: 'T1' }, { table_number: 'T2' }])).toBeNull()
  })

  it('returns the first repeated name', () => {
    expect(firstDuplicateName([{ table_number: 'T1' }, { table_number: 'O1' }, { table_number: 'T1' }])).toBe('T1')
  })
})
