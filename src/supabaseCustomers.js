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
