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
