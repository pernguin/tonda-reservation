import { describe, expect, it } from 'vitest'
import { firstRow, prefillName } from './prefill'

describe('firstRow', () => {
  it('returns null for an empty array', () => {
    expect(firstRow([])).toBeNull()
  })
  it('returns the first element of an array', () => {
    expect(firstRow([{ a: 1 }, { a: 2 }])).toEqual({ a: 1 })
  })
  it('returns null for null and undefined', () => {
    expect(firstRow(null)).toBeNull()
    expect(firstRow(undefined)).toBeNull()
  })
  it('returns a bare object as is', () => {
    expect(firstRow({ a: 1 })).toEqual({ a: 1 })
  })
})

describe('prefillName', () => {
  it('keeps a name the guest already typed', () => {
    expect(prefillName('Sam Lee', { first_name: 'Alex' })).toBe('Sam Lee')
  })
  it('fills an empty name with the first name', () => {
    expect(prefillName('', { first_name: 'Alex' })).toBe('Alex')
  })
  it('returns an empty string for a null row', () => {
    expect(prefillName('', null)).toBe('')
  })
  it('returns an empty string when first_name is null', () => {
    expect(prefillName('', { first_name: null })).toBe('')
  })
})
