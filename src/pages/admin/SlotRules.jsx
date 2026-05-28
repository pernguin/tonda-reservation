import { useState, useEffect } from 'react'
import { supabase } from '../../supabase'

const BRAND = '#E8420A'
const DAYS_OF_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']

const DEFAULT_CONFIG = [
  {
    day_type: 'weekday',
    label: 'Weekday (Sun–Thu)',
    rule_type: 'open',
    closed_days: [],
    sessions: [
      { label: 'All Day', start: '12:00', end: '22:00', last_booking: '21:00' }
    ]
  },
  {
    day_type: 'weekend',
    label: 'Weekend (Fri–Sat)',
    rule_type: 'open',
    closed_days: [],
    sessions: [
      { label: 'All Day', start: '12:00', end: '00:00', last_booking: '23:00' }
    ]
  },
  {
    day_type: 'public_holiday',
    label: 'Public Holiday',
    rule_type: 'open',
    closed_days: [],
    sessions: [
      { label: 'All Day', start: '12:00', end: '22:00', last_booking: '21:00' }
    ]
  }
]

export default function SlotRules() {
  const [config, setConfig] = useState(DEFAULT_CONFIG)
  const [blockedDates, setBlockedDates] = useState([])
  const [newDate, setNewDate] = useState('')
  const [newReason, setNewReason] = useState('')
  const [newMaxPax, setNewMaxPax] = useState('')
  const [isClosed, setIsClosed] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saved, setSaved] = useState(false)

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    const [{ data: slotData }, { data: hoursData }, { data: datesData }] = await Promise.all([
      supabase.from('slot_rules').select('*'),
      supabase.from('operating_hours').select('*'),
      supabase.from('blocked_dates').select('*').order('blocked_date', { ascending: true })
    ])
    setBlockedDates(datesData || [])
    const merged = DEFAULT_CONFIG.map(def => {
      const slot = (slotData || []).find(s => s.day_type === def.day_type)
      const hours = (hoursData || []).find(h => h.day_type === def.day_type)
      return {
        day_type: def.day_type, label: def.label,
        rule_type: slot?.rule_type || def.rule_type,
        closed_days: hours?.closed_days || def.closed_days,
        sessions: slot?.sessions?.length > 0 ? slot.sessions
          : hours?.sessions?.length > 0 ? hours.sessions
          : def.sessions
      }
    })
    setConfig(merged)
    setLoading(false)
  }

  async function saveAll() {
    for (const c of config) {
      const { data: existingSlot } = await supabase.from('slot_rules').select('id').eq('day_type', c.day_type).maybeSingle()
      if (existingSlot) {
        await supabase.from('slot_rules').update({ rule_type: c.rule_type, sessions: c.rule_type === 'session' ? c.sessions : [] }).eq('day_type', c.day_type)
      } else {
        await supabase.from('slot_rules').insert({ day_type: c.day_type, rule_type: c.rule_type, sessions: c.rule_type === 'session' ? c.sessions : [] })
      }
      const { data: existingHours } = await supabase.from('operating_hours').select('id').eq('day_type', c.day_type).maybeSingle()
      if (existingHours) {
        await supabase.from('operating_hours').update({ is_closed: false, closed_days: c.closed_days, sessions: c.sessions }).eq('day_type', c.day_type)
      } else {
        await supabase.from('operating_hours').insert({ day_type: c.day_type, is_closed: false, closed_days: c.closed_days, sessions: c.sessions })
      }
    }
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  function updateRuleType(day_type, rule_type) {
    setConfig(prev => prev.map(c => c.day_type === day_type ? { ...c, rule_type } : c))
  }

  function toggleClosedDay(day_type, day) {
    setConfig(prev => prev.map(c => {
      if (c.day_type !== day_type) return c
      const closed_days = c.closed_days.includes(day)
        ? c.closed_days.filter(d => d !== day)
        : [...c.closed_days, day]
      return { ...c, closed_days }
    }))
  }

  function updateSession(day_type, index, field, value) {
    setConfig(prev => prev.map(c => {
      if (c.day_type !== day_type) return c
      const sessions = [...c.sessions]
      sessions[index] = { ...sessions[index], [field]: value }
      return { ...c, sessions }
    }))
  }

  function addSession(day_type) {
    setConfig(prev => prev.map(c =>
      c.day_type === day_type
        ? { ...c, sessions: [...c.sessions, { label: '', start: '18:00', end: '20:00', last_booking: '' }] }
        : c
    ))
  }

  function removeSession(day_type, index) {
    setConfig(prev => prev.map(c =>
      c.day_type === day_type
        ? { ...c, sessions: c.sessions.filter((_, i) => i !== index) }
        : c
    ))
  }

  async function addDateControl() {
    if (!newDate) return
    await supabase.from('blocked_dates').insert({
      blocked_date: newDate,
      reason: newReason || null,
      max_pax: isClosed ? null : (newMaxPax ? parseInt(newMaxPax) : null),
      is_closed: isClosed,
      date_type: isClosed ? 'closed' : 'custom'
    })
    setNewDate(''); setNewReason(''); setNewMaxPax(''); setIsClosed(false)
    fetchAll()
  }

  async function removeDateControl(id) {
    await supabase.from('blocked_dates').delete().eq('id', id)
    fetchAll()
  }

  const inputClass = "border-b border-gray-200 bg-transparent py-2 text-sm text-gray-800 focus:outline-none focus:border-gray-800 transition-colors"
  const labelClass = "block text-xs tracking-widest uppercase mb-1 text-gray-400"

  if (loading) return <div className="p-8 text-gray-400 text-sm">Loading...</div>

  return (
    <div className="min-h-screen bg-white p-8 max-w-2xl mx-auto">

      {/* Header */}
      <div className="flex justify-between items-start mb-10">
        <div>
          <p className="text-xs tracking-widest uppercase mb-1" style={{ color: BRAND }}>Admin</p>
          <h1 className="text-3xl font-light text-gray-900">Reservation Config</h1>
          <p className="text-gray-400 text-sm mt-1">Manage booking rules, sessions and date controls</p>
        </div>
        <button onClick={saveAll}
          className="px-8 py-3 text-sm font-medium tracking-widest uppercase text-white transition-opacity hover:opacity-90"
          style={{ backgroundColor: saved ? '#16a34a' : BRAND }}>
          {saved ? '✓ Saved' : 'Save All'}
        </button>
      </div>

      {/* Day Type Cards */}
      {config.map(c => (
        <div key={c.day_type} className="border-b border-gray-100 pb-8 mb-8">
          <h2 className="text-lg font-medium text-gray-900 mb-5">{c.label}</h2>

          {/* Closed Days */}
          {c.day_type === 'weekday' && (
            <div className="mb-5">
              <p className={labelClass}>Closed on</p>
              <div className="flex flex-wrap gap-2 mt-2">
                {DAYS_OF_WEEK.map(day => (
                  <button key={day} onClick={() => toggleClosedDay(c.day_type, day)}
                    className="px-3 py-1.5 text-xs font-medium tracking-wide transition-colors rounded"
                    style={c.closed_days?.includes(day)
                      ? { backgroundColor: BRAND, color: 'white' }
                      : { backgroundColor: '#f3f4f6', color: '#6b7280' }}>
                    {day}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Booking Type */}
          <div className="mb-5">
            <p className={labelClass}>Booking Type</p>
            <div className="flex gap-2 mt-2">
              {['open', 'session'].map(type => (
                <button key={type} onClick={() => updateRuleType(c.day_type, type)}
                  className="px-4 py-2 text-xs font-medium tracking-widest uppercase transition-colors rounded"
                  style={c.rule_type === type
                    ? { backgroundColor: BRAND, color: 'white' }
                    : { backgroundColor: '#f3f4f6', color: '#6b7280' }}>
                  {type === 'open' ? 'Open — any time' : 'Fixed sessions'}
                </button>
              ))}
            </div>
          </div>

          {/* Sessions */}
          <div>
            <p className={labelClass}>{c.rule_type === 'open' ? 'Operating Hours' : 'Session Times'}</p>
            {c.sessions.map((session, i) => (
              <div key={i} className="bg-gray-50 rounded-lg p-4 mb-3 mt-2">
                <div className="flex items-center gap-3 mb-3 flex-wrap">
                  {c.rule_type === 'open' && (
                    <input type="text" value={session.label || ''} placeholder="Session name"
                      onChange={e => updateSession(c.day_type, i, 'label', e.target.value)}
                      className={inputClass + ' w-28'} />
                  )}
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-400">Opens</span>
                    <input type="time" value={session.start}
                      onChange={e => updateSession(c.day_type, i, 'start', e.target.value)}
                      className={inputClass} />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-400">Closes</span>
                    <input type="time" value={session.end}
                      onChange={e => updateSession(c.day_type, i, 'end', e.target.value)}
                      className={inputClass} />
                  </div>
                  <button onClick={() => removeSession(c.day_type, i)}
                    className="text-xs text-red-400 hover:text-red-600 ml-auto transition-colors">
                    Remove
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400">Last booking</span>
                  <input type="time" value={session.last_booking || ''}
                    onChange={e => updateSession(c.day_type, i, 'last_booking', e.target.value)}
                    className={inputClass} />
                </div>
              </div>
            ))}
            <button onClick={() => addSession(c.day_type)}
              className="text-xs tracking-widest uppercase mt-2 transition-colors"
              style={{ color: BRAND }}>
              + Add Session
            </button>
          </div>
        </div>
      ))}

      {/* Date Controls */}
      <div>
        <h2 className="text-lg font-medium text-gray-900 mb-5">Date Controls</h2>
        <p className="text-sm text-gray-400 mb-6">Block a specific date or set a maximum guest limit.</p>

        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className={labelClass}>Date *</label>
            <input type="date" value={newDate} onChange={e => setNewDate(e.target.value)}
              className={inputClass + ' w-full'} />
          </div>
          <div>
            <label className={labelClass}>Reason (optional)</label>
            <input type="text" value={newReason} onChange={e => setNewReason(e.target.value)}
              placeholder="e.g. Private event"
              className={inputClass + ' w-full'} />
          </div>
        </div>

        <div className="mb-4">
          <label className={labelClass}>Type</label>
          <select value={isClosed ? 'closed' : 'custom'}
            onChange={e => setIsClosed(e.target.value === 'closed')}
            className={inputClass + ' w-full'}>
            <option value="custom">Custom pax limit</option>
            <option value="closed">Close reservations entirely</option>
          </select>
        </div>

        {!isClosed && (
          <div className="mb-4">
            <label className={labelClass}>Max Guests (leave empty for no limit)</label>
            <input type="number" value={newMaxPax} onChange={e => setNewMaxPax(e.target.value)}
              placeholder="e.g. 20" className={inputClass + ' w-32'} />
          </div>
        )}

        <button onClick={addDateControl}
          className="px-6 py-2.5 text-xs font-medium tracking-widest uppercase text-white transition-opacity hover:opacity-90 mb-6"
          style={{ backgroundColor: BRAND }}>
          Add Date Control
        </button>

        {blockedDates.length > 0 && (
          <div className="border-t border-gray-100">
            {blockedDates.map(d => (
              <div key={d.id} className="flex items-center justify-between py-4 border-b border-gray-100">
                <div>
                  <p className="text-sm font-medium text-gray-800">{d.blocked_date}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {d.is_closed ? '🔴 Closed' : d.max_pax ? `⚠️ Max ${d.max_pax} guests` : ''}
                    {d.reason ? ` — ${d.reason}` : ''}
                  </p>
                </div>
                <button onClick={() => removeDateControl(d.id)}
                  className="text-xs text-red-400 hover:text-red-600 tracking-widest uppercase transition-colors">
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}