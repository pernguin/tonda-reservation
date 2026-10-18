import { createClient } from '@supabase/supabase-js'

export const supabaseCustomers = createClient(
  import.meta.env.VITE_ROUND_SUPABASE_URL,
  import.meta.env.VITE_ROUND_SUPABASE_ANON_KEY,
  {
    auth: {
      storageKey: 'supabase-customers-auth'
    }
  }
)

export function normalisePhone(raw) {
  if (!raw) return ''
  let p = raw.replace(/[\s\-()]/g, '')
  if (p.startsWith('+')) p = p.slice(1)
  if (p.startsWith('0')) p = '60' + p.slice(1)
  return p
}

// Mirrors the customers.phone CHECK constraint (customers_phone_format_check,
// on the shared Round Supabase project) — client and DB must reject the same
// set of values, or a client-accepted number can still fail at insert with a
// raw 23514 constraint-violation error instead of a friendly message.
const PHONE_PATTERN = /^\+?[0-9]{8,15}$/

export function isValidPhone(normalisedPhone) {
  return PHONE_PATTERN.test(normalisedPhone)
}

export async function findOrCreateCustomer({ full_name, phone, email, birthdate }) {
  const normalisedPhone = normalisePhone(phone)
  if (!isValidPhone(normalisedPhone)) {
    throw new Error('Please enter a valid phone number.')
  }
  const { data, error } = await supabaseCustomers.rpc('find_or_create_customer', {
    p_full_name: full_name,
    p_phone: normalisedPhone,
    p_email: email || null,
    p_birthdate: birthdate || null
  })
  if (error) throw error
  return data
}
