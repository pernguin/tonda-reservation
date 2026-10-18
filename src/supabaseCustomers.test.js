import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

let mod

beforeAll(async () => {
  vi.stubEnv('VITE_ROUND_SUPABASE_URL', 'http://localhost:54321')
  vi.stubEnv('VITE_ROUND_SUPABASE_ANON_KEY', 'test-key')
  mod = await import('./supabaseCustomers')
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('findOrCreateCustomer', () => {
  it('passes the normalised phone and null for empty email/birthdate', async () => {
    const rpc = vi.spyOn(mod.supabaseCustomers, 'rpc').mockResolvedValue({ data: 'id-1', error: null })
    await mod.findOrCreateCustomer({ full_name: 'Sam Lee', phone: '012-345 6789', email: '', birthdate: '' })
    expect(rpc).toHaveBeenCalledWith('find_or_create_customer', {
      p_full_name: 'Sam Lee',
      p_phone: '60123456789',
      p_email: null,
      p_birthdate: null
    })
  })

  it('passes email and birthdate through when given', async () => {
    const rpc = vi.spyOn(mod.supabaseCustomers, 'rpc').mockResolvedValue({ data: 'id-1', error: null })
    await mod.findOrCreateCustomer({
      full_name: 'Sam Lee',
      phone: '0123456789',
      email: 'sam@example.com',
      birthdate: '1990-05-01'
    })
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_email: 'sam@example.com', p_birthdate: '1990-05-01' })
  })

  it('returns the uuid the RPC returned', async () => {
    vi.spyOn(mod.supabaseCustomers, 'rpc').mockResolvedValue({ data: 'abc-uuid', error: null })
    const id = await mod.findOrCreateCustomer({ full_name: 'Sam', phone: '0123456789' })
    expect(id).toBe('abc-uuid')
  })

  it('throws the RPC error object', async () => {
    const err = { code: '22023', message: 'invalid_phone' }
    vi.spyOn(mod.supabaseCustomers, 'rpc').mockResolvedValue({ data: null, error: err })
    await expect(mod.findOrCreateCustomer({ full_name: 'Sam', phone: '0123456789' })).rejects.toBe(err)
  })

  it('rejects an invalid phone without calling the RPC', async () => {
    const rpc = vi.spyOn(mod.supabaseCustomers, 'rpc').mockResolvedValue({ data: 'x', error: null })
    await expect(mod.findOrCreateCustomer({ full_name: 'Sam', phone: '123' })).rejects.toThrow(
      'Please enter a valid phone number.'
    )
    expect(rpc).not.toHaveBeenCalled()
  })
})
