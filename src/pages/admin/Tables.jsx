import { useState, useRef, useEffect } from 'react'
import { supabase } from '../../supabase'
import { supabaseCustomers } from '../../supabaseCustomers'
import { computeTableStatus, getLocalToday, isToday } from '../../lib/tableAvailability'
import { getDayType } from '../../lib/dayType'

const DATE_DEBOUNCE_MS = 300

const FLOOR_POINTS = [
  [30, 80], [30, 320], [370, 320], [370, 30],
  [130, 30], [130, 80]
]
const ENTRANCE = { x: 370, y: 60 }

function getTableSize(table) {
  if (table.table_number === 'BT') {
    return table.rotated ? { w: 18, h: 32 } : { w: 32, h: 18 }
  }
  if (table.table_number?.startsWith('B') && table.table_number !== 'BT') {
    return { w: 12, h: 12 }
  }
  return table.rotated ? { w: 16, h: 20 } : { w: 20, h: 16 }
}

function getTableColor(table, status) {
  const s = status?.status || 'free'
  if (s === 'blocked') return '#9ca3af'
  if (s === 'locked') return '#7c3aed'
  if (table.table_number === 'BT') {
    if (s === 'seated') return '#16a34a'
    if (s === 'reserved') return '#ca8a04'
    return '#1B3A6B'
  }
  if (table.table_number?.startsWith('B') && table.table_number !== 'BT') {
    if (s === 'seated') return '#16a34a'
    if (s === 'reserved') return '#ca8a04'
    return '#1B3A6B'
  }
  if (s === 'seated') return '#16a34a'
  if (s === 'reserved') return '#ca8a04'
  return '#E8420A'
}

function getReservationIcons(r) {
  let icons = ''
  if (r.baby_chairs > 0) icons += ' 🍼'
  if (r.pets) icons += ' 🐾'
  return icons
}

// `todayView` preserves the exact existing "today" behavior (live clock,
// seated/upcoming). Other dates have no meaningful "now", so they just show
// the day's earliest assigned reservation instead.
function getTableLabel(table, assignedReservations, todayView) {
  if (todayView) {
    const now = new Date()
    const currentMins = now.getHours() * 60 + now.getMinutes()

    const seated = assignedReservations.find(r => r.status === 'seated')
    if (seated) {
      const name = seated.customers?.full_name?.split(' ')[0] || '?'
      return { line1: name + getReservationIcons(seated), line2: 'Seated' }
    }

    const upcoming = assignedReservations
      .filter(r => r.status !== 'completed' && r.status !== 'cancelled')
      .map(r => {
        const [h, m] = r.reservation_time.split(':').map(Number)
        return { ...r, mins: h * 60 + m }
      })
      .filter(r => r.mins >= currentMins)
      .sort((a, b) => a.mins - b.mins)[0]

    if (upcoming) {
      const name = upcoming.customers?.full_name?.split(' ')[0] || '?'
      const [h, m] = upcoming.reservation_time.split(':').map(Number)
      const ampm = h >= 12 ? 'pm' : 'am'
      const hour = h > 12 ? h - 12 : h === 0 ? 12 : h
      const time = `${hour}:${String(m).padStart(2, '0')}${ampm}`
      return { line1: name + getReservationIcons(upcoming), line2: time }
    }

    return { line1: table.table_number, line2: null }
  }

  const earliest = assignedReservations
    .map(r => {
      const [h, m] = r.reservation_time.split(':').map(Number)
      return { ...r, mins: h * 60 + m }
    })
    .sort((a, b) => a.mins - b.mins)[0]

  if (earliest) {
    const name = earliest.customers?.full_name?.split(' ')[0] || '?'
    const [h, m] = earliest.reservation_time.split(':').map(Number)
    const ampm = h >= 12 ? 'pm' : 'am'
    const hour = h > 12 ? h - 12 : h === 0 ? 12 : h
    const time = `${hour}:${String(m).padStart(2, '0')}${ampm}`
    return { line1: name + getReservationIcons(earliest), line2: time }
  }

  return { line1: table.table_number, line2: null }
}

function checkTimeConflict(existingReservations, newReservation, durationMinutes) {
  const [newH, newM] = newReservation.reservation_time.split(':').map(Number)
  const newMins = newH * 60 + newM
  for (const r of existingReservations) {
    const [h, m] = r.reservation_time.split(':').map(Number)
    const existMins = h * 60 + m
    const diff = Math.abs(newMins - existMins)
    if (diff < durationMinutes) return { conflict: true, reservation: r, diff }
  }
  return { conflict: false }
}

function formatDisplayDate(dateString) {
  const [year, month, day] = dateString.split('-').map(Number)
  const d = new Date(year, month - 1, day)
  return d.toLocaleDateString('en-MY', { weekday: 'long', day: 'numeric', month: 'long' })
}

const emptyBlockForm = { date: '', start_time: '', end_time: '', reason: '' }

export default function Tables() {
  const [tables, setTables] = useState([])
  const [reservations, setReservations] = useState([])
  const [statusByTable, setStatusByTable] = useState(new Map())
  const [holdDurationMinutes, setHoldDurationMinutes] = useState(120)
  const [dateInputValue, setDateInputValue] = useState(getLocalToday())
  const [selectedDate, setSelectedDate] = useState(getLocalToday())
  const [selected, setSelected] = useState(null)
  const [dragging, setDragging] = useState(null)
  const [saved, setSaved] = useState(false)
  const [mode, setMode] = useState('assign')
  const [confirmModal, setConfirmModal] = useState(null)
  const [multiSelectMode, setMultiSelectMode] = useState(false)
  const [multiSelected, setMultiSelected] = useState([])
  const [blockFormOpen, setBlockFormOpen] = useState(false)
  const [blockForm, setBlockForm] = useState(emptyBlockForm)
  const svgRef = useRef(null)
  const dragOffset = useRef({ x: 0, y: 0 })
  const dragMoved = useRef(false)
  const dateDebounceRef = useRef(null)
  const requestIdRef = useRef(0)

  useEffect(() => { fetchAll() }, [selectedDate])

  // Clear any pending debounce on unmount so it doesn't fire after teardown.
  useEffect(() => () => {
    if (dateDebounceRef.current) clearTimeout(dateDebounceRef.current)
  }, [])

  function handleDateInputChange(value) {
    setSelected(null)
    setDateInputValue(value)
    // A native date input fires onChange once per completed segment (month/
    // day/year), not just once when the whole date is finished — editing an
    // already-populated date can produce several valid intermediate dates in
    // quick succession. Debounce so only the settled value triggers a fetch.
    if (dateDebounceRef.current) clearTimeout(dateDebounceRef.current)
    dateDebounceRef.current = setTimeout(() => {
      setSelectedDate(value)
    }, DATE_DEBOUNCE_MS)
  }

  async function fetchAll() {
    const requestId = ++requestIdRef.current
    const dayType = await getDayType(selectedDate)
    const [{ data: tableData }, { data: resData }, { data: blockData }, { data: slotRuleData }] = await Promise.all([
      supabase.from('restaurant_tables').select('*'),
      supabase.from('reservations')
        .select('*')
        .eq('reservation_date', selectedDate)
        .in('status', ['confirmed', 'pending', 'seated'])
        .order('reservation_time', { ascending: true }),
      supabase.from('table_blocks')
        .select('id, table_id, reason, source_type, source_id')
        .eq('block_date', selectedDate),
      supabase.from('slot_rules').select('hold_duration_minutes').eq('day_type', dayType).maybeSingle()
    ])

    const reservationsData = resData || []
    const customerIds = [...new Set(reservationsData.map(r => r.customer_id).filter(Boolean))]

    let customersById = {}
    if (customerIds.length > 0) {
      const { data: customersData } = await supabaseCustomers
        .from('customers')
        .select('id, full_name, phone, email')
        .in('id', customerIds)
      customersById = Object.fromEntries((customersData || []).map(c => [c.id, c]))
    }

    // A newer fetchAll() may have started (and possibly already resolved)
    // while this one was in flight -- discard this response rather than
    // clobber more recent state with stale data.
    if (requestId !== requestIdRef.current) return

    const tableRows = (tableData || []).map(t => ({ ...t, rotated: t.rotated || false }))
    const reservationRows = reservationsData.map(row => ({ ...row, customers: customersById[row.customer_id] }))
    setTables(tableRows)
    setReservations(reservationRows)
    setHoldDurationMinutes(slotRuleData?.hold_duration_minutes ?? 120)
    const statusList = computeTableStatus({
      dateString: selectedDate,
      tables: tableRows,
      reservations: reservationRows,
      blocks: blockData || []
    })
    setStatusByTable(new Map(statusList.map(s => [s.table_id, s])))
  }

  async function saveTables() {
    for (const t of tables) {
      await supabase.from('restaurant_tables').update({
        table_number: t.table_number,
        capacity: t.capacity,
        x_position: t.x_position,
        y_position: t.y_position,
        is_bookable: t.is_bookable,
        rotated: t.rotated || false
      }).eq('id', t.id)
    }
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  function getTableReservations(tableId) {
    return reservations.filter(r =>
      Array.isArray(r.table_ids) && r.table_ids.includes(tableId)
    )
  }

  function getUnassignedReservations() {
    return reservations.filter(r =>
      !r.table_ids || !Array.isArray(r.table_ids) || r.table_ids.length === 0
    )
  }

  function getAssignedCapacity(reservationId) {
    const reservation = reservations.find(r => r.id === reservationId)
    if (!reservation || !Array.isArray(reservation.table_ids)) return 0
    return reservation.table_ids.reduce((total, tableId) => {
      const table = tables.find(t => t.id === tableId)
      return total + (table?.capacity || 0)
    }, 0)
  }

  async function assignTable(tableId, reservationId) {
    const reservation = reservations.find(r => r.id === reservationId)
    const tableReservations = getTableReservations(tableId)
    const conflict = checkTimeConflict(tableReservations, reservation, holdDurationMinutes)
    const table = tables.find(t => t.id === tableId)

    // Check capacity
    const alreadyAssigned = getAssignedCapacity(reservationId)
    const tableCapacity = table?.capacity || 0
    const totalAfterAssign = alreadyAssigned + tableCapacity
    const guestCount = reservation.guest_count

    if (conflict.conflict && totalAfterAssign < guestCount) {
      setConfirmModal({
        message: `This table already has a reservation within 2 hours of ${reservation.reservation_time} AND combined capacity (${totalAfterAssign}) is still below guest count (${guestCount}). Assign anyway?`,
        onConfirm: () => { doAssign(tableId, reservationId); setConfirmModal(null) },
        onCancel: () => setConfirmModal(null)
      })
      return
    }

    if (conflict.conflict) {
      setConfirmModal({
        message: `This table already has a reservation within 2 hours of ${reservation.reservation_time}. The previous party may still be dining. Assign anyway?`,
        onConfirm: () => { doAssign(tableId, reservationId); setConfirmModal(null) },
        onCancel: () => setConfirmModal(null)
      })
      return
    }

    if (totalAfterAssign < guestCount) {
      setConfirmModal({
        message: `After assigning this table, combined capacity will be ${totalAfterAssign} seats but the reservation is for ${guestCount} guests. You may need to assign more tables. Assign anyway?`,
        onConfirm: () => { doAssign(tableId, reservationId); setConfirmModal(null) },
        onCancel: () => setConfirmModal(null)
      })
      return
    }

    doAssign(tableId, reservationId)
  }

  async function doAssign(tableId, reservationId) {
    const reservation = reservations.find(r => r.id === reservationId)
    const currentIds = Array.isArray(reservation.table_ids) ? reservation.table_ids : []
    const newIds = currentIds.includes(tableId) ? currentIds : [...currentIds, tableId]
    await supabase.from('reservations').update({ table_ids: newIds }).eq('id', reservationId)
    const [h, m] = reservation.reservation_time.split(':').map(Number)
    const lockFrom = new Date()
    lockFrom.setHours(h, m, 0, 0)
    const lockUntil = new Date(lockFrom.getTime() + holdDurationMinutes * 60 * 1000)
    await supabase.from('restaurant_tables')
      .update({ locked_until: lockUntil.toISOString(), locked_by_reservation: reservationId })
      .eq('id', tableId)
    await fetchAll()
    setSelected(null)
  }

  async function unassignTable(tableId, reservationId) {
    const reservation = reservations.find(r => r.id === reservationId)
    const newIds = (Array.isArray(reservation.table_ids) ? reservation.table_ids : []).filter(id => id !== tableId)
    await supabase.from('reservations').update({ table_ids: newIds }).eq('id', reservationId)
    await supabase.from('restaurant_tables')
      .update({ locked_until: null, locked_by_reservation: null })
      .eq('id', tableId)
    await fetchAll()
  }

  async function mergeTables() {
    if (multiSelected.length < 2) return
    const selectedTableObjects = tables.filter(t => multiSelected.includes(t.id))
    const combinedCapacity = selectedTableObjects.reduce((sum, t) => sum + (t.capacity || 0), 0)
    const { data: group, error } = await supabase
      .from('table_groups')
      .insert({ table_ids: multiSelected, combined_capacity: combinedCapacity })
      .select()
      .single()
    if (error) { console.error(error); return }
    await supabase
      .from('restaurant_tables')
      .update({ group_id: group.id })
      .in('id', multiSelected)
    setMultiSelected([])
    setMultiSelectMode(false)
    await fetchAll()
  }

  async function unmergeTables(groupId) {
    const groupTableIds = tables
      .filter(t => t.group_id === groupId)
      .map(t => t.id)
    const affectedReservations = reservations.filter(r =>
      Array.isArray(r.table_ids) &&
      r.table_ids.some(tid => groupTableIds.includes(tid))
    )
    for (const r of affectedReservations) {
      const newTableIds = r.table_ids.filter(tid => !groupTableIds.includes(tid))
      await supabase.from('reservations').update({ table_ids: newTableIds }).eq('id', r.id)
    }
    await supabase.from('restaurant_tables')
      .update({ group_id: null, locked_until: null, locked_by_reservation: null })
      .eq('group_id', groupId)
    await supabase.from('table_groups').delete().eq('id', groupId)
    await fetchAll()
  }

  async function submitBlockForm(e) {
    e.preventDefault()
    const { error } = await supabase.from('table_blocks').insert([{
      table_id: selected,
      block_date: blockForm.date,
      start_time: blockForm.start_time || null,
      end_time: blockForm.end_time || null,
      reason: blockForm.reason || null,
      source_type: 'manual'
    }])
    if (error) { console.error('Failed to block table:', error); return }
    setBlockFormOpen(false)
    setBlockForm(emptyBlockForm)
    await fetchAll()
  }

  async function unblockTable(blockId) {
    const { error } = await supabase.from('table_blocks').delete().eq('id', blockId)
    if (error) { console.error('Failed to unblock table:', error); return }
    await fetchAll()
  }

  function getSVGPoint(clientX, clientY) {
    const pt = svgRef.current.createSVGPoint()
    pt.x = clientX
    pt.y = clientY
    return pt.matrixTransform(svgRef.current.getScreenCTM().inverse())
  }

  // Mouse events
  function onMouseDown(e, table) {
    if (mode !== 'layout') return
    e.preventDefault()
    const pt = getSVGPoint(e.clientX, e.clientY)
    dragOffset.current = { x: pt.x - table.x_position, y: pt.y - table.y_position }
    dragMoved.current = false
    setDragging(table.id)
  }

  function onMouseMove(e) {
    if (!dragging) return
    dragMoved.current = true
    const pt = getSVGPoint(e.clientX, e.clientY)
    setTables(prev => prev.map(t =>
      t.id === dragging
        ? { ...t, x_position: pt.x - dragOffset.current.x, y_position: pt.y - dragOffset.current.y }
        : t
    ))
  }

  function onMouseUp() { setDragging(null) }

  // Touch events
  function onTouchStart(e, table) {
    if (mode !== 'layout') return
    e.preventDefault()
    const touch = e.touches[0]
    const pt = getSVGPoint(touch.clientX, touch.clientY)
    dragOffset.current = { x: pt.x - table.x_position, y: pt.y - table.y_position }
    dragMoved.current = false
    setDragging(table.id)
  }

  function onTouchMove(e) {
    if (!dragging) return
    e.preventDefault()
    dragMoved.current = true
    const touch = e.touches[0]
    const pt = getSVGPoint(touch.clientX, touch.clientY)
    setTables(prev => prev.map(t =>
      t.id === dragging
        ? { ...t, x_position: pt.x - dragOffset.current.x, y_position: pt.y - dragOffset.current.y }
        : t
    ))
  }

  function onTouchEnd(e, table) {
    if (!dragMoved.current && mode === 'assign') {
      onTableClick(table)
    }
    setDragging(null)
  }

  function onTableClick(table) {
    if (multiSelectMode) {
      setMultiSelected(prev =>
        prev.includes(table.id)
          ? prev.filter(id => id !== table.id)
          : [...prev, table.id]
      )
      return
    }
    setBlockFormOpen(false)
    setSelected(selected === table.id ? null : table.id)
  }

  const selectedTable = tables.find(t => t.id === selected)
  const selectedStatus = selected ? statusByTable.get(selected) : null
  const selectedTableReservations = selected ? getTableReservations(selected) : []
  const unassigned = getUnassignedReservations()
  const todayView = isToday(selectedDate)

  return (
    <div className="min-h-screen p-4 md:p-6">
      <div className="flex justify-between items-center mb-4 sticky top-0 bg-white z-10 py-2">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Floor Plan</h1>
          <p className="text-gray-500 text-sm">
            {mode === 'assign'
              ? (todayView ? `Today — ${formatDisplayDate(selectedDate)}` : formatDisplayDate(selectedDate))
              : 'Drag tables to reposition'}
          </p>
        </div>
        <div className="flex gap-2 md:gap-3 items-end">
          {mode === 'assign' && (
            <div>
              <label className="block text-xs tracking-widest uppercase text-gray-400 mb-1">Date</label>
              <input type="date" value={dateInputValue}
                onChange={e => handleDateInputChange(e.target.value)}
                className="border-b border-gray-200 bg-transparent py-2 text-sm text-gray-800 focus:outline-none focus:border-gray-800 transition-colors" />
            </div>
          )}
          <button onClick={() => { setMode(mode === 'assign' ? 'layout' : 'assign'); setSelected(null); setMultiSelectMode(false); setMultiSelected([]) }}
            className="px-3 md:px-4 py-2 rounded-lg text-sm font-medium bg-gray-100 hover:bg-gray-200 text-gray-700">
            {mode === 'assign' ? '✏️ Edit Layout' : '← Back'}
          </button>
          {mode === 'layout' && (
            <button onClick={saveTables}
              className={`px-4 md:px-6 py-2 rounded-lg font-medium text-white ${saved ? 'bg-green-600' : 'bg-black hover:bg-gray-800'}`}>
              {saved ? 'Saved!' : 'Save'}
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-4 md:gap-6">
        <div className="w-full md:w-[55%] border border-gray-200 rounded-xl overflow-hidden bg-gray-50">
          <svg
            ref={svgRef}
            viewBox="0 0 400 340"
            width="100%"
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseUp}
            onTouchMove={onTouchMove}
            onTouchEnd={() => setDragging(null)}
            style={{ cursor: dragging ? 'grabbing' : 'default', display: 'block', touchAction: 'none' }}
          >
            <polygon
              points={FLOOR_POINTS.map(p => p.join(',')).join(' ')}
              fill="#fafaf8" stroke="#333" strokeWidth="1.5"
            />
            <rect x={ENTRANCE.x - 2} y={ENTRANCE.y - 12} width="3" height="24" fill="#ef4444" />
            <text x={ENTRANCE.x - 35} y={ENTRANCE.y + 4} fontSize="8" fill="#ef4444" fontWeight="500">Entrance</text>

            {/* Fixed bar counter */}
            <rect x={80} y={120} width={200} height={18} rx="2" fill="#1B3A6B" opacity="0.7" />
            <text x={180} y={132} textAnchor="middle" dominantBaseline="central"
              fontSize="6" fill="white" fontWeight="500">Bar Counter</text>

            {tables.map(table => {
              const { w, h } = getTableSize(table)
              const assigned = getTableReservations(table.id)
              const status = statusByTable.get(table.id)
              const color = getTableColor(table, status)
              const label = getTableLabel(table, assigned, todayView)
              const isSelected = selected === table.id
              const isMultiSelected = multiSelected.includes(table.id)

              const isBarStool = table.table_number?.startsWith('B') && table.table_number !== 'BT'

              return (
                <g key={table.id}
                  onClick={() => onTableClick(table)}
                  onMouseDown={e => onMouseDown(e, table)}
                  onTouchStart={e => onTouchStart(e, table)}
                  onTouchEnd={e => onTouchEnd(e, table)}
                  style={{ cursor: mode === 'layout' ? 'grab' : 'pointer', userSelect: 'none' }}>
                  {isBarStool ? (
                    <>
                      <circle
                        cx={table.x_position + w / 2}
                        cy={table.y_position + h / 2}
                        r={w / 2}
                        fill={color}
                        stroke={isMultiSelected ? '#f59e0b' : isSelected ? '#3b82f6' : 'transparent'}
                        strokeWidth="2"
                        opacity="0.9"
                      />
                      <text
                        x={table.x_position + w / 2}
                        y={table.y_position + h / 2}
                        textAnchor="middle" dominantBaseline="central"
                        fontSize="4" fill="white" fontWeight="600">
                        {label.line1}
                      </text>
                    </>
                  ) : (
                    <>
                      <rect
                        x={table.x_position} y={table.y_position}
                        width={w} height={h} rx="2"
                        fill={color}
                        stroke={isMultiSelected ? '#f59e0b' : isSelected ? '#3b82f6' : 'transparent'}
                        strokeWidth="2"
                        opacity="0.9"
                      />
                      <text
                        x={table.x_position + w / 2}
                        y={table.y_position + h / 2 - (label.line2 ? 3 : 0)}
                        textAnchor="middle" dominantBaseline="central"
                        fontSize="5.5" fill="white" fontWeight="600">
                        {label.line1}
                      </text>
                      {label.line2 && (
                        <text
                          x={table.x_position + w / 2}
                          y={table.y_position + h / 2 + 6}
                          textAnchor="middle" dominantBaseline="central"
                          fontSize="4.5" fill="white" opacity="0.9">
                          {label.line2}
                        </text>
                      )}
                    </>
                  )}
                </g>
              )
            })}
          </svg>
        </div>

        <div className="w-full md:w-[45%] border border-gray-200 rounded-xl p-4 md:p-5 overflow-y-auto max-h-[500px] md:max-h-[600px]">

          {mode === 'layout' && !selectedTable && !multiSelectMode && (
            <div className="space-y-4 mt-4">
              <button
                onClick={() => { setMultiSelectMode(true); setMultiSelected([]) }}
                className="w-full py-2 text-xs font-medium tracking-widest uppercase border border-gray-200 text-gray-600 hover:bg-gray-50 rounded-lg transition-colors">
                Select Multiple to Merge
              </button>
              <div className="text-gray-400 text-sm text-center mt-4">
                <p>Drag tables to reposition.</p>
                <p className="mt-1">Click a table to edit it.</p>
              </div>
            </div>
          )}

          {mode === 'layout' && multiSelectMode && (
            <div className="space-y-3 mt-4">
              <div className="flex justify-between items-center">
                <p className="text-sm font-medium text-gray-700">
                  {multiSelected.length} table{multiSelected.length !== 1 ? 's' : ''} selected
                </p>
                <button
                  onClick={() => { setMultiSelectMode(false); setMultiSelected([]) }}
                  className="text-xs text-gray-400 hover:text-gray-700">
                  Cancel
                </button>
              </div>
              <p className="text-xs text-gray-400">Tap tables on the floor plan to select them.</p>
              {multiSelected.length >= 2 && (
                <button
                  onClick={mergeTables}
                  className="w-full py-2.5 text-xs font-medium tracking-widest uppercase text-white rounded-lg transition-opacity hover:opacity-90"
                  style={{ backgroundColor: '#E8420A' }}>
                  Merge {multiSelected.length} Tables
                </button>
              )}
              {multiSelected.length > 0 && multiSelected.length < 2 && (
                <p className="text-xs text-gray-400 text-center">Select at least 2 tables to merge</p>
              )}
            </div>
          )}

          {mode === 'layout' && selectedTable && (
            <>
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-bold text-base">{selectedTable.table_number}</h3>
                <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-black text-sm">✕</button>
              </div>
              {selectedTable.group_id && (
                <div className="mb-4 p-3 bg-amber-50 rounded-lg border border-amber-200">
                  <p className="text-xs text-amber-700 mb-2">This table is part of a merged group.</p>
                  <button
                    onClick={() => { unmergeTables(selectedTable.group_id); setSelected(null) }}
                    className="w-full py-2 text-xs font-medium tracking-widest uppercase border border-amber-400 text-amber-700 hover:bg-amber-100 rounded-lg transition-colors">
                    Unmerge Tables
                  </button>
                </div>
              )}
              <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Table Name</p>
              <input type="text" value={selectedTable.table_number}
                onChange={e => setTables(prev => prev.map(t => t.id === selected ? { ...t, table_number: e.target.value } : t))}
                className="w-full border-b border-gray-200 bg-transparent py-2 text-sm text-gray-800 focus:outline-none focus:border-gray-800 mb-4" />
              <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Capacity</p>
              <input type="number" value={selectedTable.capacity ?? ''}
                onChange={e => setTables(prev => prev.map(t => t.id === selected ? { ...t, capacity: parseInt(e.target.value) || null } : t))}
                className="w-full border-b border-gray-200 bg-transparent py-2 text-sm text-gray-800 focus:outline-none focus:border-gray-800 mb-4" />
              <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Status</p>
              <button onClick={() => setTables(prev => prev.map(t => t.id === selected ? { ...t, is_bookable: !t.is_bookable } : t))}
                className="w-full py-2 rounded-lg text-sm font-medium text-white mb-4"
                style={{ backgroundColor: selectedTable.is_bookable ? '#16a34a' : '#9ca3af' }}>
                {selectedTable.is_bookable ? '✓ Bookable' : '✗ Blocked'}
              </button>
              <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Orientation</p>
              <button onClick={() => setTables(prev => prev.map(t => t.id === selected ? { ...t, rotated: !t.rotated } : t))}
                className="w-full py-2 rounded-lg text-sm font-medium bg-gray-100 hover:bg-gray-200 text-gray-700">
                {selectedTable.rotated ? '↕ Set Vertical' : '↔ Set Horizontal'}
              </button>
            </>
          )}

          {mode === 'assign' && !selectedTable && (
            <>
              <h3 className="font-bold text-base mb-3">Unassigned {todayView ? 'Today' : 'This Date'}</h3>
              {unassigned.length === 0 ? (
                <p className="text-gray-400 text-sm">All reservations are assigned.</p>
              ) : (
                unassigned.map(r => (
                  <div key={r.id} className="border border-gray-200 rounded-lg p-3 mb-2">
                    <p className="font-semibold text-sm">{r.customers?.full_name}{getReservationIcons(r)}</p>
                    <p className="text-xs text-gray-500">{r.reservation_time} · {r.guest_count} guests</p>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium mt-1 inline-block ${r.status === 'confirmed' ? 'bg-blue-100 text-blue-800' : 'bg-yellow-100 text-yellow-800'}`}>
                      {r.status}
                    </span>
                    <p className="text-xs mt-0.5 text-gray-400">{r.guest_count} seats needed</p>
                  </div>
                ))
              )}
              <div className="mt-6 pt-4 border-t border-gray-100">
                <p className="text-xs text-gray-400 mb-2">Legend</p>
                <div className="flex flex-col gap-2 text-xs text-gray-500">
                  <span className="flex items-center gap-2"><span className="w-3 h-3 rounded inline-block" style={{ backgroundColor: '#E8420A' }}></span> Free</span>
                  <span className="flex items-center gap-2"><span className="w-3 h-3 rounded bg-yellow-600 inline-block"></span> Reserved</span>
                  {todayView && <span className="flex items-center gap-2"><span className="w-3 h-3 rounded bg-green-600 inline-block"></span> Seated</span>}
                  <span className="flex items-center gap-2"><span className="w-3 h-3 rounded bg-gray-400 inline-block"></span> Blocked</span>
                  {todayView && <span className="flex items-center gap-2"><span className="w-3 h-3 rounded bg-purple-700 inline-block"></span> Locked</span>}
                  <span className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded inline-block" style={{ backgroundColor: '#1B3A6B' }}></span>
                    Big Table
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full inline-block" style={{ backgroundColor: '#1B3A6B' }}></span>
                    Bar Stool
                  </span>
                </div>
              </div>
            </>
          )}

          {mode === 'assign' && selectedTable && (
            <>
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-bold text-base">{selectedTable.table_number}</h3>
                <button onClick={() => { setSelected(null); setBlockFormOpen(false) }} className="text-gray-400 hover:text-black text-sm">✕ Close</button>
              </div>

              <div className="mb-4 p-3 rounded-lg border border-gray-200">
                {selectedStatus?.status === 'blocked' && selectedStatus.block_id ? (
                  <>
                    <p className="text-xs text-gray-500 mb-2">
                      Blocked{selectedStatus.reason ? `: ${selectedStatus.reason}` : ''}
                      {selectedStatus.source_type === 'experience'
                        ? ' — assigned from an Experience. Prefer unassigning from the Experiences page.'
                        : ''}
                    </p>
                    <button onClick={() => unblockTable(selectedStatus.block_id)}
                      className="w-full py-2 text-xs font-medium tracking-widest uppercase border border-gray-300 text-gray-600 hover:bg-gray-50 rounded-lg transition-colors">
                      Unblock
                    </button>
                  </>
                ) : selectedStatus?.status === 'blocked' ? (
                  <p className="text-xs text-gray-500">This table is marked not bookable. Change that from Edit Layout.</p>
                ) : blockFormOpen ? (
                  <form onSubmit={submitBlockForm} className="space-y-3">
                    <div>
                      <label className="block text-xs text-gray-500 uppercase tracking-wide mb-1">Date</label>
                      <input type="date" required value={blockForm.date}
                        onChange={e => setBlockForm(f => ({ ...f, date: e.target.value }))}
                        className="w-full border-b border-gray-200 bg-transparent py-1.5 text-sm focus:outline-none focus:border-gray-800" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-gray-500 uppercase tracking-wide mb-1">Start (optional)</label>
                        <input type="time" value={blockForm.start_time}
                          onChange={e => setBlockForm(f => ({ ...f, start_time: e.target.value }))}
                          className="w-full border-b border-gray-200 bg-transparent py-1.5 text-sm focus:outline-none focus:border-gray-800" />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 uppercase tracking-wide mb-1">End (optional)</label>
                        <input type="time" value={blockForm.end_time}
                          onChange={e => setBlockForm(f => ({ ...f, end_time: e.target.value }))}
                          className="w-full border-b border-gray-200 bg-transparent py-1.5 text-sm focus:outline-none focus:border-gray-800" />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 uppercase tracking-wide mb-1">Reason (optional)</label>
                      <input type="text" value={blockForm.reason}
                        onChange={e => setBlockForm(f => ({ ...f, reason: e.target.value }))}
                        placeholder="e.g. Deep clean"
                        className="w-full border-b border-gray-200 bg-transparent py-1.5 text-sm focus:outline-none focus:border-gray-800" />
                    </div>
                    <div className="flex gap-2">
                      <button type="submit"
                        className="flex-1 py-2 text-xs font-medium tracking-widest uppercase text-white rounded-lg"
                        style={{ backgroundColor: '#E8420A' }}>
                        Block
                      </button>
                      <button type="button" onClick={() => setBlockFormOpen(false)}
                        className="flex-1 py-2 text-xs font-medium tracking-widest uppercase border border-gray-300 text-gray-600 rounded-lg">
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : (
                  <button
                    onClick={() => { setBlockForm({ date: selectedDate, start_time: '', end_time: '', reason: '' }); setBlockFormOpen(true) }}
                    className="w-full py-2 text-xs font-medium tracking-widest uppercase border border-gray-300 text-gray-600 hover:bg-gray-50 rounded-lg transition-colors">
                    Block This Table
                  </button>
                )}
              </div>

              {selectedTableReservations.length > 0 && (
                <div className="mb-4">
                  <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Assigned</p>
                  {selectedTableReservations.map(r => (
                    <div key={r.id} className="border border-gray-200 rounded-lg p-3 mb-2">
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="font-semibold text-sm">{r.customers?.full_name}{getReservationIcons(r)}</p>
                          <p className="text-xs text-gray-500">{r.reservation_time} · {r.guest_count} guests</p>
                          {(() => {
                            const assigned = getAssignedCapacity(r.id)
                            const needed = r.guest_count - assigned
                            if (needed <= 0) return <p className="text-xs font-medium mt-0.5" style={{ color: '#16a34a' }}>✓ Fully seated ({assigned} seats assigned)</p>
                            if (assigned > 0) return <p className="text-xs font-medium mt-0.5" style={{ color: '#ca8a04' }}>⚠ {needed} more seat{needed > 1 ? 's' : ''} needed</p>
                            return <p className="text-xs font-medium mt-0.5" style={{ color: '#dc2626' }}>✗ No seats assigned yet</p>
                          })()}
                        </div>
                        <div className="flex gap-3">
                          <button onClick={() => unassignTable(selectedTable.id, r.id)}
                            className="text-red-500 text-xs hover:text-red-700">Unassign</button>
                          {selectedTable.locked_until && new Date(selectedTable.locked_until) > new Date() && (
                            <button onClick={async () => {
                              await supabase.from('restaurant_tables')
                                .update({ locked_until: null, locked_by_reservation: null })
                                .eq('id', selectedTable.id)
                              await fetchAll()
                            }}
                              className="text-purple-600 text-xs hover:text-purple-800">Release Lock</button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Assign a Reservation</p>
              {unassigned.length === 0 ? (
                <p className="text-gray-400 text-sm">No unassigned reservations {todayView ? 'today' : 'on this date'}.</p>
              ) : (
                unassigned.map(r => (
                  <div key={r.id}
                    className="border border-gray-200 rounded-lg p-3 mb-2 cursor-pointer hover:border-black transition-colors"
                    onClick={() => assignTable(selectedTable.id, r.id)}>
                    <p className="font-semibold text-sm">{r.customers?.full_name}{getReservationIcons(r)}</p>
                    <p className="text-xs text-gray-500">{r.reservation_time} · {r.guest_count} guests</p>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium mt-1 inline-block ${r.status === 'confirmed' ? 'bg-blue-100 text-blue-800' : 'bg-yellow-100 text-yellow-800'}`}>
                      {r.status}
                    </span>
                    {(() => {
                      const assigned = getAssignedCapacity(r.id)
                      const needed = r.guest_count - assigned
                      if (needed <= 0) return <p className="text-xs mt-0.5" style={{ color: '#16a34a' }}>✓ Fully seated</p>
                      if (assigned > 0) return <p className="text-xs mt-0.5" style={{ color: '#ca8a04' }}>+{needed} seats still needed</p>
                      return <p className="text-xs mt-0.5 text-gray-400">{r.guest_count} seats needed</p>
                    })()}
                  </div>
                ))
              )}
            </>
          )}
        </div>
      </div>

      {confirmModal && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl">
            <h3 className="font-bold text-lg mb-2">⚠️ Possible Conflict</h3>
            <p className="text-gray-600 text-sm mb-6">{confirmModal.message}</p>
            <div className="flex gap-3">
              <button onClick={confirmModal.onCancel}
                className="flex-1 py-2 rounded-lg border border-gray-300 text-sm font-medium hover:bg-gray-50">
                Cancel
              </button>
              <button onClick={confirmModal.onConfirm}
                className="flex-1 py-2 rounded-lg bg-black text-white text-sm font-medium hover:bg-gray-800">
                Assign Anyway
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
