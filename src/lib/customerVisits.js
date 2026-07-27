import { supabaseCustomers } from '../supabaseCustomers'

export async function logVisitFromReservation(reservation, newStatus, restaurant) {
  if (newStatus !== 'completed' && newStatus !== 'no_show') return
  if (!reservation?.customer_id) return

  try {
    const visitedAt = reservation.date ?? reservation.reservation_date
    const pax = reservation.pax ?? reservation.guest_count ?? reservation.guests ?? null

    const { error: upsertError } = await supabaseCustomers
      .from('customer_visits')
      .upsert({
        customer_id: reservation.customer_id,
        restaurant,
        visited_at: visitedAt,
        reservation_id: reservation.id,
        status: newStatus,
        pax
      }, { onConflict: 'reservation_id' })

    if (upsertError) {
      console.error('logVisitFromReservation: upsert failed', upsertError)
      return
    }

    const { data: customer, error: fetchError } = await supabaseCustomers
      .from('customers')
      .select('visit_count, no_show_count, last_visited_at')
      .eq('id', reservation.customer_id)
      .single()

    if (fetchError || !customer) {
      console.error('logVisitFromReservation: customer fetch failed', fetchError)
      return
    }

    if (newStatus === 'completed') {
      const shouldUpdateLastVisited =
        !customer.last_visited_at || (visitedAt && visitedAt > customer.last_visited_at)

      const updatePayload = {
        visit_count: (customer.visit_count ?? 0) + 1,
        ...(shouldUpdateLastVisited ? { last_visited_at: visitedAt } : {})
      }

      const { error: updateError } = await supabaseCustomers
        .from('customers')
        .update(updatePayload)
        .eq('id', reservation.customer_id)

      if (updateError) console.error('logVisitFromReservation: visit_count update failed', updateError)
    } else if (newStatus === 'no_show') {
      const updatePayload = {
        no_show_count: (customer.no_show_count ?? 0) + 1
      }

      const { error: updateError } = await supabaseCustomers
        .from('customers')
        .update(updatePayload)
        .eq('id', reservation.customer_id)

      if (updateError) console.error('logVisitFromReservation: no_show_count update failed', updateError)
    }
  } catch (err) {
    console.error('logVisitFromReservation: unexpected error', err)
  }
}
