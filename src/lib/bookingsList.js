import { addDays } from './experienceSeries'

export const LOAD_WINDOW_DAYS = 60
export const CUSTOMER_ID_CHUNK = 100

export function windowStart(today, days = LOAD_WINDOW_DAYS) {
  return addDays(today, -days)
}

export function olderWindowStart(currentStart, days = LOAD_WINDOW_DAYS) {
  return addDays(currentStart, -days)
}

// A date filter earlier than the loaded window needs that older range loaded.
export function effectiveWindowStart(loadFrom, filterDate) {
  return typeof filterDate === 'string' && filterDate !== '' && filterDate < loadFrom ? filterDate : loadFrom
}

export function chunk(items, size) {
  if (size < 1) throw new RangeError('chunk size must be at least 1')
  const out = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

export function partitionBookings(items, dateField, today) {
  const upcoming = []
  const past = []
  for (const item of items) {
    if (item[dateField] >= today && item.status !== 'cancelled') upcoming.push(item)
    else past.push(item)
  }
  return { upcoming, past }
}

export function releasesTables(status) {
  return status === 'completed' || status === 'cancelled' || status === 'no_show'
}
