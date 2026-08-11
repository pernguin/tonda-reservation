export async function getDayType(dateString) {
  const [year, month, day] = dateString.split('-').map(Number)
  const dateObj = new Date(year, month - 1, day)
  const dow = dateObj.getDay()
  // day 5 = Friday, day 6 = Saturday — matches Reservations.jsx's weekend definition
  let day_type = (dow === 5 || dow === 6) ? 'weekend' : 'weekday'
  try {
    const res = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/MY`)
    const holidays = await res.json()
    if (holidays.some(h => h.date === dateString)) day_type = 'public_holiday'
  } catch (e) {
    console.error('Could not fetch holidays', e)
  }
  return day_type
}
