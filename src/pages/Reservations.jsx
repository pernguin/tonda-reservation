import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase'
import { supabaseCustomers, findOrCreateCustomer } from '../supabaseCustomers'

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
  const max_pax = blocked?.max_pax ?? null

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

  return { closed: false, day_type, dayName, slotRule, operatingHours: hours, max_pax }
}

function getTablesNeeded(guestCount) {
  if (guestCount <= 2) return { count: 1, type: 'small' }
  if (guestCount <= 10) {
    const n = Math.ceil((guestCount - 2) / 2)
    return { count: n, type: 'small' }
  }
  return { count: 0, type: 'none' }
}

async function getSmallTableCapacity() {
  const { data: bookableTables } = await supabase
    .from('restaurant_tables')
    .select('table_number, capacity')
    .eq('is_bookable', true)

  return (bookableTables || [])
    .filter(t => t.table_number !== 'BT' && (t.capacity || 0) >= 2)
    .reduce((sum, t) => sum + t.capacity, 0)
}

async function getBlackoutWindows(date) {
  const { data } = await supabase
    .from('blackout_dates')
    .select('start_time, end_time')
    .eq('block_date', date)
  return data || []
}

// A row with both times null blacks out the whole date. A row with only one
// bound set treats the missing bound as the day's edge (00:00 / 23:59).
function isBlackedOut(blackoutWindows, time, durationMinutes) {
  const [h, m] = time.split(':').map(Number)
  const startMins = h * 60 + m
  const endMins = startMins + durationMinutes

  return blackoutWindows.some(w => {
    if (!w.start_time && !w.end_time) return true
    const [wsH, wsM] = (w.start_time || '00:00').split(':').map(Number)
    const [weH, weM] = (w.end_time || '23:59').split(':').map(Number)
    const windowStart = wsH * 60 + wsM
    const windowEnd = weH * 60 + weM
    return startMins < windowEnd && endMins > windowStart
  })
}

// Pure: decides availability for one candidate time from already-fetched
// reservations/capacity/blackouts, so a multi-slot search doesn't re-fetch
// per slot. Blackout is checked first, before any capacity/table math.
function computeAvailability(existingReservations, totalSmallCapacity, blackoutWindows, date, time, guestCount, durationMinutes) {
  if (isBlackedOut(blackoutWindows, time, durationMinutes)) {
    return { available: false, reason: 'Sorry, reservations are not available at this time.' }
  }

  const bookingStart = new Date(`${date}T${time}`)
  const bookingEnd = new Date(bookingStart.getTime() + durationMinutes * 60 * 1000)

  let bookedSmallSeats = 0
  let bigTableBooked = false

  for (const booking of existingReservations || []) {
    const existStart = new Date(`${booking.reservation_date}T${booking.reservation_time}`)
    const existEnd = new Date(existStart.getTime() + durationMinutes * 60 * 1000)
    const overlaps = bookingStart < existEnd && bookingEnd > existStart
    if (overlaps) {
      if (booking.table_type === 'big') bigTableBooked = true
      else bookedSmallSeats += (booking.guest_count || 0)
    }
  }

  const availableSmallSeats = totalSmallCapacity - bookedSmallSeats

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
  if (guestCount > availableSmallSeats) {
    return { available: false, reason: `Sorry, we don't have enough tables for this time slot. Please choose a different time.` }
  }

  return { available: true, type: 'small', count: tableNeeds.count, autoConfirm: true }
}

async function checkAvailability(date, time, guestCount, durationMinutes) {
  const [{ data: existing }, totalSmallCapacity, blackoutWindows] = await Promise.all([
    supabase
      .from('reservations')
      .select('*')
      .eq('reservation_date', date)
      .in('status', ['confirmed', 'pending', 'seated']),
    getSmallTableCapacity(),
    getBlackoutWindows(date)
  ])
  return computeAvailability(existing || [], totalSmallCapacity, blackoutWindows, date, time, guestCount, durationMinutes)
}

// Runs computeAvailability across every candidate slot in one pass (single
// fetch of reservations/capacity/blackouts) and keeps only the slots that are
// actually bookable, dropping any session group left with none.
async function searchAvailability(date, guestCount, durationMinutes, slotGroups) {
  const [{ data: existing }, totalSmallCapacity, blackoutWindows] = await Promise.all([
    supabase
      .from('reservations')
      .select('*')
      .eq('reservation_date', date)
      .in('status', ['confirmed', 'pending', 'seated']),
    getSmallTableCapacity(),
    getBlackoutWindows(date)
  ])

  return slotGroups
    .map(group => ({
      sessionLabel: group.sessionLabel,
      slots: group.slots.filter(slot =>
        computeAvailability(existing || [], totalSmallCapacity, blackoutWindows, date, slot.value, guestCount, durationMinutes).available
      )
    }))
    .filter(group => group.slots.length > 0)
}

function formatTime12(time24) {
  const [h, m] = time24.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const hour = h > 12 ? h - 12 : h === 0 ? 12 : h
  return `${hour}:${String(m).padStart(2, '0')} ${ampm}`
}

function formatTimeRange(time24, durationMinutes) {
  const [h, m] = time24.split(':').map(Number)
  const startMins = h * 60 + m
  const endMins = startMins + durationMinutes
  const endH = Math.floor(endMins / 60) % 24
  const endM = endMins % 60
  const endTime24 = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`
  return `${formatTime12(time24)} – ${formatTime12(endTime24)}`
}

function formatDuration(minutes) {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  const parts = []
  if (h > 0) parts.push(`${h} hour${h !== 1 ? 's' : ''}`)
  if (m > 0) parts.push(`${m} minute${m !== 1 ? 's' : ''}`)
  return parts.join(' ') || '0 minutes'
}

// Groups: 'open' rule_type yields one group per operating-hours session
// (e.g. Lunch, Dinner), each with 30-min pills across that session's window.
function getOpenSlots(sessions) {
  return (sessions || []).map(session => {
    const [startH, startM] = session.start.split(':').map(Number)
    const lastBooking = session.last_booking || session.end
    const [lastH, lastM] = lastBooking.split(':').map(Number)
    let current = startH * 60 + startM
    const last = lastH * 60 + lastM
    const slots = []
    while (current <= last) {
      const h = Math.floor(current / 60)
      const m = current % 60
      const time24 = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
      slots.push({ value: time24, label: formatTime12(time24) })
      current += 30
    }
    return { sessionLabel: session.label || '', slots }
  })
}

// 'session' rule_type yields one group per fixed session, each with a single
// pill at that session's start time (fixed-session bookings have no range).
function getFixedSlots(sessions) {
  return (sessions || []).map(session => ({
    sessionLabel: session.label || '',
    slots: [{ value: session.start, label: formatTime12(session.start) }]
  }))
}

function getTimeSlotGroups(info) {
  if (!info?.slotRule) return []
  if (info.slotRule.rule_type === 'session') return getFixedSlots(info.slotRule.sessions)
  return getOpenSlots(info.operatingHours?.sessions || [])
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

async function flagNeedsManualAssignment(reservationId) {
  const { error } = await supabase
    .from('reservations')
    .update({ needs_manual_assignment: true })
    .eq('id', reservationId)
  if (error) console.error('Failed to flag reservation for manual assignment', reservationId, error)
}

async function autoAssignTables(reservationId, reservationDate, reservationTime, guestCount, durationMinutes) {
  try {
    const [resH, resM] = reservationTime.split(':').map(Number)
    const resMins = resH * 60 + resM
    const resEnd = resMins + durationMinutes
    // Built from the reservation's own date, not new Date()/today — the same
    // explicit y/m/d parsing used in getDateInfo, extended with h/m. Reused
    // below for locked_until so a lock is never dated against today's date
    // instead of the date actually being booked.
    const [resYear, resMonth, resDay] = reservationDate.split('-').map(Number)
    const reservationDateTime = new Date(resYear, resMonth - 1, resDay, resH, resM, 0, 0)

    // Re-fetched on every combo retry attempt, not just once up front — after a
    // lost claim race the set of truly free tables has changed, so a stale
    // snapshot (even with just the failed tables removed) can't be trusted.
    async function fetchFreeTables() {
      const { data: allTables } = await supabase
        .from('restaurant_tables')
        .select('*')
        .eq('is_bookable', true)
      if (!allTables || allTables.length === 0) return []

      // Filter out locked tables (locked within 2 hours of reservation time).
      // Compare as full datetimes, not just hour:minute — a lock from a
      // different day must not read as active at the same clock time today.
      const availableTables = allTables.filter(table => {
        if (!table.locked_until) return true
        return new Date(table.locked_until) <= reservationDateTime
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
        const existEnd = existStart + durationMinutes
        const overlaps = resMins < existEnd && resEnd > existStart
        if (overlaps && Array.isArray(r.table_ids)) {
          r.table_ids.forEach(id => conflictingTableIds.add(id))
        }
      }

      return availableTables.filter(t => !conflictingTableIds.has(t.id))
    }

    const freeTables = await fetchFreeTables()
    if (freeTables.length === 0) { await flagNeedsManualAssignment(reservationId); return }

    // Try to find a single table with enough capacity first, smallest sufficient
    // table first. The claim is atomic (see claim_restaurant_tables) and can lose
    // a race to another concurrent booking — on loss, retry the next smallest
    // sufficient candidate rather than giving up on the first one.
    const singleCandidates = freeTables
      .filter(t => t.capacity >= guestCount)
      .sort((a, b) => a.capacity - b.capacity)

    if (singleCandidates.length > 0) {
      const lockUntil = new Date(reservationDateTime.getTime() + durationMinutes * 60 * 1000)

      for (const candidate of singleCandidates) {
        const { error: claimError } = await supabase.rpc('claim_restaurant_tables', {
          p_table_ids: [candidate.id],
          p_reservation_id: reservationId,
          p_reservation_start: reservationDateTime.toISOString(),
          p_lock_until: lockUntil.toISOString()
        })
        if (!claimError) {
          await supabase.from('reservations').update({ table_ids: [candidate.id] }).eq('id', reservationId)
          return
        }
      }
      console.error('Auto-assignment failed: all single-table candidates lost the claim race')
      await flagNeedsManualAssignment(reservationId)
      return
    }

    // No single table — find best combination using proximity. Combo claims are
    // all-or-nothing (see claim_restaurant_tables), so a lost race means the
    // combo just picked is no longer trustworthy — retry with freshly fetched
    // tables rather than reusing the same (now stale) candidate list.
    const MAX_COMBO_ATTEMPTS = 3
    for (let attempt = 1; attempt <= MAX_COMBO_ATTEMPTS; attempt++) {
      const attemptFreeTables = attempt === 1 ? freeTables : await fetchFreeTables()
      if (attemptFreeTables.length === 0) continue

      // Sort tables by position to find clusters
      const sortedTables = [...attemptFreeTables].sort((a, b) => a.x_position - b.x_position)

      // Try combinations of 2, 3, 4 tables, smallest viable size first
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
          const lockUntil = new Date(reservationDateTime.getTime() + durationMinutes * 60 * 1000)
          const { error: claimError } = await supabase.rpc('claim_restaurant_tables', {
            p_table_ids: tableIds,
            p_reservation_id: reservationId,
            p_reservation_start: reservationDateTime.toISOString(),
            p_lock_until: lockUntil.toISOString()
          })
          if (!claimError) {
            await supabase.from('reservations').update({ table_ids: tableIds }).eq('id', reservationId)
            return
          }
          console.error(`Auto-assignment: combo claim lost the race (attempt ${attempt}/${MAX_COMBO_ATTEMPTS})`, claimError)
          break
        }
      }
    }

    console.error('Auto-assignment failed: exhausted all combo retry attempts')
    await flagNeedsManualAssignment(reservationId)
  } catch (err) {
    console.error('Auto-assignment failed:', err)
    await flagNeedsManualAssignment(reservationId).catch(() => {})
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

const inputClass = "w-full border-b border-gray-300 bg-transparent py-3 text-sm text-gray-800 focus:outline-none focus:border-gray-800 transition-colors placeholder-gray-400 disabled:opacity-40 disabled:cursor-not-allowed"
const labelClass = "block text-xs tracking-widest uppercase mb-1 text-gray-500"

export default function Reservations() {
  const navigate = useNavigate()
  const [form, setForm] = useState({
    full_name: '', phone: '', email: '',
    reservation_date: '', reservation_time: '',
    guest_count: '', notes: '',
    baby_chairs: 0, pets: false
  })
  const [hasSearched, setHasSearched] = useState(false)
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchError, setSearchError] = useState(null)
  const [availableGroups, setAvailableGroups] = useState([])
  const [selectedSlot, setSelectedSlot] = useState(null)
  const [searchDurationMinutes, setSearchDurationMinutes] = useState(120)
  const [submitted, setSubmitted] = useState(false)
  const [bookingId, setBookingId] = useState(null)
  const [confirmedBooking, setConfirmedBooking] = useState(null)
  const [confirmationMessage, setConfirmationMessage] = useState('Thank you for your reservation request. Our team will contact you shortly to confirm your booking.')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [existingCustomer, setExistingCustomer] = useState(undefined)
  const [birthdayInput, setBirthdayInput] = useState('')
  const [birthdaySkipped, setBirthdaySkipped] = useState(false)
  const [experiences, setExperiences] = useState([])
  const [lookupStatus, setLookupStatus] = useState('idle') // 'idle' | 'loading' | 'found' | 'not_found'
  const researchDebounceRef = useRef(null)
  const lookupStatusResetRef = useRef(null)

  useEffect(() => {
    async function fetchExperiences() {
      const today = new Date().toISOString().split('T')[0]
      const { data } = await supabase
        .from('experiences')
        .select('*')
        .eq('status', 'published')
        .gte('date', today)
        .order('date', { ascending: true })
      setExperiences(data || [])
    }
    fetchExperiences()
  }, [])

  // Clear any pending debounce/timeout on unmount so it doesn't fire after teardown.
  useEffect(() => () => {
    if (researchDebounceRef.current) clearTimeout(researchDebounceRef.current)
    if (lookupStatusResetRef.current) clearTimeout(lookupStatusResetRef.current)
  }, [])

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target
    // A phone edit while stale auto-filled data is showing must not let that
    // data ride along attached to a now-different phone number.
    const hadMatch = name === 'phone' && lookupStatus === 'found'
    setForm(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
      ...(hadMatch ? { full_name: '', email: '' } : {})
    }))
    if (name === 'phone') {
      setExistingCustomer(undefined)
      setBirthdayInput('')
      setBirthdaySkipped(false)
      if (lookupStatusResetRef.current) clearTimeout(lookupStatusResetRef.current)
      setLookupStatus('idle')
    }
  }

  async function handlePhoneBlur() {
    const normalised = normalisePhone(form.phone)
    if (!normalised) return
    setForm(prev => ({ ...prev, phone: normalised }))
    if (lookupStatusResetRef.current) clearTimeout(lookupStatusResetRef.current)
    setLookupStatus('loading')
    const { data } = await supabaseCustomers
      .from('customers')
      .select('id, full_name, email, birthdate')
      .eq('phone', normalised)
      .maybeSingle()
    setExistingCustomer(data || null)
    if (data) {
      setForm(prev => ({
        ...prev,
        full_name: data.full_name || prev.full_name || '',
        email: data.email || prev.email || ''
      }))
      setLookupStatus('found')
    } else {
      setLookupStatus('not_found')
    }
    lookupStatusResetRef.current = setTimeout(() => setLookupStatus('idle'), 2000)
  }

  async function runSearch(dateArg, guestsArg) {
    const date = dateArg ?? form.reservation_date
    const guestsRaw = guestsArg ?? form.guest_count
    setSelectedSlot(null)
    setAvailableGroups([])
    setSearchError(null)
    if (!date || !guestsRaw) return

    setSearchLoading(true)
    const info = await getDateInfo(date)
    if (info.closed) {
      setSearchLoading(false)
      setSearchError(info.reason)
      setHasSearched(true)
      return
    }

    const guestCount = parseInt(guestsRaw)
    if (info.max_pax && guestCount > info.max_pax) {
      setSearchLoading(false)
      setSearchError(`Sorry, we can only accommodate up to ${info.max_pax} guests on this date.`)
      setHasSearched(true)
      return
    }

    const durationMinutes = info.slotRule?.hold_duration_minutes ?? 120
    const slotGroups = getTimeSlotGroups(info)
    const resultGroups = await searchAvailability(date, guestCount, durationMinutes, slotGroups)

    setSearchDurationMinutes(durationMinutes)
    setAvailableGroups(resultGroups)
    setHasSearched(true)
    setSearchLoading(false)
  }

  function handleGuestsChange(e) {
    const value = e.target.value
    setForm(prev => ({ ...prev, guest_count: value }))
    if (hasSearched) {
      setSelectedSlot(null)
      if (researchDebounceRef.current) clearTimeout(researchDebounceRef.current)
      researchDebounceRef.current = setTimeout(() => runSearch(form.reservation_date, value), 400)
    }
  }

  function handleSearchDateChange(e) {
    const value = e.target.value
    setForm(prev => ({ ...prev, reservation_date: value }))
    if (hasSearched) {
      setSelectedSlot(null)
      if (researchDebounceRef.current) clearTimeout(researchDebounceRef.current)
      researchDebounceRef.current = setTimeout(() => runSearch(value, form.guest_count), 400)
    }
  }

  function handleSelectSlot(slot) {
    setSelectedSlot(slot)
    setForm(prev => ({ ...prev, reservation_time: slot.value }))
  }

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
      const durationMinutes = slotRule?.hold_duration_minutes ?? 120
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

      const availability = await checkAvailability(form.reservation_date, form.reservation_time, parseInt(form.guest_count), durationMinutes)
      if (!availability.available) { setError(availability.reason); setLoading(false); return }

      const customerId = await findOrCreateCustomer({
        full_name: form.full_name,
        phone: form.phone,
        email: form.email,
        birthdate: !birthdaySkipped ? birthdayInput : null
      })

      const { data: booking, error: bookingError } = await supabase
        .rpc('create_reservation_atomic', {
          p_reservation_date: form.reservation_date,
          p_reservation_time: form.reservation_time,
          p_day_type: info.day_type,
          p_guest_count: parseInt(form.guest_count),
          p_customer_id: customerId,
          p_notes: form.notes,
          p_baby_chairs: parseInt(form.baby_chairs) || 0,
          p_pets: form.pets
        })
        .single()
      if (bookingError) {
        const friendly = bookingError.message?.match(/^\w+: (.+)$/)
        setError(friendly ? friendly[1] : 'Something went wrong. Please try again.')
        setLoading(false)
        return
      }
      setBookingId(booking.id)
      setConfirmedBooking({ time: form.reservation_time, durationMinutes })
      autoAssignTables(booking.id, form.reservation_date, form.reservation_time, parseInt(form.guest_count), durationMinutes)
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
          {confirmedBooking && (
            <p className="text-sm font-medium text-gray-700 mb-2">
              {formatTimeRange(confirmedBooking.time, confirmedBooking.durationMinutes)}
            </p>
          )}
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

  const hasExperiences = experiences.length > 0

  return (
    <div className="min-h-screen" style={{ backgroundColor: CREAM }}>
      <div className={`max-w-[900px] mx-auto px-8 py-16 flex flex-col gap-12 ${hasExperiences ? 'md:flex-row md:items-start' : ''}`}>
      <div className={hasExperiences ? 'w-full md:w-[65%]' : 'w-full max-w-lg mx-auto'}>

        <p className="text-xs tracking-widest uppercase mb-2" style={{ color: BRAND }}>
          Tonda Pizza Romana
        </p>
        <h1 className="text-3xl font-light text-gray-900 mb-2">Make a Reservation</h1>
        <p className="text-gray-400 text-sm mb-12">Search for a time, then fill in your details to request a booking.</p>

        {error && (
          <div className="border-l-2 pl-4 mb-8 py-2" style={{ borderColor: BRAND }}>
            <p className="text-sm text-gray-700">{error}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-8">

          <div className="border border-gray-200 rounded-xl p-4" style={{ backgroundColor: 'white' }}>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className={labelClass}>Guests *</label>
                <input name="guest_count" type="number" min="1" max="50"
                  value={form.guest_count} onChange={handleGuestsChange} required
                  disabled={lookupStatus === 'loading'}
                  placeholder="2"
                  className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Date *</label>
                <input name="reservation_date" type="date" value={form.reservation_date}
                  onChange={handleSearchDateChange} required
                  disabled={lookupStatus === 'loading'}
                  className={inputClass} />
              </div>
            </div>
            <button type="button" onClick={() => runSearch()}
              disabled={!form.reservation_date || !form.guest_count || searchLoading}
              className="w-full py-3 text-sm font-medium tracking-widest uppercase text-white transition-opacity hover:opacity-90 disabled:opacity-40"
              style={{ backgroundColor: BRAND }}>
              {searchLoading ? 'Searching...' : 'Search'}
            </button>
          </div>

          {hasSearched && !searchLoading && searchError && (
            <p className="text-sm" style={{ color: BRAND }}>{searchError}</p>
          )}

          {hasSearched && !searchLoading && !searchError && availableGroups.length === 0 && (
            <div className="border border-gray-200 rounded-lg p-6 text-center">
              <p className="text-sm text-gray-500">No availability for this date. Please try a different date or guest count.</p>
            </div>
          )}

          {hasSearched && !searchLoading && !searchError && availableGroups.length > 0 && (
            <div>
              <label className={labelClass}>Available Times</label>
              <div className="mt-2 space-y-4">
                {availableGroups.map((group, i) => (
                  <div key={group.sessionLabel || i}>
                    {group.sessionLabel && (
                      <p className="text-xs text-gray-400 mb-2">{group.sessionLabel}</p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      {group.slots.map(slot => {
                        const isSelected = selectedSlot?.value === slot.value
                        return (
                          <button key={slot.value} type="button"
                            onClick={() => handleSelectSlot(slot)}
                            className="px-4 py-2 rounded-full text-sm font-medium border transition-colors"
                            style={isSelected
                              ? { backgroundColor: BRAND, color: 'white', borderColor: BRAND }
                              : { backgroundColor: 'white', color: '#374151', borderColor: '#d1d5db' }}>
                            {slot.label}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-xs text-gray-400 mt-4">
                Tables are held for {formatDuration(searchDurationMinutes)} from your reservation time. Please arrive on time — we may release your table to walk-ins if you're significantly late.
              </p>
            </div>
          )}

          {selectedSlot && (
            <>
              <div>
                <label className={labelClass}>Phone Number *</label>
                <input name="phone" value={form.phone} onChange={handleChange} onBlur={handlePhoneBlur} required
                  placeholder="+60 12 345 6789"
                  className={inputClass} />
                {lookupStatus !== 'idle' && (
                  <p className="text-xs text-gray-500 mt-2">
                    {lookupStatus === 'loading' && 'Looking up details...'}
                    {lookupStatus === 'found' && 'Details found'}
                    {lookupStatus === 'not_found' && 'No details found'}
                  </p>
                )}
              </div>

              <div>
                <label className={labelClass}>Full Name *</label>
                <input name="full_name" value={form.full_name} onChange={handleChange} required
                  disabled={lookupStatus === 'loading'}
                  placeholder="Your full name"
                  className={inputClass} />
              </div>

              <div>
                <label className={labelClass}>Email</label>
                <input name="email" type="email" value={form.email} onChange={handleChange}
                  disabled={lookupStatus === 'loading'}
                  placeholder="your@email.com"
                  className={inputClass} />
              </div>

              {existingCustomer && !existingCustomer.birthdate && !birthdaySkipped && (
                <div>
                  <p className="text-xs text-gray-500 mb-2">Welcome back! 🎂 Would you like to share your birthday with us?</p>
                  <div className="flex items-center gap-4">
                    <input type="date" value={birthdayInput} onChange={e => setBirthdayInput(e.target.value)}
                      disabled={lookupStatus === 'loading'}
                      className={inputClass} />
                    <button type="button"
                      onClick={() => { setBirthdaySkipped(true); setBirthdayInput('') }}
                      disabled={lookupStatus === 'loading'}
                      className="text-xs tracking-widest uppercase shrink-0 transition-opacity hover:opacity-70 disabled:opacity-40 disabled:cursor-not-allowed"
                      style={{ color: BRAND }}>
                      Skip
                    </button>
                  </div>
                </div>
              )}

              {existingCustomer === null && (
                <div>
                  <label className={labelClass}>Birthday (optional)</label>
                  <input type="date" value={birthdayInput} onChange={e => setBirthdayInput(e.target.value)}
                    disabled={lookupStatus === 'loading'}
                    className={inputClass} />
                  <p className="text-xs text-gray-400 mt-1">We'd love to celebrate with you 🎂</p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-6">
                <div>
                  <label className={labelClass}>Baby Chairs</label>
                  <input name="baby_chairs" type="number" min="0"
                    value={form.baby_chairs} onChange={handleChange}
                    disabled={lookupStatus === 'loading'}
                    className={inputClass} />
                </div>
                <div className="flex items-end pb-3">
                  <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                    <input name="pets" type="checkbox" checked={form.pets} onChange={handleChange}
                      disabled={lookupStatus === 'loading'}
                      className="w-4 h-4 disabled:opacity-40 disabled:cursor-not-allowed" />
                    I'm bringing a pet 🐾
                  </label>
                </div>
              </div>

              <div>
                <label className={labelClass}>Special Requests</label>
                <textarea name="notes" value={form.notes} onChange={handleChange} rows={3}
                  disabled={lookupStatus === 'loading'}
                  placeholder="Dietary requirements, allergies, celebrations..."
                  className={inputClass + ' resize-none'} />
              </div>

              <button type="submit" disabled={loading || lookupStatus === 'loading'}
                className="w-full py-4 text-sm font-medium tracking-widest uppercase text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                style={{ backgroundColor: BRAND }}>
                {loading ? 'Submitting...' : 'Request Reservation'}
              </button>
            </>
          )}
        </form>
      </div>

        {hasExperiences && (
          <div className="w-full md:w-[35%]">
            <label className={labelClass}>Upcoming Experiences</label>
            <div className="space-y-6 mt-3">
              {experiences.map(exp => (
                <div key={exp.id}
                  onClick={() => navigate(`/experiences/${exp.id}`)}
                  className="cursor-pointer group">
                  <div className="w-full aspect-square rounded-lg bg-gray-100 overflow-hidden mb-2">
                    {exp.poster_url
                      ? <img src={exp.poster_url} alt={exp.name} className="w-full h-full object-cover transition-opacity group-hover:opacity-80" />
                      : <div className="w-full h-full flex items-center justify-center text-gray-300 text-xs">No image</div>}
                  </div>
                  <p className="text-sm font-medium text-gray-900 truncate">{exp.name}</p>
                  <p className="text-xs text-gray-400">{exp.date} · {exp.time?.slice(0, 5)}</p>
                  <p className="text-xs text-gray-400">{exp.price == null ? 'Free' : `RM ${Number(exp.price).toFixed(2)}`}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
