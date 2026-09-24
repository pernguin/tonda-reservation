import { BRAND, CREAM } from './adminTheme'

function isLeapYear(y) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
}

export function isBirthdayOn(birthdate, date) {
  if (!birthdate || !date) return false
  const [, bm, bd] = birthdate.split('-').map(Number)
  const [dy, dm, dd] = date.split('-').map(Number)
  const day = bm === 2 && bd === 29 && !isLeapYear(dy) ? 28 : bd
  return bm === dm && day === dd
}

export const GUEST_TAGS = [
  { key: 'vip', label: 'VIP', style: { backgroundColor: BRAND, color: 'white' } },
  { key: 'difficult', label: 'Difficult', className: 'bg-amber-100 text-amber-700' },
  { key: 'allergy', label: 'Allergy', pillLabel: '⚠ Allergy', className: 'bg-red-100 text-red-800' },
  { key: 'big_spender', label: 'Big spender', className: 'bg-green-100 text-green-800' },
  { key: 'friends_family', label: 'Friends & Family', className: 'bg-gray-100 text-gray-700' },
  { key: 'press', label: 'Press / Influencer', className: 'bg-gray-100 text-gray-700' }
]

export function visitStage(visitCount) {
  const n = (visitCount ?? 0) + 1
  if (n === 1) return '1st visit'
  if (n === 2) return '2nd visit'
  if (n === 3) return '3rd visit'
  return 'Regular'
}

const TERMINAL_STATUSES = ['completed', 'no_show', 'cancelled']

function tagPill(key) {
  const tag = GUEST_TAGS.find((t) => t.key === key)
  const pill = { key, label: tag.pillLabel ?? tag.label }
  if (tag.className) pill.className = tag.className
  if (tag.style) pill.style = tag.style
  return pill
}

export function getGuestPills(customer, booking, today) {
  if (!customer) return []

  const tags = customer.tags ?? []
  const pills = []

  for (const key of ['allergy', 'difficult']) {
    if (tags.includes(key)) pills.push(tagPill(key))
  }

  if (customer.no_show_count >= 1) {
    pills.push({
      key: 'no_show',
      label: `No-show ×${customer.no_show_count}`,
      className: 'bg-orange-100 text-orange-800'
    })
  }

  for (const key of ['vip', 'big_spender', 'friends_family', 'press']) {
    if (tags.includes(key)) pills.push(tagPill(key))
  }

  if (isBirthdayOn(customer.birthdate, booking.date)) {
    pills.push({
      key: 'birthday',
      label: '🎂 Birthday',
      style: { backgroundColor: CREAM, color: BRAND }
    })
  }

  const isTerminal = TERMINAL_STATUSES.includes(booking.status) || booking.date < today
  if (!isTerminal) {
    const label = visitStage(customer.visit_count)
    pills.push(
      label === 'Regular'
        ? { key: 'visit', label, style: { border: `1px solid ${BRAND}`, color: BRAND } }
        : { key: 'visit', label, className: 'border border-gray-300 text-gray-600' }
    )
  }

  if (customer.notes?.trim()) {
    pills.push({ key: 'note', label: '📝 Note', className: 'bg-gray-100 text-gray-500' })
  }

  return pills
}
