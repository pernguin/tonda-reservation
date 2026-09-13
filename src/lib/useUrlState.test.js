import { describe, it, expect } from 'vitest'
import { readParam, writeParam, writeParams } from './useUrlState'
const P = (s) => new URLSearchParams(s)
describe('readParam', () => {
  it('returns default when absent', () => expect(readParam(P(''), 'tab', 'upcoming')).toBe('upcoming'))
  it('returns the param when present', () => expect(readParam(P('tab=past'), 'tab', 'upcoming')).toBe('past'))
  it('treats empty as default', () => expect(readParam(P('tab='), 'tab', 'upcoming')).toBe('upcoming'))
})
describe('writeParam', () => {
  it('sets a non-default value', () => expect(writeParam(P(''), 'tab', 'past', 'upcoming').toString()).toBe('tab=past'))
  it('deletes on default', () => expect(writeParam(P('tab=past'), 'tab', 'upcoming', 'upcoming').toString()).toBe(''))
  it('deletes on empty', () => expect(writeParam(P('status=seated'), 'status', '', '').toString()).toBe(''))
  it('keeps other params', () => expect(writeParam(P('a=1'), 'b', '2', '').toString()).toBe('a=1&b=2'))
})
describe('writeParams', () => {
  it('applies several at once', () => {
    const out = writeParams(P('tab=past&date=2026-09-20&status=seated'), { date: 'all', status: '' }, { date: '', status: '' })
    expect(out.toString()).toBe('tab=past&date=all')
  })
})
