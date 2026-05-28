import { useState, useRef, useEffect } from 'react'
import { supabase } from '../../supabase'

const FLOOR_POINTS = [
  [30, 80], [30, 320], [370, 320], [370, 30],
  [130, 30], [130, 80]
]
const ENTRANCE = { x: 370, y: 60 }

function getTableSize(table) {
  if (table.table_number === 'Big Table') {
    return table.rotated ? { w: 18, h: 32 } : { w: 32, h: 18 }
  }
  if (table.table_number?.startsWith('B') && table.table_number !== 'Big Table') {
    return { w: 12, h: 12 }
  }
  return table.rotated ? { w: 16, h: 20 } : { w: 20, h: 16 }
}

function getTableColor(table, assignedReservations) {
  if (!table.is_bookable) return '#9ca3af'
  if (table.locked_until && new Date(table.locked_until) > new Date()) return '#7c3aed'
  if (table.table_number === 'Big Table') {
    if (assignedReservations.some(r => r.status === 'seated')) return '#16a34a'
    if (assignedReservations.length > 0) return '#ca8a04'
    return '#1B3A6B'
  }
  if (table.table_number?.startsWith('B') && table.table_number !== 'Big Table') {
    if (assignedReservations.some(r => r.status === 'seated')) return '#16a34a'
    if (assignedReservations.length > 0) return '#ca8a04'
    return '#1B3A6B'
  }
  if (assignedReservations.some(r => r.status === 'seated')) return '#16a34a'
  if (assignedReservations.length > 0) return '#ca8a04'
  return '#E8420A'
}

function getTableLabel(table, assignedReservations) {
  const now = new Date()
  const currentMins = now.getHours() * 60 + now.getMinutes()

  const seated = assignedReservations.find(r => r.status === 'seated')
  if (seated) {
    const name = seated.customers?.full_name?.split(' ')[0] || '?'
    return { line1: name, line2: 'Seated' }
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
    return { line1: name, line2: time }
  }

  return { line1: table.table_number, line2: null }
}

function checkTimeConflict(existingReservations, newReservation) {
  const [newH, newM] = newReservation.reservation_time.split(':').map(Number)
  const newMins = newH * 60 + newM
  for (const r of existingReservations) {
    const [h, m] = r.reservation_time.split(':').map(Number)
    const existMins = h * 60 + m
    const diff = Math.abs(newMins - existMins)
    if (diff < 120) return { conflict: true, reservation: r, diff }
  }
  return { conflict: false }
}

const DEFAULT_TABLES = [
  ...Array.from({ length: 12 }, (_, i) => ({
    id: `table-${i + 1}`,
    table_number: `T${i + 1}`,
    capacity: 2,
    x_position: 50 + (i % 4) * 55,
    y_position: 180 + Math.floor(i / 4) * 45,
    is_bookable: true,
    rotated: false,
  })),
  {
    id: 'table-big',
    table_number: 'Big Table',
    capacity: 8,
    x_position: 260,
    y_position: 180,
    is_bookable: true,
    rotated: false,
  },
  {
    id: 'bar-1',
    table_number: 'Bar 1',
    capacity: 2,
    x_position: 85,
    y_position: 148,
    is_bookable: true,
    rotated: false,
  },
  {
    id: 'bar-2',
    table_number: 'Bar 2',
    capacity: 2,
    x_position: 115,
    y_position: 148,
    is_bookable: true,
    rotated: false,
  },
  {
    id: 'bar-3',
    table_number: 'Bar 3',
    capacity: 2,
    x_position: 145,
    y_position: 148,
    is_bookable: true,
    rotated: false,
  },
  {
    id: 'bar-4',
    table_number: 'Bar 4',
    capacity: 2,
    x_position: 175,
    y_position: 148,
    is_bookable: true,
    rotated: false,
  },
]

export default function Tables() {
  const [tables, setTables] = useState([])
  const [reservations, setReservations] = useState([])
  const [selected, setSelected] = useState(null)
  const [dragging, setDragging] = useState(null)
  const [saved, setSaved] = useState(false)
  const [mode, setMode] = useState('assign')
  const [confirmModal, setConfirmModal] = useState(null)
  const svgRef = useRef(null)
  const dragOffset = useRef({ x: 0, y: 0 })
  const dragMoved = useRef(false)

  const today = new Date().toISOString().split('T')[0]

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    const [{ data: tableData }, { data: resData }] = await Promise.all([
      supabase.from('restaurant_tables').select('*'),
      supabase.from('reservations')
        .select('*, customers(full_name, phone, email)')
        .eq('reservation_date', today)
        .in('status', ['confirmed', 'pending', 'seated'])
        .order('reservation_time', { ascending: true })
    ])
    setTables((tableData || []).map(t => ({ ...t, rotated: t.rotated || false })))
    setReservations(resData || [])
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

  function isTableLocked(table) {
    if (!table.locked_until) return false
    return new Date(table.locked_until) > new Date()
  }

  async function assignTable(tableId, reservationId) {
    const reservation = reservations.find(r => r.id === reservationId)
    const tableReservations = getTableReservations(tableId)
    const conflict = checkTimeConflict(tableReservations, reservation)

    if (conflict.conflict) {
      setConfirmModal({
        message: `This table already has a reservation within 2 hours of ${reservation.reservation_time}. The previous party may still be dining. Assign anyway?`,
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
    const lockUntil = new Date(lockFrom.getTime() + 2 * 60 * 60 * 1000)
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
    setSelected(selected === table.id ? null : table.id)
  }

  const selectedTable = tables.find(t => t.id === selected)
  const selectedTableReservations = selected ? getTableReservations(selected) : []
  const unassigned = getUnassignedReservations()

  return (
    <div className="min-h-screen p-4 md:p-6">
      <div className="flex justify-between items-center mb-4 sticky top-0 bg-white z-10 py-2">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Floor Plan</h1>
          <p className="text-gray-500 text-sm">
            {mode === 'assign'
              ? `Today — ${new Date().toLocaleDateString('en-MY', { weekday: 'long', day: 'numeric', month: 'long' })}`
              : 'Drag tables to reposition'}
          </p>
        </div>
        <div className="flex gap-2 md:gap-3">
          <button onClick={() => { setMode(mode === 'assign' ? 'layout' : 'assign'); setSelected(null) }}
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
              const color = getTableColor(table, assigned)
              const label = getTableLabel(table, assigned)
              const isSelected = selected === table.id

              const isBarStool = table.table_number?.startsWith('B') && table.table_number !== 'Big Table'

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
                        stroke={isSelected ? '#3b82f6' : 'transparent'}
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
                        stroke={isSelected ? '#3b82f6' : 'transparent'}
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

          {mode === 'layout' && !selectedTable && (
            <div className="text-gray-400 text-sm text-center mt-8">
              <p>Drag tables to reposition.</p>
              <p className="mt-1">Click a table to edit it.</p>
            </div>
          )}

          {mode === 'layout' && selectedTable && (
            <>
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-bold text-base">{selectedTable.table_number}</h3>
                <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-black text-sm">✕</button>
              </div>
              <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Table Name</p>
              <input type="text" value={selectedTable.table_number}
                onChange={e => setTables(prev => prev.map(t => t.id === selected ? { ...t, table_number: e.target.value } : t))}
                className="w-full border-b border-gray-200 bg-transparent py-2 text-sm text-gray-800 focus:outline-none focus:border-gray-800 mb-4" />
              <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Capacity</p>
              <input type="number" value={selectedTable.capacity}
                onChange={e => setTables(prev => prev.map(t => t.id === selected ? { ...t, capacity: parseInt(e.target.value) } : t))}
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
              <h3 className="font-bold text-base mb-3">Unassigned Today</h3>
              {unassigned.length === 0 ? (
                <p className="text-gray-400 text-sm">All reservations are assigned.</p>
              ) : (
                unassigned.map(r => (
                  <div key={r.id} className="border border-gray-200 rounded-lg p-3 mb-2">
                    <p className="font-semibold text-sm">{r.customers?.full_name}</p>
                    <p className="text-xs text-gray-500">{r.reservation_time} · {r.guest_count} guests</p>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium mt-1 inline-block ${r.status === 'confirmed' ? 'bg-blue-100 text-blue-800' : 'bg-yellow-100 text-yellow-800'}`}>
                      {r.status}
                    </span>
                  </div>
                ))
              )}
              <div className="mt-6 pt-4 border-t border-gray-100">
                <p className="text-xs text-gray-400 mb-2">Legend</p>
                <div className="flex flex-col gap-2 text-xs text-gray-500">
                  <span className="flex items-center gap-2"><span className="w-3 h-3 rounded inline-block" style={{ backgroundColor: '#E8420A' }}></span> Free</span>
                  <span className="flex items-center gap-2"><span className="w-3 h-3 rounded bg-yellow-600 inline-block"></span> Reserved</span>
                  <span className="flex items-center gap-2"><span className="w-3 h-3 rounded bg-green-600 inline-block"></span> Seated</span>
                  <span className="flex items-center gap-2"><span className="w-3 h-3 rounded bg-gray-400 inline-block"></span> Blocked</span>
                  <span className="flex items-center gap-2"><span className="w-3 h-3 rounded bg-purple-700 inline-block"></span> Locked</span>
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
                <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-black text-sm">✕ Close</button>
              </div>

              {selectedTableReservations.length > 0 && (
                <div className="mb-4">
                  <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Assigned</p>
                  {selectedTableReservations.map(r => (
                    <div key={r.id} className="border border-gray-200 rounded-lg p-3 mb-2">
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="font-semibold text-sm">{r.customers?.full_name}</p>
                          <p className="text-xs text-gray-500">{r.reservation_time} · {r.guest_count} guests</p>
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
                <p className="text-gray-400 text-sm">No unassigned reservations today.</p>
              ) : (
                unassigned.map(r => (
                  <div key={r.id}
                    className="border border-gray-200 rounded-lg p-3 mb-2 cursor-pointer hover:border-black transition-colors"
                    onClick={() => assignTable(selectedTable.id, r.id)}>
                    <p className="font-semibold text-sm">{r.customers?.full_name}</p>
                    <p className="text-xs text-gray-500">{r.reservation_time} · {r.guest_count} guests</p>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium mt-1 inline-block ${r.status === 'confirmed' ? 'bg-blue-100 text-blue-800' : 'bg-yellow-100 text-yellow-800'}`}>
                      {r.status}
                    </span>
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
