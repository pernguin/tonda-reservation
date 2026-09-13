import { useEffect, useRef } from 'react'
import { supabase } from '../supabase'
import { supabaseCustomers } from '../supabaseCustomers'

// Subscribes to new reservations while an auth session exists.
// Realtime payloads carry no joins, so the customer name is fetched separately.
export function useReservationInserts(onInsert) {
  const onInsertRef = useRef(onInsert)
  useEffect(() => { onInsertRef.current = onInsert }, [onInsert])

  useEffect(() => {
    let channel = null
    let active = true

    function subscribe() {
      if (channel) return
      channel = supabase
        .channel('admin-reservation-inserts')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'reservations' }, async payload => {
          const row = payload.new
          let customer = null
          if (row.customer_id) {
            const { data } = await supabaseCustomers.from('customers').select('full_name').eq('id', row.customer_id).maybeSingle()
            customer = data ?? null
          }
          if (active) onInsertRef.current?.({ ...row, customer })
        })
        .subscribe()
    }

    function unsubscribe() {
      if (!channel) return
      supabase.removeChannel(channel)
      channel = null
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (active && session) subscribe()
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) subscribe(); else unsubscribe()
    })

    return () => {
      active = false
      subscription.unsubscribe()
      unsubscribe()
    }
  }, [])
}
