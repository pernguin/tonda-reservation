export function buildLogVisitArgs(reservation, newStatus, restaurant, amountSpent = null) {
  if (!reservation?.customer_id) return null
  return {
    p_reservation_id: reservation.id,
    p_customer_id: reservation.customer_id,
    p_restaurant: restaurant,
    p_status: newStatus,
    p_pax: reservation.guest_count ?? null,
    p_visited_at: reservation.reservation_date,
    p_amount_spent: newStatus === 'completed' ? (amountSpent ?? null) : null,
  }
}

// Returns null on success or skip, otherwise the error. Never throws.
export async function logVisit(client, reservation, newStatus, restaurant, amountSpent) {
  const args = buildLogVisitArgs(reservation, newStatus, restaurant, amountSpent)
  if (!args) return null
  try {
    const { error } = await client.rpc('log_visit', args)
    return error || null
  } catch (err) {
    return err
  }
}
