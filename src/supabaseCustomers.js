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

// Excluded from customers_phone_unique, so it must never be treated as a dedup key.
const PLACEHOLDER_PHONE = '601112288686'

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

async function findCustomerByPhone(phone) {
  if (!phone || phone === PLACEHOLDER_PHONE) return null
  const { data, error } = await supabaseCustomers
    .from('customers')
    .select('id, full_name, phone, email, birthdate')
    .eq('phone', phone)
    .maybeSingle()
  if (error) throw error
  return data
}

async function findCustomerByEmail(email) {
  if (!email) return null
  const { data, error } = await supabaseCustomers
    .from('customers')
    .select('id, full_name, phone, email, birthdate')
    .eq('email', email)
    .maybeSingle()
  if (error) throw error
  return data
}

function missingFieldsPatch(existing, incoming) {
  const patch = {}
  if (incoming.full_name && !existing.full_name) patch.full_name = incoming.full_name
  if (incoming.phone && !existing.phone) patch.phone = incoming.phone
  if (incoming.email && !existing.email) patch.email = incoming.email
  if (incoming.birthdate && !existing.birthdate) patch.birthdate = incoming.birthdate
  return patch
}

async function patchCustomer(id, patch) {
  if (Object.keys(patch).length === 0) return
  const { error } = await supabaseCustomers.from('customers').update(patch).eq('id', id)
  if (error) console.error('findOrCreateCustomer: failed to patch customer', id, error)
}

export async function findOrCreateCustomer({ full_name, phone, email, birthdate }) {
  const normalisedPhone = normalisePhone(phone)
  if (!isValidPhone(normalisedPhone)) {
    throw new Error('Please enter a valid phone number.')
  }
  const incoming = { full_name, phone: normalisedPhone, email: email || null, birthdate: birthdate || null }

  let existing = await findCustomerByPhone(normalisedPhone)
  if (!existing && incoming.email) {
    existing = await findCustomerByEmail(incoming.email)
  }

  if (existing) {
    await patchCustomer(existing.id, missingFieldsPatch(existing, incoming))
    return existing.id
  }

  try {
    const { data, error } = await supabaseCustomers
      .from('customers')
      .insert([incoming])
      .select()
      .single()
    if (error) throw error
    return data.id
  } catch (err) {
    // 23505 here means another submission won the race between our lookup and
    // our insert (phone or email collided with a row we hadn't seen yet).
    if (err?.code === '23505') {
      let winner = await findCustomerByPhone(normalisedPhone)
      if (!winner && incoming.email) winner = await findCustomerByEmail(incoming.email)
      if (winner) {
        await patchCustomer(winner.id, missingFieldsPatch(winner, incoming))
        return winner.id
      }
    }
    throw err
  }
}
