// Payload for the floor-plan layout upsert. Deliberately omits locked_until,
// locked_by_reservation and group_id so a stale copy can't clobber a lock
// taken while the layout editor was open.
export function toLayoutRows(tables) {
  return tables.map(t => ({
    id: t.id,
    table_number: t.table_number,
    capacity: t.capacity,
    x_position: t.x_position,
    y_position: t.y_position,
    is_bookable: t.is_bookable,
    rotated: t.rotated || false,
  }))
}

// restaurant_tables.table_number is unique in the database; returns the first
// name used by more than one table, or null.
export function firstDuplicateName(tables) {
  const seen = new Set()
  for (const t of tables) {
    if (seen.has(t.table_number)) return t.table_number
    seen.add(t.table_number)
  }
  return null
}
