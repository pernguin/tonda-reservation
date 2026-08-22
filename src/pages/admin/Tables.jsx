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
  const [assignTarget, setAssignTarget] = useState(null)
  const [assignSelected, setAssignSelected] = useState([])
  const [blockFormOpen, setBlockFormOpen] = useState(false)
  const [blockForm, setBlockForm] = useState(emptyBlockForm)
  const [newTableFormOpen, setNewTableFormOpen] = useState(false)
  const [newTableForm, setNewTableForm] = useState({ table_number: '', capacity: '2' })
  const [deleteTableConfirm, setDeleteTableConfirm] = useState(null)
  const [explodingTableId, setExplodingTableId] = useState(null)
  const [toast, setToast] = useState('')
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
    setAssignTarget(null)
    setAssignSelected([])
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

  function isFullySeated(r) {
    return getAssignedCapacity(r.id) >= r.guest_count
  }

  function getAssignableReservations() {
    return reservations.filter(r => !isFullySeated(r))
  }

  // Comma-joined table_number(s) for a reservation, or null if unassigned.
  function getReservationTableLabel(r) {
    if (!Array.isArray(r.table_ids) || r.table_ids.length === 0) return null
    const names = r.table_ids
      .map(id => tables.find(t => t.id === id)?.table_number)
      .filter(Boolean)
    return names.length > 0 ? names.join(', ') : null
  }

  // Fully-seated rows highlight their table the same way clicking the table
  // directly does. Under-capacity rows (unassigned or partially-assigned)
  // instead enter assign mode, targeting that reservation for the
  // multi-table picker below.
  function onReservationRowClick(r) {
    if (isFullySeated(r)) {
      if (Array.isArray(r.table_ids) && r.table_ids.length > 0) {
        setSelected(r.table_ids[0])
      }
      return
    }
    setAssignTarget(r)
    setAssignSelected([])
  }

  function getAssignedCapacity(reservationId) {
    const reservation = reservations.find(r => r.id === reservationId)
    if (!reservation || !Array.isArray(reservation.table_ids)) return 0
    return reservation.table_ids.reduce((total, tableId) => {
      const table = tables.find(t => t.id === tableId)
      return total + (table?.capacity || 0)
    }, 0)
  }

  // tableIds is always an array — a single manual pick from the per-table
  // panel arrives as a 1-element array, a multi-table pick from assign mode
  // arrives as the whole selection, submitted together in one claim.
  async function assignTable(tableIds, reservationId) {
    const reservation = reservations.find(r => r.id === reservationId)
    const tableReservations = tableIds.flatMap(id => getTableReservations(id))
    const conflict = checkTimeConflict(tableReservations, reservation, holdDurationMinutes)
    const newCapacity = tableIds.reduce((sum, id) => sum + (tables.find(t => t.id === id)?.capacity || 0), 0)
    const tableWord = tableIds.length > 1 ? 'One of the selected tables' : 'This table'

    // Check capacity
    const alreadyAssigned = getAssignedCapacity(reservationId)
    const totalAfterAssign = alreadyAssigned + newCapacity
    const guestCount = reservation.guest_count

    if (conflict.conflict && totalAfterAssign < guestCount) {
      setConfirmModal({
        message: `${tableWord} already has a reservation within 2 hours of ${reservation.reservation_time} AND combined capacity (${totalAfterAssign}) is still below guest count (${guestCount}). Assign anyway?`,
        onConfirm: () => { doAssign(tableIds, reservationId); setConfirmModal(null) },
        onCancel: () => setConfirmModal(null)
      })
      return
    }

    if (conflict.conflict) {
      setConfirmModal({
        message: `${tableWord} already has a reservation within 2 hours of ${reservation.reservation_time}. The previous party may still be dining. Assign anyway?`,
        onConfirm: () => { doAssign(tableIds, reservationId); setConfirmModal(null) },
        onCancel: () => setConfirmModal(null)
      })
      return
    }

    if (totalAfterAssign < guestCount) {
      setConfirmModal({
        message: `After assigning ${tableIds.length > 1 ? 'these tables' : 'this table'}, combined capacity will be ${totalAfterAssign} seats but the reservation is for ${guestCount} guests. You may need to assign more tables. Assign anyway?`,
        onConfirm: () => { doAssign(tableIds, reservationId); setConfirmModal(null) },
        onCancel: () => setConfirmModal(null)
      })
      return
    }

    doAssign(tableIds, reservationId)
  }

  function showToast(msg) {
    setToast(msg)
    setTimeout(() => setToast(''), 2500)
  }

  async function doAssign(tableIds, reservationId) {
    const reservation = reservations.find(r => r.id === reservationId)
    const currentIds = Array.isArray(reservation.table_ids) ? reservation.table_ids : []
    const newIds = [...new Set([...currentIds, ...tableIds])]
    // Lock the tables for holdDurationMinutes from the reservation's own date+time
    // (explicit y/m/d parsing, same pattern as getDateInfo — not new Date()/today).
    const [h, m] = reservation.reservation_time.split(':').map(Number)
    const [y, mo, d] = reservation.reservation_date.split('-').map(Number)
    const lockFrom = new Date(y, mo - 1, d, h, m, 0, 0)
    const lockUntil = new Date(lockFrom.getTime() + holdDurationMinutes * 60 * 1000)
    // Claim before writing table_ids, same order as autoAssignTables — a lost
    // race must never leave reservations.table_ids pointing at an unclaimed table.
    const { error: claimError } = await supabase.rpc('claim_restaurant_tables', {
      p_table_ids: tableIds,
      p_reservation_id: reservationId,
      p_reservation_start: lockFrom.toISOString(),
      p_lock_until: lockUntil.toISOString()
    })
    if (claimError) {
      console.error('Manual assignment failed: claim lost the race', claimError)
      showToast('This table was just claimed by another reservation — pick a different one or refresh.')
      return
    }
    await supabase.from('reservations').update({ table_ids: newIds, needs_manual_assignment: false }).eq('id', reservationId)
    await fetchAll()
    setSelected(null)
    setAssignTarget(null)
    setAssignSelected([])
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

  async function createTable() {
    const name = newTableForm.table_number.trim()
    if (!name) return
    const capacity = parseInt(newTableForm.capacity) || 1

    const insertRow = async () => {
      await supabase.from('restaurant_tables').insert({
        table_number: name,
        capacity,
        x_position: 250,
        y_position: 250,
        is_bookable: true,
        rotated: false,
        is_temporary: true
      })
      setNewTableFormOpen(false)
      setNewTableForm({ table_number: '', capacity: '2' })
      await fetchAll()
    }

    // Soft warning only -- table_number has no uniqueness constraint and
    // duplicates already exist elsewhere in this data, so this isn't a hard
    // block, just a heads-up to avoid confusing an already-existing name.
    if (tables.some(t => t.table_number === name)) {
      setConfirmModal({
        message: `A table named "${name}" already exists. Create another one with the same name anyway?`,
        onConfirm: () => { insertRow(); setConfirmModal(null) },
        onCancel: () => setConfirmModal(null)
      })
      return
    }
    await insertRow()
  }

  // Cross-date, active-status only -- staff need to know about a booking
  // next week, not just whatever date happens to be selected right now.
  async function openDeleteTableConfirm(table) {
    // table_ids is stored as jsonb, not a native Postgres array -- .contains()
    // generates array-literal syntax that errors against a jsonb column
    // server-side, so this filters client-side instead, same as
    // getTableReservations does everywhere else in this file.
    // No customers(...) embed -- customer data lives in Round's separate
    // Supabase project here, not a local FK PostgREST can join, same as
    // fetchAll() already has to handle.
    const { data: allActive, error: reservationsError } = await supabase
      .from('reservations')
      .select('id, reservation_date, reservation_time, guest_count, table_ids, customer_id')
      .in('status', ['confirmed', 'pending', 'seated'])
      .order('reservation_date', { ascending: true })
    if (reservationsError) { console.error('Failed to check affected reservations:', reservationsError); return }
    const affectedRaw = (allActive || []).filter(r =>
      Array.isArray(r.table_ids) && r.table_ids.includes(table.id)
    )
    const affectedCustomerIds = [...new Set(affectedRaw.map(r => r.customer_id).filter(Boolean))]
    let affectedCustomersById = {}
    if (affectedCustomerIds.length > 0) {
      const { data: customersData } = await supabaseCustomers
        .from('customers')
        .select('id, full_name')
        .in('id', affectedCustomerIds)
      affectedCustomersById = Object.fromEntries((customersData || []).map(c => [c.id, c]))
    }
    const affectedReservations = affectedRaw.map(r => ({ ...r, customers: affectedCustomersById[r.customer_id] }))
    // table_blocks.table_id has a real FK to restaurant_tables -- these rows
    // must be cleared or the final delete fails outright, not just a nicety.
    const { data: affectedBlocks, error: blocksError } = await supabase
      .from('table_blocks')
      .select('id, block_date, reason')
      .eq('table_id', table.id)
      .order('block_date', { ascending: true })
    if (blocksError) { console.error('Failed to check affected blocks:', blocksError); return }
    setDeleteTableConfirm({ table, affectedReservations, affectedBlocks: affectedBlocks || [] })
  }

  async function confirmDeleteTable() {
    const { table, affectedReservations } = deleteTableConfirm
    // Close the dialog and play the explosion on the floor plan first, then
    // do the actual writes once the animation's had time to finish -- purely
    // cosmetic, doesn't change any of the cleanup logic below. The animation
    // holds its last frame (scale 0) once done, so explodingTableId must
    // clear even on failure below, or a table that didn't actually get
    // deleted would stay invisible -- hence the try/finally.
    setDeleteTableConfirm(null)
    setExplodingTableId(table.id)
    await new Promise(resolve => setTimeout(resolve, 350))

    try {
      // Each step below must actually succeed before the next runs -- a
      // table getting deleted while an unassign silently failed would leave
      // exactly the kind of dangling table_ids reference this whole confirm
      // flow exists to prevent. Abort rather than plow ahead on a failure.
      for (const r of affectedReservations) {
        const newIds = r.table_ids.filter(id => id !== table.id)
        const { error } = await supabase.from('reservations').update({ table_ids: newIds }).eq('id', r.id)
        if (error) { console.error('Failed to unassign reservation', r.id, error); return }
      }
      if (table.group_id) {
        // Disbands the merge -- the other member(s) physically still exist
        // and keep their own reservation assignments, only this table goes away.
        const { error: groupError } = await supabase.from('restaurant_tables')
          .update({ group_id: null, locked_until: null, locked_by_reservation: null })
          .eq('group_id', table.group_id)
        if (groupError) { console.error('Failed to disband group', table.group_id, groupError); return }
        const { error: deleteGroupError } = await supabase.from('table_groups').delete().eq('id', table.group_id)
        if (deleteGroupError) { console.error('Failed to delete table_groups row', table.group_id, deleteGroupError); return }
      } else {
        const { error } = await supabase.from('restaurant_tables')
          .update({ locked_until: null, locked_by_reservation: null })
          .eq('id', table.id)
        if (error) { console.error('Failed to release lock on', table.id, error); return }
      }
      const { error: blocksError } = await supabase.from('table_blocks').delete().eq('table_id', table.id)
      if (blocksError) { console.error('Failed to delete table_blocks for', table.id, blocksError); return }
      const { error: deleteError } = await supabase.from('restaurant_tables').delete().eq('id', table.id)
      if (deleteError) { console.error('Failed to delete table', table.id, deleteError); return }
      setSelected(null)
    } finally {
      setExplodingTableId(null)
      await fetchAll()
    }
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
    // Without this, a tap here (which never calls preventDefault upstream
    // for non-layout mode) leaves the browser free to synthesize a
    // compatibility click afterward, double-firing onTableClick and
    // silently cancelling out any toggle-style selection.
    e.preventDefault()
    // Layout mode already suppresses the synthetic click via onTouchStart's
    // own preventDefault, so dispatching here for a non-drag tap is the only
    // call onTableClick gets in that mode -- no double-fire risk like assign
    // mode had.
    if (!dragMoved.current && (mode === 'assign' || mode === 'layout')) {
      onTableClick(table)
    }
    setDragging(null)
  }

  function onTableClick(table) {
    if (multiSelectMode) {
      setMultiSelected(prev => {
        if (prev.includes(table.id)) return prev.filter(id => id !== table.id)
        // Already part of a different group -- adding it here would silently
        // overwrite its group_id, orphaning whichever table(s) it leaves
        // behind in that old group. Must be unmerged first (via the
        // single-table panel) before it can join a new one.
        if (table.group_id) return prev
        return [...prev, table.id]
      })
      return
    }
    if (assignTarget) {
      // Tables already assigned to this reservation aren't part of the new
      // selection — unassigning them is a separate action (the existing
      // "Unassign" button), not something this picker toggles.
      if (Array.isArray(assignTarget.table_ids) && assignTarget.table_ids.includes(table.id)) return
      setAssignSelected(prev =>
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
  const assignable = getAssignableReservations()
  const todayView = isToday(selectedDate)

  function cancelAssignMode() {
    setAssignTarget(null)
    setAssignSelected([])
  }

  const assignAlreadySeats = assignTarget ? getAssignedCapacity(assignTarget.id) : 0
  const assignNewSeats = assignSelected.reduce((sum, id) => sum + (tables.find(t => t.id === id)?.capacity || 0), 0)
  const assignRunningSeats = assignAlreadySeats + assignNewSeats

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
          <button onClick={() => { setMode(mode === 'assign' ? 'layout' : 'assign'); setSelected(null); setMultiSelectMode(false); setMultiSelected([]); setAssignTarget(null); setAssignSelected([]) }}
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
            style={{ cursor: dragging ? 'grabbing' : 'default', display: 'block', touchAction: mode === 'layout' ? 'none' : 'auto' }}
          >
            <style>{`
              .floor-table-shape { stroke: transparent; stroke-width: 2px; transition: stroke 0.15s ease; }
              .floor-table-shape:hover { stroke: #ffffff; }
              @keyframes tableExplode {
                0% { transform: scale(1); opacity: 1; }
                50% { transform: scale(1.4); opacity: 0.7; }
                100% { transform: scale(0); opacity: 0; }
              }
              .table-exploding { transform-box: fill-box; transform-origin: center; animation: tableExplode 350ms ease-in forwards; }
            `}</style>
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

            {(() => {
              // Recomputed each render from current data, not stored -- a small
              // ordinal per distinct group_id, only meaningful for telling two
              // simultaneously-active merge groups apart on the floor plan.
              const mergedGroupIds = [...new Set(tables.filter(t => t.group_id).map(t => t.group_id))].sort()
              const groupNumberById = new Map(mergedGroupIds.map((id, i) => [id, i + 1]))

              return tables.map(table => {
              const { w, h } = getTableSize(table)
              const assigned = getTableReservations(table.id)
              const status = statusByTable.get(table.id)
              const color = getTableColor(table, status)
              const label = getTableLabel(table, assigned, todayView)
              const isSelected = selected === table.id
              const isMultiSelected = multiSelected.includes(table.id)
              const isAssignSelected = assignSelected.includes(table.id)
              const isAssignedToTarget = !!assignTarget && Array.isArray(assignTarget.table_ids) && assignTarget.table_ids.includes(table.id)
              const isMerged = !!table.group_id
              const groupNumber = isMerged ? groupNumberById.get(table.group_id) : null
              const isExploding = explodingTableId === table.id

              const isBarStool = table.table_number?.startsWith('B') && table.table_number !== 'BT'

              return (
                <g key={table.id}
                  className={isExploding ? 'table-exploding' : undefined}
                  onClick={() => onTableClick(table)}
                  onMouseDown={e => onMouseDown(e, table)}
                  onTouchStart={e => onTouchStart(e, table)}
                  onTouchEnd={e => onTouchEnd(e, table)}
                  style={{ cursor: mode === 'layout' ? 'grab' : 'pointer', userSelect: 'none' }}>
                  {isBarStool ? (
                    <>
                      <circle
                        className="floor-table-shape"
                        cx={table.x_position + w / 2}
                        cy={table.y_position + h / 2}
                        r={w / 2}
                        fill={color}
                        style={{
                          stroke: isMultiSelected ? '#f59e0b' : isAssignSelected ? '#0891b2' : isSelected ? '#3b82f6' : isAssignedToTarget ? '#16a34a' : isMerged ? '#db2777' : undefined,
                          strokeWidth: (isMultiSelected || isAssignSelected || isSelected || isAssignedToTarget || isMerged) ? 2 : undefined
                        }}
                        opacity="0.9"
                      />
                      <text
                        x={table.x_position + w / 2}
                        y={table.y_position + h / 2}
                        textAnchor="middle" dominantBaseline="central"
                        fontSize="4" fill="white" fontWeight="600">
                        {label.line1}
                      </text>
                      {isMerged && (
                        <>
                          <circle
                            cx={table.x_position + w - 2}
                            cy={table.y_position + 2}
                            r="3"
                            fill="#db2777"
                          />
                          <text
                            x={table.x_position + w - 2}
                            y={table.y_position + 2}
                            textAnchor="middle" dominantBaseline="central"
                            fontSize="3.5" fill="white" fontWeight="700">
                            {groupNumber}
                          </text>
                        </>
                      )}
                    </>
                  ) : (
                    <>
                      <rect
                        className="floor-table-shape"
                        x={table.x_position} y={table.y_position}
                        width={w} height={h} rx="2"
                        fill={color}
                        style={{
                          stroke: isMultiSelected ? '#f59e0b' : isAssignSelected ? '#0891b2' : isSelected ? '#3b82f6' : isAssignedToTarget ? '#16a34a' : isMerged ? '#db2777' : undefined,
                          strokeWidth: (isMultiSelected || isAssignSelected || isSelected || isAssignedToTarget || isMerged) ? 2 : undefined
                        }}
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
                      {isMerged && (
                        <>
                          <circle
                            cx={table.x_position + w - 3}
                            cy={table.y_position + 3}
                            r="3.5"
                            fill="#db2777"
                          />
                          <text
                            x={table.x_position + w - 3}
                            y={table.y_position + 3}
                            textAnchor="middle" dominantBaseline="central"
                            fontSize="4" fill="white" fontWeight="700">
                            {groupNumber}
                          </text>
                        </>
                      )}
                    </>
                  )}
                  {isExploding && (
                    <text
                      x={table.x_position + w / 2}
                      y={table.y_position + h / 2}
                      textAnchor="middle" dominantBaseline="central"
                      fontSize="14"
                      style={{ pointerEvents: 'none' }}>
                      💥
                    </text>
                  )}
                </g>
              )
              })
            })()}
          </svg>
        </div>

        <div className="w-full md:w-[45%] border border-gray-200 rounded-xl p-4 md:p-5 overflow-y-auto max-h-[500px] md:max-h-[600px]">

          {mode === 'layout' && !selectedTable && !multiSelectMode && !newTableFormOpen && (
            <div className="space-y-4 mt-4">
              <button
                onClick={() => { setMultiSelectMode(true); setMultiSelected([]) }}
                className="w-full py-2 text-xs font-medium tracking-widest uppercase border border-gray-200 text-gray-600 hover:bg-gray-50 rounded-lg transition-colors">
                Select Multiple to Merge
              </button>
              <button
                onClick={() => setNewTableFormOpen(true)}
                className="w-full py-2 text-xs font-medium tracking-widest uppercase border border-gray-200 text-gray-600 hover:bg-gray-50 rounded-lg transition-colors">
                New Table
              </button>
              <div className="text-gray-400 text-sm text-center mt-4">
                <p>Drag tables to reposition.</p>
                <p className="mt-1">Click a table to edit it.</p>
              </div>
            </div>
          )}

          {mode === 'layout' && newTableFormOpen && (
            <div className="space-y-3 mt-4">
              <div className="flex justify-between items-center">
                <h3 className="font-bold text-base">New Table</h3>
                <button
                  onClick={() => { setNewTableFormOpen(false); setNewTableForm({ table_number: '', capacity: '2' }) }}
                  className="text-xs text-gray-400 hover:text-gray-700">
                  Cancel
                </button>
              </div>
              <p className="text-xs text-gray-400">
                Creates a temporary table for overflow seating -- placed at a default spot, drag it into place after. Delete it later once no longer needed.
              </p>
              <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Table Name</p>
              <input type="text" value={newTableForm.table_number}
                onChange={e => setNewTableForm(f => ({ ...f, table_number: e.target.value }))}
                placeholder="e.g. Overflow 1"
                className="w-full border-b border-gray-200 bg-transparent py-2 text-sm text-gray-800 focus:outline-none focus:border-gray-800 mb-4" />
              <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Capacity</p>
              <input type="number" min="1" value={newTableForm.capacity}
                onChange={e => setNewTableForm(f => ({ ...f, capacity: e.target.value }))}
                className="w-full border-b border-gray-200 bg-transparent py-2 text-sm text-gray-800 focus:outline-none focus:border-gray-800 mb-4" />
              <button
                disabled={!newTableForm.table_number.trim()}
                onClick={createTable}
                className="w-full py-2.5 text-xs font-medium tracking-widest uppercase text-white rounded-lg transition-opacity hover:opacity-90 disabled:opacity-40"
                style={{ backgroundColor: '#E8420A' }}>
                Create Table
              </button>
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
              {selectedTable.is_temporary && (
                <button
                  onClick={() => openDeleteTableConfirm(selectedTable)}
                  className="w-full py-2 mt-4 text-xs font-medium tracking-widest uppercase border border-red-300 text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                  Delete Table
                </button>
              )}
            </>
          )}

          {mode === 'assign' && !selectedTable && !assignTarget && (
            <>
              <h3 className="font-bold text-base mb-3">Reservations {todayView ? 'Today' : 'This Date'}</h3>
              {reservations.length === 0 ? (
                <p className="text-gray-400 text-sm">No reservations {todayView ? 'today' : 'on this date'}.</p>
              ) : (
                reservations.map(r => {
                  const tableLabel = getReservationTableLabel(r)
                  return (
                    <div key={r.id}
                      onClick={() => onReservationRowClick(r)}
                      className={`border border-gray-200 rounded-lg p-3 mb-2 transition-colors cursor-pointer hover:border-black ${isFullySeated(r) ? 'opacity-50' : ''}`}>
                      <p className="font-semibold text-sm">{r.customers?.full_name}{getReservationIcons(r)}</p>
                      <p className="text-xs text-gray-500">{r.reservation_time} · {r.guest_count} guests</p>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium mt-1 inline-block ${r.status === 'confirmed' ? 'bg-blue-100 text-blue-800' : 'bg-yellow-100 text-yellow-800'}`}>
                        {r.status}
                      </span>
                      {r.needs_manual_assignment && (
                        <span className="text-xs px-2 py-0.5 rounded-full font-medium mt-1 ml-1 inline-block bg-amber-100 text-amber-700">
                          ⚠️ Needs Table
                        </span>
                      )}
                      <p className="text-xs mt-0.5 font-medium" style={{ color: tableLabel ? '#16a34a' : '#9ca3af' }}>
                        {tableLabel ? `Table ${tableLabel}` : 'Unassigned'}
                      </p>
                    </div>
                  )
                })
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

          {mode === 'assign' && !selectedTable && assignTarget && (
            <div className="space-y-3 mt-1">
              <div className="flex justify-between items-center">
                <h3 className="font-bold text-base">Assign Tables</h3>
                <button onClick={cancelAssignMode} className="text-xs text-gray-400 hover:text-gray-700">
                  Cancel
                </button>
              </div>
              <div className="border border-gray-200 rounded-lg p-3">
                <p className="font-semibold text-sm">{assignTarget.customers?.full_name}{getReservationIcons(assignTarget)}</p>
                <p className="text-xs text-gray-500">{assignTarget.reservation_time} · {assignTarget.guest_count} guests</p>
              </div>
              <p className="text-sm font-medium" style={{ color: assignRunningSeats >= assignTarget.guest_count ? '#16a34a' : '#ca8a04' }}>
                {assignRunningSeats} / {assignTarget.guest_count} seats selected
              </p>
              <p className="text-xs text-gray-400">Tap free tables on the floor plan to add them.</p>
              {assignSelected.length > 0 && (
                <p className="text-xs text-gray-500">
                  Adding: {assignSelected.map(id => tables.find(t => t.id === id)?.table_number).filter(Boolean).join(', ')}
                </p>
              )}
              <button
                disabled={assignSelected.length === 0}
                onClick={() => assignTable(assignSelected, assignTarget.id)}
                className="w-full py-2.5 text-xs font-medium tracking-widest uppercase text-white rounded-lg transition-opacity hover:opacity-90 disabled:opacity-40"
                style={{ backgroundColor: '#E8420A' }}>
                Confirm Assignment
              </button>
            </div>
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
              {assignable.length === 0 ? (
                <p className="text-gray-400 text-sm">All reservations are fully seated {todayView ? 'today' : 'on this date'}.</p>
              ) : (
                assignable.map(r => (
                  <div key={r.id}
                    className="border border-gray-200 rounded-lg p-3 mb-2 cursor-pointer hover:border-black transition-colors"
                    onClick={() => assignTable([selectedTable.id], r.id)}>
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

      {deleteTableConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl max-h-[80vh] overflow-y-auto">
            <h3 className="font-bold text-lg mb-2">Delete {deleteTableConfirm.table.table_number}?</h3>
            {deleteTableConfirm.affectedReservations.length === 0 && deleteTableConfirm.affectedBlocks.length === 0 ? (
              <p className="text-gray-600 text-sm mb-6">No reservations or blocks are currently assigned to this table.</p>
            ) : (
              <>
                <p className="text-gray-600 text-sm mb-3">This will unassign the following before deleting:</p>
                {deleteTableConfirm.affectedReservations.length > 0 && (
                  <div className="mb-4">
                    <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Reservations</p>
                    {deleteTableConfirm.affectedReservations.map(r => (
                      <div key={r.id} className="border border-gray-200 rounded-lg p-2 mb-2 text-sm">
                        <p className="font-medium">{r.customers?.full_name || 'Unknown'}</p>
                        <p className="text-xs text-gray-500">{formatDisplayDate(r.reservation_date)} · {r.reservation_time} · {r.guest_count} guests</p>
                      </div>
                    ))}
                  </div>
                )}
                {deleteTableConfirm.affectedBlocks.length > 0 && (
                  <div className="mb-4">
                    <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Blocks</p>
                    {deleteTableConfirm.affectedBlocks.map(b => (
                      <div key={b.id} className="border border-gray-200 rounded-lg p-2 mb-2 text-sm">
                        <p className="font-medium">{formatDisplayDate(b.block_date)}</p>
                        {b.reason && <p className="text-xs text-gray-500">{b.reason}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
            <div className="flex gap-3 mt-2">
              <button onClick={() => setDeleteTableConfirm(null)}
                className="flex-1 py-2 rounded-lg border border-gray-300 text-sm font-medium hover:bg-gray-50">
                Cancel
              </button>
              <button onClick={confirmDeleteTable}
                className="flex-1 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700">
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-xs px-4 py-2 rounded-full z-50 shadow-lg">
          {toast}
        </div>
      )}
    </div>
  )
}
