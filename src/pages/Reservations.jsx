import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { supabaseCustomers } from '../supabaseCustomers'

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

async function autoAssignTables(reservationId, reservationDate, reservationTime, guestCount) {
  try {
    const { data: allTables } = await supabase
      .from('restaurant_tables')
      .select('*')
      .eq('is_bookable', true)

    if (!allTables || allTables.length === 0) return

    const [resH, resM] = reservationTime.split(':').map(Number)
    const resMins = resH * 60 + resM
    const resEnd = resMins + 120

    const availableTables = allTables.filter(table => {
      if (!table.locked_until) return true
      const lockedUntil = new Date(table.locked_until)
      const lockedUntilMins = lockedUntil.getHours() * 60 + lockedUntil.getMinutes()
      return lockedUntilMins <= resMins
    })

    const { data: existingReservations } = await supabase
      .from('reservations')
      .select('*')
      .eq('reservation_date', reservationDate)
      .in('status', ['confirmed', 'pending', 'seated'])
      .neq('id', reservationId)

    const conflictingTableIds = new Set()
    for (const r of existingReservations || []) {
      const [h, m] = r.reservation_time.split(':').map(Number)
      const existStart = h * 60 + m
      const existEnd = existStart + 120
      const overlaps = resMins < existEnd && resEnd > existStart
      if (overlaps && Array.isArray(r.table_ids)) {
        r.table_ids.forEach(id => conflictingTableIds.add(id))
      }
    }

    const freeTables = availableTables.filter(t => !conflictingTableIds.has(t.id))

    if (freeTables.length === 0) return

    const singleTable = freeTables
      .filter(t => t.capacity >= guestCount)
      .sort((a, b) => a.capacity - b.capacity)[0]

    if (singleTable) {
      const lockFrom = new Date()
      lockFrom.setHours(resH, resM, 0, 0)
      const lockUntil = new Date(lockFrom.getTime() + 2 * 60 * 60 * 1000)
      await supabase.from('reservations').update({ table_ids: [singleTable.id] }).eq('id', reservationId)
      await supabase.from('restaurant_tables').update({
        locked_until: lockUntil.toISOString(),
        locked_by_reservation: reservationId
      }).eq('id', singleTable.id)
      return
    }

    const sortedTables = [...freeTables].sort((a, b) => a.x_position - b.x_position)

    for (let size = 2; size <= Math.min(4, sortedTables.length); size++) {
      const combinations = getCombinations(sortedTables, size)
      let bestCombo = null
      let bestScore = Infinity

      for (const combo of combinations) {
        const totalCapacity = combo.reduce((sum, t) => sum + t.capacity, 0)
        if (totalCapacity < guestCount) continue

        let maxDist = 0
        for (let i = 0; i < combo.length; i++) {
          for (let j = i + 1; j < combo.length; j++) {
            const dist = Math.sqrt(
              Math.pow(combo[i].x_position - combo[j].x_position, 2) +
              Math.pow(combo[i].y_position - combo[j].y_position, 2)
            )
            maxDist = Math.max(maxDist, dist)
          }
        }

        if (maxDist < bestScore) {
          bestScore = maxDist
          bestCombo = combo
        }
      }

      if (bestCombo) {
        const tableIds = bestCombo.map(t => t.id)
        const lockFrom = new Date()
        lockFrom.setHours(resH, resM, 0, 0)
        const lockUntil = new Date(lockFrom.getTime() + 2 * 60 * 60 * 1000)
        await supabase.from('reservations').update({ table_ids: tableIds }).eq('id', reservationId)
        await supabase.from('restaurant_tables').update({
          locked_until: lockUntil.toISOString(),
          locked_by_reservation: reservationId
        }).in('id', tableIds)
        return
      }
    }
  } catch (err) {
    console.error('Auto-assignment failed:', err)
  }
}

function getCombinations(arr, size) {
  if (size === 1) return arr.map(item => [item])
  const result = []
  for (let i = 0; i <= arr.length - size; i++) {
    const rest = getCombinations(arr.slice(i + 1), size - 1)
    rest.forEach(combo => result.push([arr[i], ...combo]))
  }
  return result
}

const BRAND = '#E8420A'
const CREAM = '#FFFFFF'

function normalisePhone(raw) {
  let p = raw.replace(/[\s\-\(\)]/g, '')
  if (p.startsWith('+')) p = p.slice(1)
  if (p.startsWith('0')) p = '60' + p.slice(1)
  return p
}

const inputClass = "w-full border-b border-gray-300 bg-transparent py-3 text-sm text-gray-800 focus:outline-none focus:border-gray-800 transition-colors placeholder-gray-400"
const labelClass = "block text-xs tracking-widest uppercase mb-1 text-gray-500"

export default function Reservations() {
  const [form, setForm] = useState({
    full_name: '', phone: '', email: '',
    reservation_date: '', reservation_time: '',
    guest_count: '', notes: '',
    baby_chairs: 0, pets: false
  })
  const [dateInfo, setDateInfo] = useState(null)
  const [dateLoading, setDateLoading] = useState(false)
  const [dateError, setDateError] = useState(null)
  const [submitted, setSubmitted] = useState(false)
  const [bookingId, setBookingId] = useState(null)
  const [confirmationMessage, setConfirmationMessage] = useState('Thank you for your reservation request. Our team will contact you shortly to confirm your booking.')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [existingCustomer, setExistingCustomer] = useState(undefined)
  const [birthdayInput, setBirthdayInput] = useState('')
  const [birthdaySkipped, setBirthdaySkipped] = useState(false)

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target
    setForm(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }))
    if (name === 'phone') {
      setExistingCustomer(undefined)
      setBirthdayInput('')
      setBirthdaySkipped(false)
    }
  }

  async function handlePhoneBlur() {
    const normalised = normalisePhone(form.phone)
    if (!normalised) return
    setForm(prev => ({ ...prev, phone: normalised }))
    const { data } = await supabaseCustomers
      .from('customers')
      .select('id, full_name, email, birthdate')
      .eq('phone', normalised)
      .maybeSingle()
    setExistingCustomer(data || null)
    if (data) {
      setForm(prev => ({
        ...prev,
        full_name: prev.full_name || data.full_name || '',
        email: prev.email || data.email || ''
      }))
    }
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

      const normalisedPhone = normalisePhone(form.phone)

      let customerId
      if (existingCustomer) {
        customerId = existingCustomer.id
        if (birthdayInput && !birthdaySkipped) {
          await supabaseCustomers.from('customers').update({ birthdate: birthdayInput }).eq('id', existingCustomer.id)
        }
      } else {
        const { data: customer, error: customerError } = await supabaseCustomers
          .from('customers')
          .insert([{ full_name: form.full_name, phone: normalisedPhone, email: form.email, birthdate: birthdayInput || null }])
          .select().single()
        if (customerError) throw customerError
        customerId = customer.id
      }

      const autoConfirm = availability.autoConfirm && !availability.manualOnly
      const { data: booking, error: bookingError } = await supabase
        .from('reservations')
        .insert([{
          customer_id: customerId,
          reservation_date: form.reservation_date,
          reservation_time: form.reservation_time,
          guest_count: parseInt(form.guest_count),
          notes: form.notes,
          baby_chairs: parseInt(form.baby_chairs) || 0,
          pets: form.pets,
          status: autoConfirm ? 'confirmed' : 'pending',
          table_type: availability.type,
          tables_count: availability.count
        }])
        .select()
        .single()
      if (bookingError) throw bookingError
      setBookingId(booking.id)
      autoAssignTables(booking.id, form.reservation_date, form.reservation_time, parseInt(form.guest_count))
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
            <input name="phone" value={form.phone} onChange={handleChange} onBlur={handlePhoneBlur} required
              placeholder="+60 12 345 6789"
              className={inputClass} />
            {existingCustomer && !existingCustomer.birthdate && !birthdaySkipped && (
              <div className="mt-3">
                <p className="text-xs text-gray-500 mb-2">Welcome back! 🎂 Would you like to share your birthday with us?</p>
                <div className="flex items-center gap-4">
                  <input type="date" value={birthdayInput} onChange={e => setBirthdayInput(e.target.value)}
                    className={inputClass} />
                  <button type="button"
                    onClick={() => { setBirthdaySkipped(true); setBirthdayInput('') }}
                    className="text-xs tracking-widest uppercase shrink-0 transition-opacity hover:opacity-70"
                    style={{ color: BRAND }}>
                    Skip
                  </button>
                </div>
              </div>
            )}
          </div>

          <div>
            <label className={labelClass}>Email</label>
            <input name="email" type="email" value={form.email} onChange={handleChange}
              placeholder="your@email.com"
              className={inputClass} />
          </div>

          {existingCustomer === null && (
            <div>
              <label className={labelClass}>Birthday (optional)</label>
              <input type="date" value={birthdayInput} onChange={e => setBirthdayInput(e.target.value)}
                className={inputClass} />
              <p className="text-xs text-gray-400 mt-1">We'd love to celebrate with you 🎂</p>
            </div>
          )}

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

          <div className="grid grid-cols-2 gap-6">
            <div>
              <label className={labelClass}>Baby Chairs</label>
              <input name="baby_chairs" type="number" min="0"
                value={form.baby_chairs} onChange={handleChange}
                className={inputClass} />
            </div>
            <div className="flex items-end pb-3">
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input name="pets" type="checkbox" checked={form.pets} onChange={handleChange}
                  className="w-4 h-4" />
                I'm bringing a pet 🐾
              </label>
            </div>
          </div>

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