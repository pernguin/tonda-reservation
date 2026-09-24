import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../supabase'
import { supabaseCustomers } from '../../supabaseCustomers'
import { logVisitFromReservation } from '../../lib/customerVisits'
import { getLocalToday } from '../../lib/tableAvailability'
import { useUrlStateBatch } from '../../lib/useUrlState'
import { useToast } from '../../lib/useToast'
import AdminPage from '../../components/admin/AdminPage'
import TabBar from '../../components/admin/TabBar'
import FilterBar, { FilterField, FILTER_INPUT_CLASS } from '../../components/admin/FilterBar'
import StatusBadge from '../../components/admin/StatusBadge'
import { Loading, EmptyState } from '../../components/admin/States'
import AmountPrompt from '../../components/admin/AmountPrompt'
import EditReservationForm from '../../components/admin/EditReservationForm'
import GuestPills from '../../components/admin/GuestPills'
import GuestBlock from '../../components/admin/GuestBlock'

const STATUS_LABELS = { cancelled: 'cancelled', no_show: 'a no-show' }

function getTableNumbers(tableIds, tables) {
  if (!tableIds || !Array.isArray(tableIds) || tableIds.length === 0) return ''
  return tableIds
    .map(id => tables.find(t => t.id === id)?.table_number)
    .filter(Boolean)
    .join(', ')
}

function ActionButtons({ table, id, busyId, updateStatus }) {
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
          disabled={busyId === id}
          className={`text-xs font-medium tracking-wide transition-colors disabled:opacity-40 disabled:cursor-wait ${a.color}`}>
          {a.label}
        </button>
      ))}
    </div>
  )
}

// "22 Sep" from a YYYY-MM-DD string, for the list column.
function shortDate(dateStr) {
  if (!dateStr) return ''
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

// Reservation list row
function ReservationRow({ r, tables, busyId, updateStatus, onAmended, today, showToast, onGuestSaved }) {
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing] = useState(false)
  const tableNums = getTableNumbers(r.table_ids, tables)

  return (
    <div className="border-b border-gray-100">
      <div
        className="flex items-center gap-4 py-3 cursor-pointer hover:bg-gray-50 px-2 -mx-2 rounded transition-colors"
        onClick={() => setExpanded(!expanded)}>
        {/* Time */}
        <div className="w-16 text-xs text-gray-400 font-medium shrink-0">
          {r.reservation_time?.slice(0, 5)}
          <p className="text-gray-500 font-normal">{shortDate(r.reservation_date)}</p>
        </div>
        {/* Name + phone */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900 truncate">{r.customers?.full_name}</p>
          <p className="text-xs text-gray-400">{r.customers?.phone}</p>
          <GuestPills customer={r.customers} booking={{ status: r.status, date: r.reservation_date }} today={today} />
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
        <div className="shrink-0 flex items-center gap-1.5">
          {r.needs_manual_assignment && (
            <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-amber-100 text-amber-700" title="Auto-assignment couldn't find a table — assign one manually">
              ⚠️ Needs Table
            </span>
          )}
          <StatusBadge status={r.status} />
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="px-2 pb-3 bg-gray-50 rounded -mx-2">
          <p className="text-xs text-gray-500 mb-1">📅 {r.reservation_date} at {r.reservation_time}</p>
          {r.customers?.email && <p className="text-xs text-gray-500 mb-1">✉️ {r.customers.email}</p>}
          {r.notes && <p className="text-xs text-gray-500 mb-1">📝 {r.notes}</p>}
          {r.baby_chairs > 0 && <p className="text-xs text-gray-500 mb-1">🍼 Baby Chairs: {r.baby_chairs}</p>}
          {r.pets && <p className="text-xs text-gray-500 mb-1">🐾 Pets: Yes</p>}
          {tableNums && <p className="text-xs text-gray-500 mb-2">🪑 {tableNums}</p>}
          {r.needs_manual_assignment && (
            <p className="text-xs text-amber-700 mb-2">⚠️ Auto-assignment couldn't secure a table for this booking — assign one manually below.</p>
          )}
          {editing ? (
            <EditReservationForm r={r} onCancel={() => setEditing(false)}
              onSaved={() => { setEditing(false); onAmended() }} />
          ) : (
            <button type="button" onClick={e => { e.stopPropagation(); setEditing(true) }}
              className="text-xs font-medium tracking-wide text-gray-500 hover:text-gray-800 mb-3 block">
              Edit details
            </button>
          )}
          <GuestBlock customer={r.customers} onSaved={onGuestSaved} showToast={showToast} />
          <ActionButtons table="reservations" id={r.id} busyId={busyId} updateStatus={updateStatus} />
        </div>
      )}
    </div>
  )
}

// Event list row
function EventRow({ e, busyId, updateStatus, today, showToast, onGuestSaved }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="border-b border-gray-100">
      <div
        className="flex items-center gap-4 py-3 cursor-pointer hover:bg-gray-50 px-2 -mx-2 rounded transition-colors"
        onClick={() => setExpanded(!expanded)}>
        <div className="w-16 text-xs text-gray-400 font-medium shrink-0">
          {e.event_time?.slice(0, 5)}
          <p className="text-gray-500 font-normal">{shortDate(e.event_date)}</p>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900 truncate">{e.customers?.full_name}</p>
          <p className="text-xs text-gray-400">{e.customers?.phone}</p>
          <GuestPills customer={e.customers} booking={{ status: e.status, date: e.event_date }} today={today} />
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
          <GuestBlock customer={e.customers} onSaved={onGuestSaved} showToast={showToast} />
          <ActionButtons table="events" id={e.id} busyId={busyId} updateStatus={updateStatus} />
        </div>
      )}
    </div>
  )
}

// Offsite list row
function OffsiteRow({ o, busyId, updateStatus, today, showToast, onGuestSaved }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="border-b border-gray-100">
      <div
        className="flex items-center gap-4 py-3 cursor-pointer hover:bg-gray-50 px-2 -mx-2 rounded transition-colors"
        onClick={() => setExpanded(!expanded)}>
        <div className="w-16 text-xs text-gray-400 font-medium shrink-0">
          {o.event_time?.slice(0, 5)}
          <p className="text-gray-500 font-normal">{shortDate(o.event_date)}</p>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900 truncate">{o.customers?.full_name}</p>
          <p className="text-xs text-gray-400">{o.customers?.phone}</p>
          <GuestPills customer={o.customers} booking={{ status: o.status, date: o.event_date }} today={today} />
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
          <GuestBlock customer={o.customers} onSaved={onGuestSaved} showToast={showToast} />
          <ActionButtons table="offsite_bookings" id={o.id} busyId={busyId} updateStatus={updateStatus} />
        </div>
      )}
    </div>
  )
}

// Column headers
function ListHeader({ showTable = true }) {
  return (
    <div className="flex items-center gap-4 py-2 border-b border-gray-200 mb-1">
      <div className="w-16 text-xs tracking-widest uppercase text-gray-400">When</div>
      <div className="flex-1 text-xs tracking-widest uppercase text-gray-400">Guest</div>
      <div className="text-xs tracking-widest uppercase text-gray-400 shrink-0">Pax</div>
      <div className="w-16 text-xs tracking-widest uppercase text-gray-400 text-right shrink-0">
        {showTable ? 'Table' : 'Type'}
      </div>
      <div className="text-xs tracking-widest uppercase text-gray-400 shrink-0">Status</div>
    </div>
  )
}

export default function Bookings() {
  const [reservations, setReservations] = useState([])
  const [events, setEvents] = useState([])
  const [offsite, setOffsite] = useState([])
  const [tables, setTables] = useState([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState(null)
  const [pendingComplete, setPendingComplete] = useState(null)
  const [showToast, toastNode] = useToast()
  const refetchTimer = useRef(null)

  const [view, setView] = useUrlStateBatch({ tab: 'upcoming', date: '', status: '' })
  const tab = view.tab
  const filterDate = view.date === '' ? getLocalToday() : view.date === 'all' ? '' : view.date
  const filterStatus = view.status

  useEffect(() => {
    fetchAll()
    const channel = supabase
      .channel('admin-bookings-list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reservations' }, () => {
        clearTimeout(refetchTimer.current)
        refetchTimer.current = setTimeout(() => fetchAll({ silent: true }), 500)
      })
      .subscribe()
    return () => {
      clearTimeout(refetchTimer.current)
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function fetchAll({ silent = false } = {}) {
    if (!silent) setLoading(true)
    const [r, e, o, t] = await Promise.all([
      supabase.from('reservations').select('*').order('reservation_date', { ascending: true }).order('reservation_time', { ascending: true }),
      supabase.from('events').select('*').order('event_date', { ascending: true }),
      supabase.from('offsite_bookings').select('*').order('event_date', { ascending: true }),
      supabase.from('restaurant_tables').select('id, table_number')
    ])
    const failed = [r, e, o, t].find(res => res.error)
    if (failed) {
      showToast('Could not load bookings: ' + failed.error.message)
      setLoading(false)
      return
    }

    const reservationsData = r.data || []
    const eventsData = e.data || []
    const offsiteData = o.data || []

    const customerIds = [...new Set(
      [...reservationsData, ...eventsData, ...offsiteData]
        .map(row => row.customer_id)
        .filter(Boolean)
    )]

    let customersById = {}
    if (customerIds.length > 0) {
      const { data: customersData, error: customersError } = await supabaseCustomers
        .from('customers')
        .select('id, full_name, phone, email, visit_count, no_show_count, birthdate, notes, tags')
        .in('id', customerIds)
      if (customersError) {
        showToast('Could not load bookings: ' + customersError.message)
        setLoading(false)
        return
      }
      customersById = Object.fromEntries((customersData || []).map(c => [c.id, c]))
    }

    setReservations(reservationsData.map(row => ({ ...row, customers: customersById[row.customer_id] })))
    setEvents(eventsData.map(row => ({ ...row, customers: customersById[row.customer_id] })))
    setOffsite(offsiteData.map(row => ({ ...row, customers: customersById[row.customer_id] })))
    setTables(t.data || [])
    setLoading(false)
  }

  async function updateStatus(table, id, status, amountSpent) {
    if (table === 'reservations' && status === 'completed' && amountSpent === undefined) { setPendingComplete({ table, id }); return }
    if (STATUS_LABELS[status] && !confirm(`Mark this booking as ${STATUS_LABELS[status]}?`)) return

    setBusyId(id)
    const { error } = await supabase.from(table).update({ status }).eq('id', id)
    if (error) {
      showToast('Could not update status: ' + error.message)
      setBusyId(null)
      return
    }

    const reservation = table === 'reservations' ? reservations.find(r => r.id === id) : null

    if (reservation && (status === 'completed' || status === 'no_show')) {
      await logVisitFromReservation(reservation, status, 'tonda', amountSpent)
    }

    // When reservation is completed, release locks and unmerge any merged tables
    if (table === 'reservations' && status === 'completed') {
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

    await fetchAll({ silent: true })
    setBusyId(null)
  }

  const today = getLocalToday()

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

  const filteredUpcomingRes     = applyFilters(upcomingRes, 'reservation_date')
  const filteredUpcomingEvents  = applyFilters(upcomingEvents, 'event_date')
  const filteredUpcomingOffsite = applyFilters(upcomingOffsite, 'event_date')
  const filteredPastRes         = applyFilters(pastRes, 'reservation_date')
  const filteredPastEvents      = applyFilters(pastEvents, 'event_date')
  const filteredPastOffsite     = applyFilters(pastOffsite, 'event_date')
  const filteredActiveEvents    = applyFilters(activeEvents, 'event_date')
  const filteredActiveOffsite   = applyFilters(activeOffsite, 'event_date')

  const tabs = [
    { key: 'upcoming', label: `Upcoming (${filteredUpcomingRes.length + filteredUpcomingEvents.length + filteredUpcomingOffsite.length})` },
    { key: 'past',     label: `Past (${filteredPastRes.length + filteredPastEvents.length + filteredPastOffsite.length})` },
    { key: 'events',   label: `Events (${filteredActiveEvents.length})` },
    { key: 'offsite',  label: `Off-Site (${filteredActiveOffsite.length})` },
  ]

  function renderTab() {
    if (tab === 'upcoming') {
      const res  = filteredUpcomingRes
      const evts = filteredUpcomingEvents
      const off  = filteredUpcomingOffsite
      if (res.length + evts.length + off.length === 0) return <EmptyState message="No upcoming bookings." />
      return (
        <>
          <ListHeader showTable={true} />
          {res.map(r  => <ReservationRow key={r.id} r={r} tables={tables} busyId={busyId} updateStatus={updateStatus} onAmended={fetchAll} today={today} showToast={showToast} onGuestSaved={() => fetchAll({ silent: true })} />)}
          {evts.map(e => <EventRow key={e.id} e={e} busyId={busyId} updateStatus={updateStatus} today={today} showToast={showToast} onGuestSaved={() => fetchAll({ silent: true })} />)}
          {off.map(o  => <OffsiteRow key={o.id} o={o} busyId={busyId} updateStatus={updateStatus} today={today} showToast={showToast} onGuestSaved={() => fetchAll({ silent: true })} />)}
        </>
      )
    }
    if (tab === 'past') {
      const res  = filteredPastRes
      const evts = filteredPastEvents
      const off  = filteredPastOffsite
      if (res.length + evts.length + off.length === 0) return <EmptyState message="No past bookings." />
      return (
        <>
          <ListHeader showTable={true} />
          {res.map(r  => <ReservationRow key={r.id} r={r} tables={tables} busyId={busyId} updateStatus={updateStatus} onAmended={fetchAll} today={today} showToast={showToast} onGuestSaved={() => fetchAll({ silent: true })} />)}
          {evts.map(e => <EventRow key={e.id} e={e} busyId={busyId} updateStatus={updateStatus} today={today} showToast={showToast} onGuestSaved={() => fetchAll({ silent: true })} />)}
          {off.map(o  => <OffsiteRow key={o.id} o={o} busyId={busyId} updateStatus={updateStatus} today={today} showToast={showToast} onGuestSaved={() => fetchAll({ silent: true })} />)}
        </>
      )
    }
    if (tab === 'events') {
      const evts = filteredActiveEvents
      if (evts.length === 0) return <EmptyState message="No events found." />
      return (
        <>
          <ListHeader showTable={false} />
          {evts.map(e => <EventRow key={e.id} e={e} busyId={busyId} updateStatus={updateStatus} today={today} showToast={showToast} onGuestSaved={() => fetchAll({ silent: true })} />)}
        </>
      )
    }
    if (tab === 'offsite') {
      const off = filteredActiveOffsite
      if (off.length === 0) return <EmptyState message="No off-site bookings found." />
      return (
        <>
          <ListHeader showTable={false} />
          {off.map(o => <OffsiteRow key={o.id} o={o} busyId={busyId} updateStatus={updateStatus} today={today} showToast={showToast} onGuestSaved={() => fetchAll({ silent: true })} />)}
        </>
      )
    }
    return null
  }

  const hasFilters = filterDate !== '' || !!filterStatus

  return (
    <AdminPage width="3xl" title="Manage Bookings" headerGap="6">
      <FilterBar hasFilters={hasFilters} onClear={() => setView({ date: 'all', status: '' })}>
        <FilterField label="Date">
          <input type="date" value={filterDate} onChange={e => setView({ date: e.target.value || 'all' })}
            className={FILTER_INPUT_CLASS} />
        </FilterField>
        <FilterField label="Status">
          <select value={filterStatus} onChange={e => setView({ status: e.target.value })}
            className={FILTER_INPUT_CLASS}>
            <option value="">All statuses</option>
            <option value="pending">Pending</option>
            <option value="confirmed">Confirmed</option>
            <option value="seated">Seated</option>
            <option value="completed">Completed</option>
            <option value="no_show">No Show</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </FilterField>
      </FilterBar>

      <TabBar tabs={tabs} value={tab} onChange={key => setView({ tab: key })} />

      {loading ? <Loading /> : renderTab()}

      {toastNode}

      <AmountPrompt open={!!pendingComplete} title="Complete reservation"
        onCancel={() => setPendingComplete(null)}
        onConfirm={amount => { const p = pendingComplete; setPendingComplete(null); updateStatus(p.table, p.id, 'completed', amount) }} />
    </AdminPage>
  )
}
