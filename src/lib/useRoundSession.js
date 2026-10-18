import { useEffect, useState } from 'react'
import { supabaseCustomers } from '../supabaseCustomers'

// undefined while loading, then true / false: does the Round client hold a session?
export function useRoundSession() {
  const [hasSession, setHasSession] = useState(undefined)

  useEffect(() => {
    let mounted = true
    supabaseCustomers.auth.getSession().then(({ data: { session } }) => {
      if (mounted) setHasSession(!!session)
    })

    const { data: { subscription } } = supabaseCustomers.auth.onAuthStateChange((_event, session) => {
      setHasSession(!!session)
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

  return hasSession
}
