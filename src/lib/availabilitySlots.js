// Mirrors the `p_guest_count > 10` early return in get_availability.
export const MAX_ONLINE_PARTY = 10

// get_availability returns `time` values, which PostgREST sends as 'HH:MM:SS'.
export function slotKey(time) {
  return String(time).slice(0, 5)
}

export function findSlotRow(rows, time) {
  return (rows || []).find(row => slotKey(row.slot) === slotKey(time))
}

// Keeps only the slots the server returned (and that pass isBookable), dropping
// any session group left empty. Does not mutate its input.
export function pickAvailableGroups(slotGroups, rows, date, isBookable = () => true) {
  return slotGroups
    .map(group => ({
      ...group,
      slots: group.slots.filter(slot =>
        findSlotRow(rows, slot.value) !== undefined && isBookable(slot.value, date)
      )
    }))
    .filter(group => group.slots.length > 0)
}
