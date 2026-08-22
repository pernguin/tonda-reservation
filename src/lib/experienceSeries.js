const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const ORDINALS = ['', '1st', '2nd', '3rd', '4th', '5th']

export function parseDateString(dateString) {
  const [year, month, day] = dateString.split('-').map(Number)
  return new Date(year, month - 1, day)
}

export function toDateString(d) {
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function addDays(dateString, days) {
  const d = parseDateString(dateString)
  d.setDate(d.getDate() + days)
  return toDateString(d)
}

export function daysBetween(startStr, endStr) {
  const start = parseDateString(startStr)
  const end = parseDateString(endStr)
  return Math.round((end - start) / 86400000)
}

// Every calendar date from startDate through endDate, inclusive.
export function dateRange(startDate, endDate) {
  const dates = [startDate]
  let cursor = startDate
  while (cursor < endDate) {
    cursor = addDays(cursor, 1)
    dates.push(cursor)
  }
  return dates
}

function daysInMonth(year, month) {
  // month is 1-12; day 0 of the next month is the last day of this one.
  return new Date(year, month, 0).getDate()
}

// nth (1-5) occurrence of `weekday` (0=Sun..6=Sat) in (year, month), or null if the month doesn't have one.
function nthWeekdayDateInMonth(year, month, weekday, nth) {
  const firstWeekday = new Date(year, month - 1, 1).getDay()
  const firstOccurrenceDay = 1 + ((weekday - firstWeekday + 7) % 7)
  const day = firstOccurrenceDay + (nth - 1) * 7
  if (day > daysInMonth(year, month)) return null
  return toDateString(new Date(year, month - 1, day))
}

// Generates the dates for a recurring series, stopping once the next date
// would exceed `repeatUntil` (inclusive). Monthly occurrences that would land
// on a nth-weekday the target month doesn't have are omitted, not silently
// shifted — callers should surface `skipped` to the admin. The month/week
// cursor always advances by a fixed step regardless of a skip, so this is
// guaranteed to terminate in a bounded number of steps for any finite
// repeatUntil — no iteration cap needed.
export function generateSeriesDates({ startDate, endDate, cadence, interval, repeatUntil }) {
  const spanDays = endDate ? daysBetween(startDate, endDate) : 0
  const dates = []
  const skipped = []

  if (cadence === 'weekly') {
    let n = 0
    while (true) {
      const date = n === 0 ? startDate : addDays(startDate, n * interval * 7)
      if (date > repeatUntil) break
      dates.push({ date, endDate: spanDays > 0 ? addDays(date, spanDays) : null })
      n++
    }
    return { dates, skipped }
  }

  // Monthly: same nth-weekday-of-month as the start date (e.g. "2nd Saturday").
  const start = parseDateString(startDate)
  const weekday = start.getDay()
  const nth = Math.ceil(start.getDate() / 7)
  const startYear = start.getFullYear()
  const startMonth = start.getMonth() + 1

  let n = 0
  while (true) {
    let date
    if (n === 0) {
      date = startDate
    } else {
      const totalMonths = (startMonth - 1) + n * interval
      const targetYear = startYear + Math.floor(totalMonths / 12)
      const targetMonth = (totalMonths % 12) + 1
      const monthStart = toDateString(new Date(targetYear, targetMonth - 1, 1))
      if (monthStart > repeatUntil) break
      date = nthWeekdayDateInMonth(targetYear, targetMonth, weekday, nth)
      if (!date) {
        skipped.push(`${MONTH_NAMES[targetMonth - 1]} ${targetYear} doesn't have a ${ORDINALS[nth] || `${nth}th`} ${WEEKDAY_NAMES[weekday]}`)
        n++
        continue
      }
    }
    if (date > repeatUntil) break
    dates.push({ date, endDate: spanDays > 0 ? addDays(date, spanDays) : null })
    n++
  }

  return { dates, skipped }
}
