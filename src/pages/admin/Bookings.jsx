import { useEffect, useState } from 'react'
import { supabase } from '../../supabase'

const BRAND = '#E8420A'

const statusColors = {
  pending: 'bg-yellow-100 text-yellow-800',
  confirmed: 'bg-blue-100 text-blue-800',
  seated: 'bg-green-100 text-green-800',
  completed: 'bg-gray-100 text-gray-800',
  cancelled: 'bg-red-100 text-red-800',
  no_show: 'bg-orange-100 text-orange-800'
}

export default function Bookings() {
  const [reservations, setReservations] = useState([])
  const [events, setEvents] = useState([])
  const [offsite, setOffsite] = useState([])
  const [tables, setTables] = useState([])
  const [tab, setTab] = useState('upcoming')
  const [loading, setLoading] = useState(true)
  const [filterDate, setFilterDate] = useState('')
  const [filterStatus, setFilterStatus] = useState('')

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    setLoading(true)
    const [r, e, o, t] = await Promise.all([
      supabase.from('reservations').select('*, customers(full_name, phone, email)').order('reservation_date', { ascending: true }).order('reservation_time', { ascending: true }),
      supabase.from('events').select('*, customers(full_name, phone, email)').order('event_date', { ascending: true }),
      supabase.from('offsite_bookings').select('*, customers(full_name, phone, email)').order('event_date', { ascending: true }),
      supabase.from('restaurant_tables').select('id, table_number')
    ])
    setReservations(r.data || [])
    setEvents(e.data || [])
    setOffsite(o.data || [])
    setTables(t.data || [])
    setLoading(false)
  }

  async function updateStatus(table, id, status) {
    await supabase.from(table).update({ status }).eq('id', id)

    // When reservation is completed, release locks and unmerge any merged tables
    if (table === 'reservations' && status === 'completed') {
      const reservation = reservations.find(r => r.id === id)
      if (reservation && Array.isArray(reservation.table_ids) && reservation.table_ids.length > 0) {
        // Release locks on all assigned tables
        await supabase
          .from('restaurant_tables')
          .update({ locked_until: null, locked_by_reservation: null })
          .in('id', reservation.table_ids)

        // Find any table groups that contain these tables and unmerge them
        const { data: groupedTables } = await supabase
          .from('restaurant_tables')
          .select('id, group_id')
          .in('id', reservation.table_ids)
          .not('group_id', 'is', null)

        if (groupedTables && groupedTables.length > 0) {
          const groupIds = [...new Set(groupedTables.map(t => t.group_id))]
          // Clear group_id from all tables in these groups
          await supabase
            .from('restaurant_tables')
            .update({ group_id: null })
            .in('group_id', groupIds)
          // Delete the group records
          await supabase
            .from('table_groups')
            .delete()
            .in('id', groupIds)
        }
      }
    }

    fetchAll()
  }

  function getTableNumbers(tableIds) {
    if (!tableIds || !Array.isArray(tableIds) || tableIds.length === 0) return ''
    return tableIds
      .map(id => tables.find(t => t.id === id)?.table_number)
      .filter(Boolean)
      .join(', ')
  }

  const today = new Date().toISOString().split('T')[0]

  const upcomingRes     = reservations.filter(r => r.reservation_date >= today && r.status !== 'cancelled')
  const pastRes         = reservations.filter(r => r.reservation_date < today || r.status === 'cancelled')
  const upcomingEvents  = events.filter(e => e.event_date >= today && e.status !== 'cancelled')
  const pastEvents      = events.filter(e => e.event_date < today || e.status === 'cancelled')
  const upcomingOffsite = offsite.filter(o => o.event_date >= today && o.status !== 'cancelled')
  const pastOffsite     = offsite.filter(o => o.event_date < today || o.status === 'cancelled')
  const activeEvents    = events.filter(e => e.status !== 'cancelled')
  const activeOffsite   = offsite.filter(o => o.status !== 'cancelled')

  function applyFilters(items, dateField) {
    return items.filter(item =>
      (!filterDate || item[dateField] === filterDate) &&
      (!filterStatus || item.status === filterStatus)
    )
  }

  const tabs = [
    { key: 'upcoming', label: `Upcoming (${upcomingRes.length + upcomingEvents.length + upcomingOffsite.length})` },
    { key: 'past',     label: `Past (${pastRes.length + pastEvents.length + pastOffsite.length})` },
    { key: 'events',   label: `Events (${activeEvents.length})` },
    { key: 'offsite',  label: `Off-Site (${activeOffsite.length})` },
  ]

  function EmptyState({ message = 'No bookings found.' }) {
    return <p className="text-gray-400 text-sm text-center py-10">{message}</p>
  }

  function StatusBadge({ status }) {
    return (
      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColors[status]}`}>
        {status}
      </span>
    )
  }

  function ActionButtons({ table, id }) {
    const actions = table === 'offsite_bookings'
      ? [
          { label: 'Confirm', status: 'confirmed', color: 'text-blue-600 hover:text-blue-800' },
          { label: 'Completed', status: 'completed', color: 'text-gray-500 hover:text-gray-700' },
          { label: 'Cancel', status: 'cancelled', color: 'text-red-400 hover:text-red-600' },
        ]
      : [
          { label: 'Confirm', status: 'confirmed', color: 'text-blue-600 hover:text-blue-800' },
          { label: 'Seated', status: 'seated', color: 'text-green-600 hover:text-green-800' },
          { label: 'Completed', status: 'completed', color: 'text-gray-500 hover:text-gray-700' },
          { label: 'No Show', status: 'no_show', color: 'text-orange-500 hover:text-orange-700' },
          { label: 'Cancel', status: 'cancelled', color: 'text-red-400 hover:text-red-600' },
        ]

    return (
      <div className="flex gap-4 flex-wrap mt-2">
        {actions.map(a => (
          <button key={a.status}
            onClick={() => updateStatus(table, id, a.status)}
            className={`text-xs font-medium tracking-wide transition-colors ${a.color}`}>
            {a.label}
          </button>
        ))}
      </div>
    )
  }

  // Reservation list row
  function ReservationRow({ r }) {
    const [expanded, setExpanded] = useState(false)
    const tableNums = getTableNumbers(r.table_ids)

    return (
      <div className="border-b border-gray-100">
        <div
          className="flex items-center gap-4 py-3 cursor-pointer hover:bg-gray-50 px-2 -mx-2 rounded transition-colors"
          onClick={() => setExpanded(!expanded)}>
          {/* Time */}
          <div className="w-16 text-xs text-gray-400 font-medium shrink-0">
            {r.reservation_time?.slice(0, 5)}
          </div>
          {/* Name + phone */}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate">{r.customers?.full_name}</p>
            <p className="text-xs text-gray-400">{r.customers?.phone}</p>
          </div>
          {/* Guests */}
          <div className="text-xs text-gray-500 shrink-0">
            👥 {r.guest_count}
          </div>
          {/* Table */}
          <div className="w-16 text-xs text-gray-500 shrink-0 text-right">
            {tableNums || ''}
          </div>
          {/* Status */}
          <div className="shrink-0">
            <StatusBadge status={r.status} />
          </div>
        </div>

        {/* Expanded details */}
        {expanded && (
          <div className="px-2 pb-3 bg-gray-50 rounded -mx-2">
            <p className="text-xs text-gray-500 mb-1">📅 {r.reservation_date} at {r.reservation_time}</p>
            {r.customers?.email && <p className="text-xs text-gray-500 mb-1">✉️ {r.customers.email}</p>}
            {r.notes && <p className="text-xs text-gray-500 mb-1">📝 {r.notes}</p>}
            {tableNums && <p className="text-xs text-gray-500 mb-2">🪑 {tableNums}</p>}
            <ActionButtons table="reservations" id={r.id} />
          </div>
        )}
      </div>
    )
  }

  // Event list row
  function EventRow({ e }) {
    const [expanded, setExpanded] = useState(false)

    return (
      <div className="border-b border-gray-100">
        <div
          className="flex items-center gap-4 py-3 cursor-pointer hover:bg-gray-50 px-2 -mx-2 rounded transition-colors"
          onClick={() => setExpanded(!expanded)}>
          <div className="w-16 text-xs text-gray-400 font-medium shrink-0">
            {e.event_time?.slice(0, 5)}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate">{e.customers?.full_name}</p>
            <p className="text-xs text-gray-400">{e.customers?.phone}</p>
          </div>
          <div className="text-xs text-gray-500 shrink-0">👥 {e.guest_count}</div>
          <div className="w-16 text-xs text-gray-500 shrink-0 text-right capitalize">{e.event_type}</div>
          <div className="shrink-0"><StatusBadge status={e.status} /></div>
        </div>
        {expanded && (
          <div className="px-2 pb-3 bg-gray-50 rounded -mx-2">
            <p className="text-xs text-gray-500 mb-1">📅 {e.event_date} at {e.event_time}</p>
            {e.customers?.email && <p className="text-xs text-gray-500 mb-1">✉️ {e.customers.email}</p>}
            {e.budget_range && <p className="text-xs text-gray-500 mb-1">💰 {e.budget_range}</p>}
            {e.special_requests && <p className="text-xs text-gray-500 mb-1">📝 {e.special_requests}</p>}
            <p className="text-xs text-gray-500 mb-2">📞 {e.preferred_contact} · {e.best_time_to_reach}</p>
            <ActionButtons table="events" id={e.id} />
          </div>
        )}
      </div>
    )
  }

  // Offsite list row
  function OffsiteRow({ o }) {
    const [expanded, setExpanded] = useState(false)

    return (
      <div className="border-b border-gray-100">
        <div
          className="flex items-center gap-4 py-3 cursor-pointer hover:bg-gray-50 px-2 -mx-2 rounded transition-colors"
          onClick={() => setExpanded(!expanded)}>
          <div className="w-16 text-xs text-gray-400 font-medium shrink-0">
            {o.event_time?.slice(0, 5)}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate">{o.customers?.full_name}</p>
            <p className="text-xs text-gray-400">{o.customers?.phone}</p>
          </div>
          <div className="text-xs text-gray-500 shrink-0">👥 {o.guest_count}</div>
          <div className="w-16 text-xs text-gray-500 shrink-0 text-right capitalize">{o.event_type}</div>
          <div className="shrink-0"><StatusBadge status={o.status} /></div>
        </div>
        {expanded && (
          <div className="px-2 pb-3 bg-gray-50 rounded -mx-2">
            <p className="text-xs text-gray-500 mb-1">📅 {o.event_date} at {o.event_time}</p>
            {o.customers?.email && <p className="text-xs text-gray-500 mb-1">✉️ {o.customers.email}</p>}
            <p className="text-xs text-gray-500 mb-1">📍 {o.venue_address}</p>
            {o.special_requests && <p className="text-xs text-gray-500 mb-1">📝 {o.special_requests}</p>}
            <ActionButtons table="offsite_bookings" id={o.id} />
          </div>
        )}
      </div>
    )
  }

  // Column headers
  function ListHeader({ showTable = true }) {
    return (
      <div className="flex items-center gap-4 py-2 border-b border-gray-200 mb-1">
        <div className="w-16 text-xs tracking-widest uppercase text-gray-400">Time</div>
        <div className="flex-1 text-xs tracking-widest uppercase text-gray-400">Guest</div>
        <div className="text-xs tracking-widest uppercase text-gray-400 shrink-0">Pax</div>
        <div className="w-16 text-xs tracking-widest uppercase text-gray-400 text-right shrink-0">
          {showTable ? 'Table' : 'Type'}
        </div>
        <div className="text-xs tracking-widest uppercase text-gray-400 shrink-0">Status</div>
      </div>
    )
  }

  function TabContent() {
    if (tab === 'upcoming') {
      const res  = applyFilters(upcomingRes, 'reservation_date')
      const evts = applyFilters(upcomingEvents, 'event_date')
      const off  = applyFilters(upcomingOffsite, 'event_date')
      if (res.length + evts.length + off.length === 0) return <EmptyState message="No upcoming bookings." />
      return (
        <>
          <ListHeader showTable={true} />
          {res.map(r  => <ReservationRow key={r.id} r={r} />)}
          {evts.map(e => <EventRow key={e.id} e={e} />)}
          {off.map(o  => <OffsiteRow key={o.id} o={o} />)}
        </>
      )
    }
    if (tab === 'past') {
      const res  = applyFilters(pastRes, 'reservation_date')
      const evts = applyFilters(pastEvents, 'event_date')
      const off  = applyFilters(pastOffsite, 'event_date')
      if (res.length + evts.length + off.length === 0) return <EmptyState message="No past bookings." />
      return (
        <>
          <ListHeader showTable={true} />
          {res.map(r  => <ReservationRow key={r.id} r={r} />)}
          {evts.map(e => <EventRow key={e.id} e={e} />)}
          {off.map(o  => <OffsiteRow key={o.id} o={o} />)}
        </>
      )
    }
    if (tab === 'events') {
      const evts = applyFilters(activeEvents, 'event_date')
      if (evts.length === 0) return <EmptyState message="No events found." />
      return (
        <>
          <ListHeader showTable={false} />
          {evts.map(e => <EventRow key={e.id} e={e} />)}
        </>
      )
    }
    if (tab === 'offsite') {
      const off = applyFilters(activeOffsite, 'event_date')
      if (off.length === 0) return <EmptyState message="No off-site bookings found." />
      return (
        <>
          <ListHeader showTable={false} />
          {off.map(o => <OffsiteRow key={o.id} o={o} />)}
        </>
      )
    }
    return null
  }

  return (
    <div className="min-h-screen bg-white p-8 max-w-3xl mx-auto">
      <p className="text-xs tracking-widest uppercase mb-1" style={{ color: BRAND }}>Admin</p>
      <h1 className="text-3xl font-light text-gray-900 mb-6">Manage Bookings</h1>

      {/* Filters */}
      <div className="flex gap-4 mb-6 flex-wrap items-end">
        <div>
          <label className="block text-xs tracking-widest uppercase text-gray-400 mb-1">Date</label>
          <input type="date" value={filterDate} onChange={e => setFilterDate(e.target.value)}
            className="border-b border-gray-200 bg-transparent py-2 text-sm text-gray-800 focus:outline-none focus:border-gray-800 transition-colors" />
        </div>
        <div>
          <label className="block text-xs tracking-widest uppercase text-gray-400 mb-1">Status</label>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
            className="border-b border-gray-200 bg-transparent py-2 text-sm text-gray-800 focus:outline-none focus:border-gray-800 transition-colors">
            <option value="">All statuses</option>
            <option value="pending">Pending</option>
            <option value="confirmed">Confirmed</option>
            <option value="seated">Seated</option>
            <option value="completed">Completed</option>
            <option value="no_show">No Show</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
        {(filterDate || filterStatus) && (
          <button onClick={() => { setFilterDate(''); setFilterStatus('') }}
            className="text-xs tracking-widest uppercase text-gray-400 hover:text-gray-700 transition-colors pb-2">
            Clear
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-6 mb-6 border-b border-gray-100">
        {tabs.map(({ key, label }) => (
          <button key={key} onClick={() => setTab(key)}
            className={`pb-3 text-sm font-medium transition-colors ${
              tab === key ? 'border-b-2 -mb-px' : 'text-gray-400 hover:text-gray-600'
            }`}
            style={tab === key ? { borderColor: BRAND, color: BRAND } : {}}>
            {label}
          </button>
        ))}
      </div>

      {loading ? <p className="text-gray-400 text-sm">Loading...</p> : <TabContent />}
    </div>
  )
}