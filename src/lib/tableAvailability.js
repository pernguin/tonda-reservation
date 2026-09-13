import { supabase } from '../supabase'

const ACTIVE_RESERVATION_STATUSES = ['confirmed', 'pending', 'seated']

export const ARRIVING_SOON_MINUTES = 30

// Parses 'HH:MM' or 'HH:MM:SS' into minutes since local midnight. null/undefined -> null.
export function timeToMinutes(hhmm) {
  if (hhmm == null) return null
  const [h, m] = hhmm.split(':')
  return Number(h) * 60 + Number(m)
}

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

// Pure, synchronous: computes each table's Free/Reserved/Blocked/Seated/Locked
// status for `dateString` from already-fetched data. Callers that already have
// tables/reservations/blocks on hand for other reasons (e.g. Tables.jsx, which
// needs the broader row shapes for its own UI anyway) should call this
// directly instead of getTableStatusForDate() below, to avoid fetching the
// same rows twice. `tables` need at least {id, is_bookable, locked_until};
// `reservations` need at least {table_ids, status}; `blocks` need at least
// {id, table_id, reason, source_type, source_id}.
export function computeTableStatus({ dateString, tables, reservations, blocks, atMinutes, holdMinutes }) {
  const today = isToday(dateString)

  const reservationsByTable = new Map()
  for (const r of reservations || []) {
    if (!Array.isArray(r.table_ids)) continue
    for (const tableId of r.table_ids) {
      const list = reservationsByTable.get(tableId) || []
      list.push(r)
      reservationsByTable.set(tableId, list)
    }
  }

  const blocksByTable = new Map()
  for (const b of blocks || []) {
    const list = blocksByTable.get(b.table_id) || []
    list.push(b)
    blocksByTable.set(b.table_id, list)
  }

  const now = new Date()
  const hold = holdMinutes ?? 120

  return (tables || []).map(table => {
    if (!table.is_bookable) return statusRecord(table.id, 'blocked', null)

    const tableBlocks = blocksByTable.get(table.id) || []
    const assigned = reservationsByTable.get(table.id) || []

    if (typeof atMinutes === 'number') {
      const block = tableBlocks.find(b => {
        const start = timeToMinutes(b.start_time) ?? 0
        const end = timeToMinutes(b.end_time) ?? 24 * 60
        return start <= atMinutes && atMinutes < end
      })
      if (block) return statusRecord(table.id, 'blocked', block)

      if (assigned.some(r => r.status === 'seated')) {
        return statusRecord(table.id, 'seated', null)
      }
      const occupied = assigned.some(r => {
        const start = timeToMinutes(r.reservation_time)
        return start != null && start <= atMinutes && atMinutes < start + hold
      })
      if (occupied) return statusRecord(table.id, 'occupied', null)

      const arriving = assigned.some(r => {
        const start = timeToMinutes(r.reservation_time)
        return start != null && atMinutes < start && start <= atMinutes + ARRIVING_SOON_MINUTES
      })
      if (arriving) return statusRecord(table.id, 'arriving', null)

      return statusRecord(table.id, 'free', null)
    }

    const block = tableBlocks[0]
    if (block) return statusRecord(table.id, 'blocked', block)

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

// Fetches tables/reservations/blocks itself, then delegates to
// computeTableStatus(). Use this when the caller doesn't already have that
// data on hand for `dateString` (e.g. Experiences.jsx, which computes status
// across several dates in an experience's span with no other state backing
// any of them).
export async function getTableStatusForDate(dateString) {
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

  return computeTableStatus({ dateString, tables, reservations, blocks })
}
