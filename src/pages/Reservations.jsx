import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase'
import { supabaseCustomers, findOrCreateCustomer, isValidPhone } from '../supabaseCustomers'
import { collapseSeries, addDays } from '../lib/experienceSeries'
import { getLocalToday } from '../lib/tableAvailability'
import { getDayType } from '../lib/dayType'
import { isSlotBookable } from '../lib/slotCutoff'
import { pickAvailableGroups, findSlotRow, MAX_ONLINE_PARTY } from '../lib/availabilitySlots'

// operating_hours / slot_rules change rarely: cached per day_type in a Map for the page's lifetime.
// A failed load is dropped from the cache so the next call retries.
function loadDayConfig(dayType, cache) {
  if (!cache.has(dayType)) {
    const load = Promise.all([
      supabase.from('operating_hours').select('*').eq('day_type', dayType).maybeSingle(),
      supabase.from('slot_rules').select('*').eq('day_type', dayType).maybeSingle()
    ]).then(([hoursRes, slotRes]) => {
      if (hoursRes.error) throw hoursRes.error
      if (slotRes.error) throw slotRes.error
      return { hours: hoursRes.data, slotRule: slotRes.data }
    })
    load.catch(() => cache.delete(dayType))
    cache.set(dayType, load)
  }
  return cache.get(dayType)
}

async function getDateInfo(date, configCache) {
  const dateObj = new Date(date)
  const day = dateObj.getDay()
  const dayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][day]

  const day_type = await getDayType(date)

  const [blockedRes, config] = await Promise.all([
    supabase
      .from('blocked_dates')
      .select('*')
      .eq('blocked_date', date)
      .maybeSingle(),
    loadDayConfig(day_type, configCache)
  ])
  if (blockedRes.error) throw blockedRes.error

  const blocked = blockedRes.data
  const { hours, slotRule } = config

  if (blocked?.is_closed) return { closed: true, reason: 'Sorry, reservations are not available on this date.' }
  const max_pax = blocked?.max_pax ?? null

  if (hours?.closed_days?.includes(dayName)) {
    return { closed: true, reason: `Sorry, we are closed on ${dayName}s.` }
  }

  return { closed: false, day_type, dayName, slotRule, operatingHours: hours, max_pax }
}

async function fetchAvailability(date, guestCount) {
  const { data, error } = await supabase.rpc('get_availability', { p_date: date, p_guest_count: guestCount })
  if (error) throw error
  return data || []
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

const BRAND = 'var(--color-accent)'
const CREAM = 'var(--color-bg)'

// Guests can book at most this many days ahead (public form only).
const MAX_ADVANCE_DAYS = 60

function normalisePhone(raw) {
  let p = raw.replace(/[\s\-\(\)]/g, '')
  if (p.startsWith('+')) p = p.slice(1)
  if (p.startsWith('0')) p = '60' + p.slice(1)
  return p
}

const inputClass = "w-full border-b border-[var(--color-border)] bg-transparent py-3 text-sm text-[var(--color-text)] focus:outline-none focus:border-[var(--color-accent)] transition-colors placeholder-[var(--color-text-muted)] disabled:opacity-40 disabled:cursor-not-allowed"
const labelClass = "block text-xs tracking-widest uppercase mb-1 text-[var(--color-text-2)]"

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
  const configCacheRef = useRef(new Map())
  const submitLockRef = useRef(false)
  const searchSeqRef = useRef(0)

  useEffect(() => {
    async function fetchExperiences() {
      const today = getLocalToday()
      const { data } = await supabase
        .from('experiences')
        .select('*')
        .eq('status', 'published')
        .gte('date', today)
        .order('date', { ascending: true })
      setExperiences(collapseSeries(data || []))
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
    const seq = ++searchSeqRef.current
    setSearchLoading(false) // a newer search supersedes any in-flight one, including when it returns early below
    const date = dateArg ?? form.reservation_date
    const guestsRaw = guestsArg ?? form.guest_count
    setSelectedSlot(null)
    setAvailableGroups([])
    setSearchError(null)
    if (!date || !guestsRaw) return
    if (date < getLocalToday()) {
      setSearchError('That date has already passed.')
      setHasSearched(true)
      return
    }
    if (date > addDays(getLocalToday(), MAX_ADVANCE_DAYS)) {
      setSearchError(`Reservations can be made up to ${MAX_ADVANCE_DAYS} days in advance.`)
      setHasSearched(true)
      return
    }

    const guestCount = parseInt(guestsRaw, 10)
    if (!(guestCount >= 1)) {
      setSearchError('Please enter at least 1 guest.')
      setHasSearched(true)
      return
    }
    if (guestCount > MAX_ONLINE_PARTY) {
      setSearchError('Party size too large — please contact us directly.')
      setHasSearched(true)
      return
    }

    try {
      setSearchLoading(true)
      const [info, rows] = await Promise.all([
        getDateInfo(date, configCacheRef.current),
        fetchAvailability(date, guestCount)
      ])
      if (seq !== searchSeqRef.current) return
      if (info.closed) {
        setSearchError(info.reason)
        setHasSearched(true)
        return
      }

      if (info.max_pax && guestCount > info.max_pax) {
        setSearchError(`Sorry, we can only accommodate up to ${info.max_pax} guests on this date.`)
        setHasSearched(true)
        return
      }

      const slotGroups = getTimeSlotGroups(info)
      const resultGroups = pickAvailableGroups(slotGroups, rows, date, isSlotBookable)

      setSearchDurationMinutes(info.slotRule?.hold_duration_minutes ?? 120)
      setAvailableGroups(resultGroups)
      setHasSearched(true)
    } catch {
      if (seq !== searchSeqRef.current) return
      setSearchError('Something went wrong. Please try again.')
      setHasSearched(true)
    } finally {
      if (seq === searchSeqRef.current) setSearchLoading(false)
    }
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
    if (submitLockRef.current) return
    submitLockRef.current = true
    setLoading(true)
    setError(null)

    try {
      if (!isValidPhone(normalisePhone(form.phone))) {
        setError('Please enter a valid phone number.'); return
      }

      const info = await getDateInfo(form.reservation_date, configCacheRef.current)
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

      const rows = await fetchAvailability(form.reservation_date, parseInt(form.guest_count, 10))
      const slotRow = findSlotRow(rows, form.reservation_time)
      if (!slotRow || !isSlotBookable(form.reservation_time, form.reservation_date)) {
        setError("Sorry, we don't have enough tables for this time slot. Please choose a different time."); return
      }

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
          p_day_type: slotRow.day_type,
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
      const { data: msgData } = await supabase.from('settings').select('value').eq('key', 'confirmation_message_reservation').maybeSingle()
      if (msgData?.value) setConfirmationMessage(msgData.value)
      setSubmitted(true)
    } catch (err) {
      setError('Something went wrong. Please try again.')
      console.error(err)
    } finally {
      submitLockRef.current = false
      setLoading(false)
    }
  }
  if (submitted && bookingId) {
    const manageUrl = `${window.location.origin}/booking/${bookingId}`
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-8"
        style={{ backgroundColor: CREAM, fontFamily: 'var(--font-body)' }}>
        <div className="text-center max-w-md">
          <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6"
            style={{ backgroundColor: '#16a34a' }}>
            <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-2xl mb-3" style={{ color: BRAND, fontFamily: 'var(--font-heading)', fontWeight: 'var(--font-weight-heading)', fontStyle: 'var(--font-heading-style)' }}>Request Received</h2>
          {confirmedBooking && (
            <p className="text-sm font-medium text-[var(--color-text-2)] mb-2">
              {formatTimeRange(confirmedBooking.time, confirmedBooking.durationMinutes)}
            </p>
          )}
          <p className="text-[var(--color-text-2)] text-sm leading-relaxed mb-6">{confirmationMessage}</p>
          <div className="border border-[var(--color-border)] rounded-xl p-4 mb-8 text-left"
            style={{ backgroundColor: 'var(--color-surface)' }}>
            <p className="text-xs tracking-widest uppercase text-[var(--color-text-muted)] mb-2">Manage your booking</p>
            <p className="text-xs text-[var(--color-text-2)] mb-3">Save this link to view or cancel your reservation:</p>
            <div className="flex items-center gap-2">
              <p className="text-xs text-[var(--color-text-2)] break-all flex-1">{manageUrl}</p>
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
    <div className="min-h-screen" style={{ backgroundColor: CREAM, fontFamily: 'var(--font-body)' }}>
      <div className={`max-w-[900px] mx-auto px-8 py-16 flex flex-col gap-12 ${hasExperiences ? 'md:flex-row md:items-start' : ''}`}>
      <div className={hasExperiences ? 'w-full md:w-[65%]' : 'w-full max-w-lg mx-auto'}>

        <p className="text-xs tracking-widest uppercase mb-2" style={{ color: BRAND }}>
          Tonda Pizza Romana
        </p>
        <h1 className="text-3xl mb-2" style={{ color: 'var(--color-text)', fontFamily: 'var(--font-heading)', fontWeight: 'var(--font-weight-heading)', fontStyle: 'var(--font-heading-style)' }}>Make a Reservation</h1>
        <p className="text-[var(--color-text-muted)] text-sm mb-12">Search for a time, then fill in your details to request a booking.</p>

        <form onSubmit={handleSubmit} className="space-y-8">

          <div className="border border-[var(--color-border)] rounded-xl p-4" style={{ backgroundColor: 'var(--color-surface)' }}>
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
                  min={getLocalToday()}
                  max={addDays(getLocalToday(), MAX_ADVANCE_DAYS)}
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
            <div className="border border-[var(--color-border)] rounded-lg p-6 text-center">
              <p className="text-sm text-[var(--color-text-2)]">No availability for this date. Please try a different date or guest count.</p>
            </div>
          )}

          {hasSearched && !searchLoading && !searchError && availableGroups.length > 0 && (
            <div>
              <label className={labelClass}>Available Times</label>
              <div className="mt-2 space-y-4">
                {availableGroups.map((group, i) => (
                  <div key={group.sessionLabel || i}>
                    {group.sessionLabel && (
                      <p className="text-xs text-[var(--color-text-muted)] mb-2">{group.sessionLabel}</p>
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
                              : { backgroundColor: 'var(--color-surface)', color: 'var(--color-text-2)', borderColor: 'var(--color-border)' }}>
                            {slot.label}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-xs text-[var(--color-text-muted)] mt-4">
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
                  <p className="text-xs text-[var(--color-text-2)] mt-2">
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
                  <p className="text-xs text-[var(--color-text-2)] mb-2">Welcome back! 🎂 Would you like to share your birthday with us?</p>
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
                  <p className="text-xs text-[var(--color-text-muted)] mt-1">We'd love to celebrate with you 🎂</p>
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
                  <label className="flex items-center gap-2 text-sm text-[var(--color-text-2)] cursor-pointer">
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

              {error && (
                <div className="border-l-2 pl-4 py-2" style={{ borderColor: BRAND }}>
                  <p className="text-sm text-[var(--color-text-2)]">{error}</p>
                </div>
              )}

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
                  <div className="w-full aspect-square rounded-lg bg-[var(--color-surface-2)] overflow-hidden mb-2">
                    {exp.poster_url
                      ? <img src={exp.poster_url} alt={exp.name} className="w-full h-full object-cover transition-opacity group-hover:opacity-80" />
                      : <div className="w-full h-full flex items-center justify-center text-[var(--color-text-muted)] text-xs">No image</div>}
                  </div>
                  <p className="text-sm font-medium text-[var(--color-text)] truncate">{exp.name}</p>
                  <p className="text-xs text-[var(--color-text-muted)]">{exp.upcomingCount > 1 ? 'Next: ' : ''}{exp.date} · {exp.time?.slice(0, 5)}</p>
                  {exp.upcomingCount > 1 && (
                    <p className="text-xs text-[var(--color-text-muted)]">+{exp.upcomingCount - 1} more {exp.upcomingCount - 1 === 1 ? 'date' : 'dates'}</p>
                  )}
                  <p className="text-xs text-[var(--color-text-muted)]">{exp.price == null ? 'Free' : `RM ${Number(exp.price).toFixed(2)}`}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
