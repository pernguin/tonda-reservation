import { describe, it, expect } from 'vitest'
import { escapeHtml } from '../../supabase/functions/_shared/escapeHtml.ts'

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
