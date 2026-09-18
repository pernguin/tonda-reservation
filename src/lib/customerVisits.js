import { supabaseCustomers } from '../supabaseCustomers'

export function nextSpend(customer, amountSpent, shouldUpdateLastVisited) {
  return {
    total_spent: (Number(customer.total_spent) || 0) + amountSpent,
    ...(shouldUpdateLastVisited ? { last_visit_spent: amountSpent } : {})
  }
}

// visited_at is a date with no time, so a same-day visit counts as the latest.
export function isLatestVisit(visitedAt, lastVisitedAt) {
  return !lastVisitedAt || new Date(visitedAt) >= new Date(lastVisitedAt)
}

export async function logVisitFromReservation(reservation, newStatus, restaurant, amountSpent = null) {
  if (newStatus !== 'completed' && newStatus !== 'no_show') return
  if (!reservation?.customer_id) return

  // Reservations in this app store the date as `reservation_date`; fall back to it
  // when a generic `date` field isn't present.
  const visitedAt = reservation.date ?? reservation.reservation_date

  try {
    const { data: existing } = await supabaseCustomers
      .from('customer_visits')
      .select('status')
      .eq('reservation_id', reservation.id)
      .maybeSingle()

    if (existing && existing.status === newStatus) return

    const { error: upsertError } = await supabaseCustomers
      .from('customer_visits')
      .upsert({
        customer_id: reservation.customer_id,
        restaurant,
        visited_at: visitedAt,
        reservation_id: reservation.id,
        status: newStatus,
        pax: reservation.pax ?? reservation.guest_count ?? reservation.guests ?? null,
        amount_spent: newStatus === 'completed' ? amountSpent : null
      }, { onConflict: 'reservation_id' })

    if (upsertError) throw upsertError

    const { data: customer, error: fetchError } = await supabaseCustomers
      .from('customers')
      .select('visit_count, no_show_count, last_visited_at, total_spent, last_visit_spent')
      .eq('id', reservation.customer_id)
      .single()

    if (fetchError || !customer) throw fetchError || new Error('customer not found')

    if (newStatus === 'completed') {
      const shouldUpdateLastVisited = isLatestVisit(visitedAt, customer.last_visited_at)

      await supabaseCustomers
        .from('customers')
        .update({
          visit_count: (customer.visit_count || 0) + 1,
          ...(shouldUpdateLastVisited ? { last_visited_at: visitedAt } : {}),
          ...(amountSpent != null ? nextSpend(customer, amountSpent, shouldUpdateLastVisited) : {})
        })
        .eq('id', reservation.customer_id)
    } else if (newStatus === 'no_show') {
      await supabaseCustomers
        .from('customers')
        .update({ no_show_count: (customer.no_show_count || 0) + 1 })
        .eq('id', reservation.customer_id)
    }
  } catch (err) {
    console.error('logVisitFromReservation failed:', err)
  }
}
