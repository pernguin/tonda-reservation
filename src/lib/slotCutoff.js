// Same-day slots that have already passed (or are about to) must not be bookable.
// Dates are local YYYY-MM-DD strings throughout the app, so this compares
// wall-clock minutes rather than constructing Dates in another timezone.

// A guest can't book a table they'd have to reach in the next few minutes.
export const LEAD_TIME_MINUTES = 30

function toMinutes(time) {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

function localDateString(d) {
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

// `now` is injectable so callers (and tests) aren't tied to the wall clock.
export function isSlotBookable(time, date, now = new Date()) {
  if (date !== localDateString(now)) return true
  const cutoff = now.getHours() * 60 + now.getMinutes() + LEAD_TIME_MINUTES
  return toMinutes(time) >= cutoff
}
