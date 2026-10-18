import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { Navigate } from 'react-router-dom'
import { supabaseCustomers } from '../supabaseCustomers'
import { installRoundSignOutSync } from '../lib/adminSession'

// Module-level: Home's Log out runs where RequireAuth is not mounted, so the sync must not depend on mounting.
installRoundSignOutSync(supabase.auth, supabaseCustomers.auth)

export default function RequireAuth({ children }) {
  const [session, setSession] = useState(undefined)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })

    return () => subscription.unsubscribe()
  }, [])

  if (session === undefined) return null // still loading

  if (!session) return <Navigate to="/admin/login" replace />

  return children
}