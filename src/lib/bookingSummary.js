const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Build from string parts — never new Date('YYYY-MM-DD'), which parses as UTC.
export function formatWhen(reservationDate, reservationTime) {
  const [y, m, d] = String(reservationDate).split('-').map(Number)
  const local = new Date(y, m - 1, d)
  const datePart = `${DAYS[local.getDay()]} ${d} ${MONTHS[m - 1]}`
  const time = reservationTime ? String(reservationTime).slice(0, 5) : ''
  return time ? `${datePart} ${time}` : datePart
}

export function describeBooking(row) {
  const name = row.customer?.full_name || 'Unknown customer'
  const parts = [name, `${row.guest_count} pax`, formatWhen(row.reservation_date, row.reservation_time)]
  if (row.status === 'pending') parts.push('needs approval')
  if (row.needs_manual_assignment === true) parts.push('no table')
  return parts.join(' · ')
}
