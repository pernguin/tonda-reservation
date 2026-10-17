import { describe, it, expect } from 'vitest'
import { escapeHtml } from '../../supabase/functions/_shared/escapeHtml.ts'
import { klDateString, reminderDayWord } from '../../supabase/functions/_shared/klTime.ts'

describe('escapeHtml', () => {
  it('escapes script tags fully', () => {
    expect(escapeHtml("<script>alert('x')</script>")).toBe(
      '&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;',
    )
  })
  it('escapes ampersands and double quotes', () => {
    expect(escapeHtml('Tom & "Jerry"')).toBe('Tom &amp; &quot;Jerry&quot;')
  })
  it('maps null and undefined to empty string', () => {
    expect(escapeHtml(null)).toBe('')
    expect(escapeHtml(undefined)).toBe('')
  })
  it('stringifies numbers', () => {
    expect(escapeHtml(4)).toBe('4')
  })
  it('double-escapes already-escaped input', () => {
    expect(escapeHtml('&amp;')).toBe('&amp;amp;')
  })
})

describe('klDateString', () => {
  it('rolls to the next day after 16:00 UTC', () => {
    expect(klDateString(new Date('2026-10-17T17:30:00Z'))).toBe('2026-10-18')
  })
  it('stays on the same day before 16:00 UTC', () => {
    expect(klDateString(new Date('2026-10-17T15:59:00Z'))).toBe('2026-10-17')
  })
})

describe('reminderDayWord', () => {
  it('says today when the date is the KL date', () => {
    expect(reminderDayWord('2026-10-18', new Date('2026-10-18T01:00:00Z'))).toBe('today')
  })
  it('says tomorrow when the date is the next KL date', () => {
    expect(reminderDayWord('2026-10-18', new Date('2026-10-17T05:00:00Z'))).toBe('tomorrow')
  })
  it('falls back to the date otherwise', () => {
    expect(reminderDayWord('2026-10-25', new Date('2026-10-17T05:00:00Z'))).toBe('on 2026-10-25')
  })
  it('uses KL date when UTC date differs', () => {
    expect(reminderDayWord('2026-10-18', new Date('2026-10-17T17:00:00Z'))).toBe('today')
  })
})
