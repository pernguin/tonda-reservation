import { useState, useEffect } from 'react'
import { supabase } from '../supabase'

async function getDateInfo(date) {
  const dateObj = new Date(date)
  const day = dateObj.getDay()
  const dayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][day]
  const year = dateObj.getFullYear()

  const { data: blocked } = await supabase
    .from('blocked_dates')
    .select('*')
    .eq('blocked_date', date)
    .maybeSingle()

  if (blocked?.is_closed) return { closed: true, reason: 'Sorry, reservations are not available on this date.' }
  if (blocked?.max_pax) return { closed: false, max_pax: blocked.max_pax }

  let day_type = (day === 5 || day === 6) ? 'weekend' : 'weekday'
  // day 5 = Friday, day 6 = Saturday
  try {
    const res = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/MY`)
    const holidays = await res.json()
    if (holidays.some(h => h.date === date)) day_type = 'public_holiday'
  } catch (e) {
    console.error('Could not fetch holidays', e)
  }

  const { data: hours } = await supabase
    .from('operating_hours')
    .select('*')
    .eq('day_type', day_type)
    .maybeSingle()

  if (hours?.closed_days?.includes(dayName)) {
    return { closed: true, reason: `Sorry, we are closed on ${dayName}s.` }
  }

  const { data: slotRule } = await supabase
    .from('slot_rules')
    .select('*')
    .eq('day_type', day_type)
    .maybeSingle()

  return { closed: false, day_type, dayName, slotRule, operatingHours: hours }
}

function getTablesNeeded(guestCount) {
  if (guestCount <= 2) return { count: 1, type: 'small' }
  if (guestCount <= 10) {
    const n = Math.ceil((guestCount - 2) / 2)
    return { count: n, type: 'small' }
  }
  return { count: 0, type: 'none' }
}

async function checkAvailability(date, time, guestCount) {
  const bookingStart = new Date(`${date}T${time}`)
  const bookingEnd = new Date(bookingStart.getTime() + 2 * 60 * 60 * 1000)

  const { data: existing } = await supabase
    .from('reservations')
    .select('*')
    .eq('reservation_date', date)
    .in('status', ['confirmed', 'pending', 'seated'])

  let bookedSmall = 0
  let bigTableBooked = false

  for (const booking of existing || []) {
    const existStart = new Date(`${booking.reservation_date}T${booking.reservation_time}`)
    const existEnd = new Date(existStart.getTime() + 2 * 60 * 60 * 1000)
    const overlaps = bookingStart < existEnd && bookingEnd > existStart
    if (overlaps) {
      if (booking.table_type === 'big') bigTableBooked = true
      else bookedSmall += (booking.tables_count || 1)
    }
  }

  const availableSmall = 12 - bookedSmall

  if (guestCount >= 6 && guestCount <= 8 && !bigTableBooked) {
    return { available: true, type: 'big', count: 1, autoConfirm: true }
  }
  if (guestCount > 8 && !bigTableBooked) {
    return { available: true, type: 'big', count: 1, autoConfirm: false, manualOnly: true }
  }

  const tableNeeds = getTablesNeeded(guestCount)
  if (tableNeeds.type === 'none') {
    return { available: false, reason: 'Party size too large — please contact us directly.' }
  }
  if (tableNeeds.count > availableSmall) {
    return { available: false, reason: `Sorry, we don't have enough tables for this time slot. Please choose a different time.` }
  }

  return { available: true, type: 'small', count: tableNeeds.count, autoConfirm: true }
}

function isTimeWithinSessions(time, sessions) {
  const [h, m] = time.split(':').map(Number)
  const timeMins = h * 60 + m
  return sessions.some(session => {
    const [startH, startM] = session.start.split(':').map(Number)
    const lastBooking = session.last_booking || session.end
    const [lastH, lastM] = lastBooking.split(':').map(Number)
    return timeMins >= startH * 60 + startM && timeMins <= lastH * 60 + lastM
  })
}

function getOpenSlots(sessions) {
  const slots = []
  for (const session of sessions || []) {
    const [startH, startM] = session.start.split(':').map(Number)
    const lastBooking = session.last_booking || session.end
    const [lastH, lastM] = lastBooking.split(':').map(Number)
    let current = startH * 60 + startM
    const last = lastH * 60 + lastM
    while (current <= last) {
      const h = Math.floor(current / 60)
      const m = current % 60
      const time24 = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
      const ampm = h >= 12 ? 'PM' : 'AM'
      const hour = h > 12 ? h - 12 : h === 0 ? 12 : h
      const label = `${hour}:${String(m).padStart(2, '0')} ${ampm}${session.label ? ` — ${session.label}` : ''}`
      slots.push({ value: time24, label })
      current += 30
    }
  }
  return slots
}

function getFixedSlots(sessions) {
  return (sessions || []).map(session => {
    const [h, m] = session.start.split(':').map(Number)
    const ampm = h >= 12 ? 'PM' : 'AM'
    const hour = h > 12 ? h - 12 : h === 0 ? 12 : h
    const defaultLabel = `${hour}:${String(m).padStart(2, '0')} ${ampm}`
    return { value: session.start, label: session.label || defaultLabel }
  })
}

const BRAND = '#E8420A'
const CREAM = '#FFFFFF'

const inputClass = "w-full border-b border-gray-300 bg-transparent py-3 text-sm text-gray-800 focus:outline-none focus:border-gray-800 transition-colors placeholder-gray-400"
const labelClass = "block text-xs tracking-widest uppercase mb-1 text-gray-500"

export default function Reservations() {
  const [form, setForm] = useState({
    full_name: '', phone: '', email: '',
    reservation_date: '', reservation_time: '',
    guest_count: '', notes: ''
  })
  const [dateInfo, setDateInfo] = useState(null)
  const [dateLoading, setDateLoading] = useState(false)
  const [dateError, setDateError] = useState(null)
  const [submitted, setSubmitted] = useState(false)
  const [bookingId, setBookingId] = useState(null)
  const [confirmationMessage, setConfirmationMessage] = useState('Thank you for your reservation request. Our team will contact you shortly to confirm your booking.')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value })
  }

  async function handleDateChange(e) {
    const date = e.target.value
    setForm(prev => ({ ...prev, reservation_date: date, reservation_time: '' }))
    setDateInfo(null)
    setDateError(null)
    if (!date) return
    setDateLoading(true)
    const info = await getDateInfo(date)
    setDateLoading(false)
    if (info.closed) { setDateError(info.reason); return }
    setDateInfo(info)
  }

  function getTimeSlots() {
    if (!dateInfo?.slotRule) return []
    if (dateInfo.slotRule.rule_type === 'session') return getFixedSlots(dateInfo.slotRule.sessions)
    return getOpenSlots(dateInfo.operatingHours?.sessions || [])
  }

  const timeSlots = getTimeSlots()

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const info = await getDateInfo(form.reservation_date)
      if (info.closed) { setError(info.reason); setLoading(false); return }
      if (info.max_pax && parseInt(form.guest_count) > info.max_pax) {
        setError(`Sorry, we can only accommodate up to ${info.max_pax} guests on this date.`)
        setLoading(false); return
      }

      const { slotRule, operatingHours } = info
      if (slotRule?.rule_type === 'session') {
        const validStarts = (slotRule.sessions || []).map(s => s.start)
        if (!validStarts.includes(form.reservation_time)) {
          setError('Please select a valid time slot.'); setLoading(false); return
        }
      } else {
        if (operatingHours?.sessions && !isTimeWithinSessions(form.reservation_time, operatingHours.sessions)) {
          setError('Sorry, that time is outside our booking hours.'); setLoading(false); return
        }
      }

      const availability = await checkAvailability(form.reservation_date, form.reservation_time, parseInt(form.guest_count))
      if (!availability.available) { setError(availability.reason); setLoading(false); return }

      const { data: customer, error: customerError } = await supabase
        .from('customers')
        .insert([{ full_name: form.full_name, phone: form.phone, email: form.email }])
        .select().single()
      if (customerError) throw customerError

      const autoConfirm = availability.autoConfirm && !availability.manualOnly
      const { data: booking, error: bookingError } = await supabase
        .from('reservations')
        .insert([{
          customer_id: customer.id,
          reservation_date: form.reservation_date,
          reservation_time: form.reservation_time,
          guest_count: parseInt(form.guest_count),
          notes: form.notes,
          status: autoConfirm ? 'confirmed' : 'pending',
          table_type: availability.type,
          tables_count: availability.count
        }])
        .select()
        .single()
      if (bookingError) throw bookingError
      setBookingId(booking.id)
      const { data: msgData } = await supabase.from('settings').select('value').eq('key', 'confirmation_message_reservation').maybeSingle()
      if (msgData?.value) setConfirmationMessage(msgData.value)
      setSubmitted(true)
    } catch (err) {
      setError('Something went wrong. Please try again.')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }
function CopyButton({ text }) {
    const [copied, setCopied] = useState(false)
    return (
      <button
        onClick={() => {
          navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 2000)
        }}
        className="text-xs tracking-widest uppercase shrink-0 transition-colors"
        style={{ color: copied ? '#16a34a' : BRAND }}>
        {copied ? '✓ Copied' : 'Copy'}
      </button>
    )
  }
  if (submitted && bookingId) {
    const manageUrl = `${window.location.origin}/booking/${bookingId}`
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-8"
        style={{ backgroundColor: CREAM }}>
        <div className="text-center max-w-md">
          <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6"
            style={{ backgroundColor: '#16a34a' }}>
            <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-2xl font-light mb-3" style={{ color: BRAND }}>Request Received</h2>
          <p className="text-gray-500 text-sm leading-relaxed mb-6">{confirmationMessage}</p>
          <div className="border border-gray-200 rounded-xl p-4 mb-8 text-left"
            style={{ backgroundColor: 'white' }}>
            <p className="text-xs tracking-widest uppercase text-gray-400 mb-2">Manage your booking</p>
            <p className="text-xs text-gray-500 mb-3">Save this link to view or cancel your reservation:</p>
            <div className="flex items-center gap-2">
              <p className="text-xs text-gray-700 break-all flex-1">{manageUrl}</p>
              <CopyButton text={manageUrl} />
            </div>
          </div>
          <a href="/"
            className="text-xs tracking-widest uppercase transition-colors"
            style={{ color: BRAND }}>
            ← Back to Home
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: CREAM }}>
      <div className="max-w-lg mx-auto px-8 py-16">

        <p className="text-xs tracking-widest uppercase mb-2" style={{ color: BRAND }}>
          Tonda Pizza Romana
        </p>
        <h1 className="text-3xl font-light text-gray-900 mb-2">Make a Reservation</h1>
        <p className="text-gray-400 text-sm mb-12">Fill in your details and we'll confirm your booking shortly.</p>

        {error && (
          <div className="border-l-2 pl-4 mb-8 py-2" style={{ borderColor: BRAND }}>
            <p className="text-sm text-gray-700">{error}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-8">
          <div>
            <label className={labelClass}>Full Name *</label>
            <input name="full_name" value={form.full_name} onChange={handleChange} required
              placeholder="Your full name"
              className={inputClass} />
          </div>

          <div>
            <label className={labelClass}>Phone Number *</label>
            <input name="phone" value={form.phone} onChange={handleChange} required
              placeholder="+60 12 345 6789"
              className={inputClass} />
          </div>

          <div>
            <label className={labelClass}>Email</label>
            <input name="email" type="email" value={form.email} onChange={handleChange}
              placeholder="your@email.com"
              className={inputClass} />
          </div>

          <div className="grid grid-cols-2 gap-6">
            <div>
              <label className={labelClass}>Number of Guests *</label>
              <input name="guest_count" type="number" min="1" max="50"
                value={form.guest_count} onChange={handleChange} required
                placeholder="2"
                className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Date *</label>
              <input name="reservation_date" type="date" value={form.reservation_date}
                onChange={handleDateChange} required
                className={inputClass} />
              {dateLoading && <p className="text-xs text-gray-400 mt-1">Checking availability...</p>}
              {dateError && <p className="text-xs mt-1" style={{ color: BRAND }}>{dateError}</p>}
            </div>
          </div>

          {dateInfo && timeSlots.length > 0 && (
            <div>
              <label className={labelClass}>Time *</label>
              <select name="reservation_time" value={form.reservation_time}
                onChange={handleChange} required
                className={inputClass}>
                <option value="">Select a time</option>
                {timeSlots.map(slot => (
                  <option key={slot.value} value={slot.value}>{slot.label}</option>
                ))}
              </select>
            </div>
          )}

          {dateInfo && timeSlots.length === 0 && (
            <p className="text-sm" style={{ color: BRAND }}>No available time slots for this date.</p>
          )}

          <div>
            <label className={labelClass}>Special Requests</label>
            <textarea name="notes" value={form.notes} onChange={handleChange} rows={3}
              placeholder="Dietary requirements, allergies, celebrations..."
              className={inputClass + ' resize-none'} />
          </div>

          <button type="submit" disabled={loading || !!dateError || !dateInfo}
            className="w-full py-4 text-sm font-medium tracking-widest uppercase text-white transition-opacity hover:opacity-90 disabled:opacity-40"
            style={{ backgroundColor: BRAND }}>
            {loading ? 'Submitting...' : 'Request Reservation'}
          </button>
        </form>
      </div>
    </div>
  )
}