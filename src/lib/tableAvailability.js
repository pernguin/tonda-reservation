import { supabase } from '../supabase'

const ACTIVE_RESERVATION_STATUSES = ['confirmed', 'pending', 'seated']

export function getLocalToday() {
  const d = new Date()
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function isToday(dateString) {
  return dateString === getLocalToday()
}

function statusRecord(tableId, status, block) {
  return {
    table_id: tableId,
    status,
    reason: block?.reason ?? null,
    source_type: block?.source_type ?? null,
    source_id: block?.source_id ?? null,
    block_id: block?.id ?? null
  }
}

// Computes each table's Free/Reserved/Blocked/Seated/Locked status for a given
// date. Shared by the admin floor plan (date picker) and the Experiences page
// (table assignment) so the two views can never drift apart.
export async function getTableStatusForDate(dateString) {
  const today = isToday(dateString)

  const [{ data: tables }, { data: reservations }, { data: blocks }] = await Promise.all([
    supabase.from('restaurant_tables').select('id, is_bookable, locked_until'),
    supabase
      .from('reservations')
      .select('id, table_ids, status')
      .eq('reservation_date', dateString)
      .in('status', ACTIVE_RESERVATION_STATUSES),
    supabase
      .from('table_blocks')
      .select('id, table_id, reason, source_type, source_id')
      .eq('block_date', dateString)
  ])

  const reservationsByTable = new Map()
  for (const r of reservations || []) {
    if (!Array.isArray(r.table_ids)) continue
    for (const tableId of r.table_ids) {
      const list = reservationsByTable.get(tableId) || []
      list.push(r)
      reservationsByTable.set(tableId, list)
    }
  }

  const blockByTable = new Map()
  for (const b of blocks || []) {
    if (!blockByTable.has(b.table_id)) blockByTable.set(b.table_id, b)
  }

  const now = new Date()

  return (tables || []).map(table => {
    if (!table.is_bookable) return statusRecord(table.id, 'blocked', null)

    const block = blockByTable.get(table.id)
    if (block) return statusRecord(table.id, 'blocked', block)

    const assigned = reservationsByTable.get(table.id) || []

    if (today) {
      if (table.locked_until && new Date(table.locked_until) > now) {
        return statusRecord(table.id, 'locked', null)
      }
      if (assigned.some(r => r.status === 'seated')) {
        return statusRecord(table.id, 'seated', null)
      }
      if (assigned.length > 0) return statusRecord(table.id, 'reserved', null)
      return statusRecord(table.id, 'free', null)
    }

    if (assigned.length > 0) return statusRecord(table.id, 'reserved', null)
    return statusRecord(table.id, 'free', null)
  })
}
