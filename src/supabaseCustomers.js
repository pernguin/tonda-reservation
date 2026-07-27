import { createClient } from '@supabase/supabase-js'

export const supabaseCustomers = createClient(
  'https://gvncofccucoejwawjvdv.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd2bmNvZmNjdWNvZWp3YXdqdmR2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg4MjIxNjgsImV4cCI6MjA5NDM5ODE2OH0.yFPlxyBSq3_sDDWOiSN3YGatJGJzycJ3VBlTa2mtjrU',
  { auth: { storageKey: 'supabase-customers-auth' } }
)
