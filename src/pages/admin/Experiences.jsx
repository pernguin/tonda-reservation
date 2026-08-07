import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../supabase'
import { getTableStatusForDate, getLocalToday } from '../../lib/tableAvailability'
import { generateSeriesDates, dateRange } from '../../lib/experienceSeries'

const BRAND = '#8B1A1A'

const inputClass = "w-full border-b border-gray-300 bg-transparent py-3 text-sm text-gray-800 focus:outline-none focus:border-gray-800 transition-colors placeholder-gray-400"
const labelClass = "block text-xs tracking-widest uppercase mb-1 text-gray-500"

const emptyForm = {
  name: '', date: '', time: '', end_date: '', end_time: '',
  description: '', price: '', poster_url: '', status: 'draft',
  recurring: false, cadence: 'weekly', interval: '1', occurrences: ''
}

function buildBlockRows(exp, tableId, registrationId) {
  const dates = exp.end_date && exp.end_date !== exp.date ? dateRange(exp.date, exp.end_date) : [exp.date]
  return dates.map((d, i) => {
    const isFirst = i === 0
    const isLast = i === dates.length - 1
    let start_time = null
    let end_time = null
    if (dates.length === 1) {
      start_time = exp.time
      end_time = exp.end_time || null
    } else if (isFirst) {
      start_time = exp.time
      end_time = null
    } else if (isLast) {
      start_time = null
      end_time = exp.end_time || null
    }
    return {
      table_id: tableId,
      block_date: d,
      start_time,
      end_time,
      reason: exp.name,
      source_type: 'experience',
      source_id: registrationId
    }
  })
}

export default function Experiences() {
  const [experiences, setExperiences] = useState([])
  const [registrationCounts, setRegistrationCounts] = useState({})
  const [restaurantTables, setRestaurantTables] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [seriesNotice, setSeriesNotice] = useState(null)
  const [viewingRegs, setViewingRegs] = useState(null)
  const [registrations, setRegistrations] = useState([])
  const [tableStatus, setTableStatus] = useState([])
  const [spanFreeTableIds, setSpanFreeTableIds] = useState(new Set())
  const [assigningFor, setAssigningFor] = useState(null)
  const [posterError, setPosterError] = useState(null)
  const [posterFileName, setPosterFileName] = useState(null)
  const posterInputRef = useRef(null)

  const MAX_POSTER_SIZE = 5 * 1024 * 1024

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    setLoading(true)
    const [{ data: exps }, { data: regs }, { data: tables }] = await Promise.all([
      supabase.from('experiences').select('*').order('date', { ascending: true }),
      supabase.from('experience_registrations').select('experience_id'),
      supabase.from('restaurant_tables').select('id, table_number')
    ])
    const counts = {}
    ;(regs || []).forEach(r => { counts[r.experience_id] = (counts[r.experience_id] || 0) + 1 })
    setExperiences(exps || [])
    setRegistrationCounts(counts)
    setRestaurantTables(tables || [])
    setLoading(false)
  }

  function handleChange(e) {
    const { name, value, type, checked } = e.target
    setForm(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }))
  }

  async function handlePosterUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setPosterError(null)
    if (file.size > MAX_POSTER_SIZE) {
      setPosterError('Poster image must be under 5MB')
      setPosterFileName(null)
      e.target.value = ''
      return
    }
    setPosterFileName(file.name)
    setUploading(true)
    const fileExt = file.name.split('.').pop()
    const fileName = `${crypto.randomUUID()}.${fileExt}`
    const { error } = await supabase.storage.from('event-posters').upload(fileName, file, {
      cacheControl: '3600',
      upsert: true
    })
    if (!error) {
      const { data } = supabase.storage.from('event-posters').getPublicUrl(fileName)
      setForm(prev => ({ ...prev, poster_url: data.publicUrl }))
    }
    setUploading(false)
  }

  function openNewForm() {
    setForm(emptyForm)
    setEditingId(null)
    setShowForm(true)
    setViewingRegs(null)
    setPosterError(null)
    setPosterFileName(null)
  }

  function openEditForm(exp) {
    setForm({
      name: exp.name,
      date: exp.date,
      time: exp.time?.slice(0, 5) || '',
      end_date: exp.end_date || '',
      end_time: exp.end_time?.slice(0, 5) || '',
      description: exp.description || '',
      price: exp.price ?? '',
      poster_url: exp.poster_url || '',
      status: exp.status,
      recurring: false, cadence: 'weekly', interval: '1', occurrences: ''
    })
    setEditingId(exp.id)
    setShowForm(true)
    setViewingRegs(null)
    setPosterError(null)
    setPosterFileName(null)
  }

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true)
    setSeriesNotice(null)

    const basePayload = {
      name: form.name,
      time: form.time,
      end_time: form.end_time || null,
      description: form.description || null,
      price: form.price === '' ? null : parseFloat(form.price),
      poster_url: form.poster_url || null,
      status: form.status
    }

    if (editingId) {
      await supabase.from('experiences').update({
        ...basePayload,
        date: form.date,
        end_date: form.end_date || null
      }).eq('id', editingId)
    } else if (form.recurring) {
      const { dates, skipped } = generateSeriesDates({
        startDate: form.date,
        endDate: form.end_date || null,
        cadence: form.cadence,
        interval: parseInt(form.interval) || 1,
        occurrences: parseInt(form.occurrences) || 1
      })
      const seriesId = crypto.randomUUID()
      const rows = dates.map(d => ({
        ...basePayload,
        date: d.date,
        end_date: d.endDate,
        series_id: seriesId
      }))
      const { error } = await supabase.from('experiences').insert(rows)
      if (error) {
        console.error('Failed to create series:', error)
        setSeriesNotice(`Failed to create series: ${error.message}`)
      } else {
        let notice = `Created ${rows.length} experience${rows.length > 1 ? 's' : ''} in this series.`
        if (skipped.length > 0) {
          notice += ` ${skipped.length} occurrence${skipped.length > 1 ? 's were' : ' was'} skipped: ${skipped.join('; ')}.`
        }
        setSeriesNotice(notice)
      }
    } else {
      await supabase.from('experiences').insert([{
        ...basePayload,
        date: form.date,
        end_date: form.end_date || null
      }])
    }

    setSaving(false)
    setShowForm(false)
    fetchAll()
  }

  async function handleDelete(id) {
    if (!confirm('Delete this experience? This will also delete its registrations.')) return
    const { data: regs } = await supabase.from('experience_registrations').select('id').eq('experience_id', id)
    const regIds = (regs || []).map(r => r.id)
    if (regIds.length > 0) {
      await supabase.from('table_blocks').delete().eq('source_type', 'experience').in('source_id', regIds)
    }
    await supabase.from('experiences').delete().eq('id', id)
    fetchAll()
  }

  async function deleteRemainingOccurrences(seriesId) {
    const today = getLocalToday()
    const { data: futureExps } = await supabase
      .from('experiences')
      .select('id')
      .eq('series_id', seriesId)
      .gte('date', today)
    const expIds = (futureExps || []).map(e => e.id)
    if (expIds.length === 0) { alert('No future occurrences to delete.'); return }

    const { data: regs } = await supabase
      .from('experience_registrations')
      .select('id, experience_id')
      .in('experience_id', expIds)
    const regIds = (regs || []).map(r => r.id)
    const occurrencesWithRegs = new Set((regs || []).map(r => r.experience_id)).size

    let message = `Delete ${expIds.length} remaining occurrence${expIds.length > 1 ? 's' : ''} in this series?`
    if (occurrencesWithRegs > 0) {
      message += ` ${occurrencesWithRegs} of these occurrences have registrations — deleting will remove those too.`
    }
    if (!confirm(message)) return

    if (regIds.length > 0) {
      await supabase.from('table_blocks').delete().eq('source_type', 'experience').in('source_id', regIds)
    }
    await supabase.from('experiences').delete().in('id', expIds)
    setViewingRegs(null)
    fetchAll()
  }

  async function computeSpanFreeTableIds(exp) {
    const dates = exp.end_date && exp.end_date !== exp.date ? dateRange(exp.date, exp.end_date) : [exp.date]
    const statusLists = await Promise.all(dates.map(d => getTableStatusForDate(d)))
    if (statusLists.length === 0 || !statusLists[0]) return new Set()
    const freeSets = statusLists.map(list => new Set(list.filter(s => s.status === 'free').map(s => s.table_id)))
    const allIds = statusLists[0].map(s => s.table_id)
    return new Set(allIds.filter(id => freeSets.every(set => set.has(id))))
  }

  async function loadTableDataFor(exp) {
    const statusList = await getTableStatusForDate(exp.date)
    setTableStatus(statusList)
    const freeIds = await computeSpanFreeTableIds(exp)
    setSpanFreeTableIds(freeIds)
  }

  async function openRegistrations(exp) {
    setShowForm(false)
    setViewingRegs(exp)
    setAssigningFor(null)
    const { data } = await supabase
      .from('experience_registrations')
      .select('*')
      .eq('experience_id', exp.id)
      .order('created_at', { ascending: false })
    setRegistrations(data || [])
    await loadTableDataFor(exp)
  }

  async function refreshTableStatus() {
    if (!viewingRegs) return
    await loadTableDataFor(viewingRegs)
  }

  async function assignTableToRegistration(registrationId, tableId) {
    const rows = buildBlockRows(viewingRegs, tableId, registrationId)
    const { error } = await supabase.from('table_blocks').insert(rows)
    if (error) { console.error('Failed to assign table:', error); return }
    setAssigningFor(null)
    await refreshTableStatus()
  }

  async function unassignTableBlock(registrationId, tableId) {
    const { error } = await supabase
      .from('table_blocks')
      .delete()
      .eq('source_type', 'experience')
      .eq('source_id', registrationId)
      .eq('table_id', tableId)
    if (error) { console.error('Failed to unassign table:', error); return }
    await refreshTableStatus()
  }

  const tablesById = new Map(restaurantTables.map(t => [t.id, t]))

  function getAssignedTables(registrationId) {
    return tableStatus.filter(s => s.source_type === 'experience' && s.source_id === registrationId)
  }

  const freeTablesForDate = tableStatus.filter(s => spanFreeTableIds.has(s.table_id))

  const today = getLocalToday()
  const upcoming = experiences.filter(e => e.date >= today)
  const past = experiences.filter(e => e.date < today)

  function formatPrice(price) {
    return price == null ? 'Free' : `RM ${Number(price).toFixed(2)}`
  }

  function formatDateRange(exp) {
    if (exp.end_date && exp.end_date !== exp.date) return `${exp.date} – ${exp.end_date}`
    return exp.date
  }

  function StatusBadge({ status }) {
    return (
      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
        status === 'published' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'
      }`}>
        {status}
      </span>
    )
  }

  function ExperienceRow({ exp }) {
    return (
      <div className="flex items-center gap-4 py-3 border-b border-gray-100">
        <div className="w-14 h-14 rounded bg-gray-100 shrink-0 overflow-hidden flex items-center justify-center">
          {exp.poster_url
            ? <img src={exp.poster_url} alt={exp.name} className="w-full h-full object-cover" />
            : <span className="text-gray-300 text-xs">No image</span>}
        </div>
        <div className="flex-1 min-w-0 cursor-pointer" onClick={() => openRegistrations(exp)}>
          <p className="text-sm font-medium text-gray-900 truncate">{exp.name}</p>
          <p className="text-xs text-gray-400">{formatDateRange(exp)} · {exp.time?.slice(0, 5)} · {formatPrice(exp.price)}</p>
        </div>
        <div className="text-xs text-gray-500 shrink-0 cursor-pointer" onClick={() => openRegistrations(exp)}>
          {registrationCounts[exp.id] || 0} registered
        </div>
        <div className="shrink-0 flex items-center gap-2">
          {exp.series_id && (
            <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-purple-100 text-purple-700">Part of a series</span>
          )}
          <StatusBadge status={exp.status} />
        </div>
        <div className="flex gap-3 shrink-0">
          <button onClick={() => openEditForm(exp)}
            className="text-xs font-medium tracking-wide text-blue-600 hover:text-blue-800 transition-colors">
            Edit
          </button>
          {exp.series_id && (
            <button onClick={() => deleteRemainingOccurrences(exp.series_id)}
              className="text-xs font-medium tracking-wide text-purple-600 hover:text-purple-800 transition-colors">
              Delete Series
            </button>
          )}
          <button onClick={() => handleDelete(exp.id)}
            className="text-xs font-medium tracking-wide text-red-400 hover:text-red-600 transition-colors">
            Delete
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-white p-8 max-w-3xl mx-auto">
      <div className="flex justify-between items-start mb-6">
        <div>
          <p className="text-xs tracking-widest uppercase mb-1" style={{ color: BRAND }}>Admin</p>
          <h1 className="text-3xl font-light text-gray-900">Experiences</h1>
        </div>
        <button onClick={openNewForm}
          className="px-6 py-3 text-sm font-medium tracking-widest uppercase text-white transition-opacity hover:opacity-90"
          style={{ backgroundColor: BRAND }}>
          New Experience
        </button>
      </div>

      {seriesNotice && (
        <div className="border-l-2 pl-4 mb-8 py-2 flex justify-between items-start gap-4" style={{ borderColor: BRAND }}>
          <p className="text-sm text-gray-700">{seriesNotice}</p>
          <button onClick={() => setSeriesNotice(null)}
            className="text-xs tracking-widest uppercase text-gray-400 hover:text-gray-600 transition-colors shrink-0">
            Dismiss
          </button>
        </div>
      )}

      {showForm && (
        <form onSubmit={handleSave} className="border border-gray-200 rounded-xl p-6 mb-8 space-y-6">
          <h2 className="text-lg font-medium text-gray-900">{editingId ? 'Edit Experience' : 'New Experience'}</h2>

          <div>
            <label className={labelClass}>Name *</label>
            <input name="name" value={form.name} onChange={handleChange} required
              placeholder="DJ Night"
              className={inputClass} />
          </div>

          <div className="grid grid-cols-2 gap-6">
            <div>
              <label className={labelClass}>Date *</label>
              <input name="date" type="date" value={form.date} onChange={handleChange} required
                className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Time *</label>
              <input name="time" type="time" value={form.time} onChange={handleChange} required
                className={inputClass} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-6">
            <div>
              <label className={labelClass}>End Date (optional)</label>
              <input name="end_date" type="date" value={form.end_date} onChange={handleChange}
                min={form.date || undefined}
                className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>End Time (optional)</label>
              <input name="end_time" type="time" value={form.end_time} onChange={handleChange}
                className={inputClass} />
            </div>
          </div>

          <div>
            <label className={labelClass}>Description</label>
            <textarea name="description" value={form.description} onChange={handleChange} rows={3}
              placeholder="Tell customers what to expect..."
              className={inputClass + ' resize-none'} />
          </div>

          <div className="grid grid-cols-2 gap-6">
            <div>
              <label className={labelClass}>Price (leave blank for free)</label>
              <input name="price" type="number" min="0" step="0.01" value={form.price} onChange={handleChange}
                placeholder="e.g. 88.00"
                className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Status</label>
              <select name="status" value={form.status} onChange={handleChange} className={inputClass}>
                <option value="draft">Draft</option>
                <option value="published">Published</option>
              </select>
            </div>
          </div>

          <div>
            <label className={labelClass}>Poster</label>
            <input ref={posterInputRef} type="file" accept="image/*" onChange={handlePosterUpload}
              className="hidden" />
            <button type="button" onClick={() => posterInputRef.current?.click()} disabled={uploading}
              className="px-6 py-2 text-xs font-medium tracking-widest uppercase border border-gray-200 text-gray-600 hover:bg-gray-50 rounded-lg transition-colors disabled:opacity-50">
              {uploading ? 'Uploading...' : form.poster_url ? 'Change Poster' : 'Upload Poster'}
            </button>
            {posterFileName && !posterError && (
              <p className="text-xs text-gray-400 mt-2">{posterFileName}</p>
            )}
            {posterError && <p className="text-xs mt-2" style={{ color: BRAND }}>{posterError}</p>}
            {form.poster_url && (
              <img src={form.poster_url} alt="Poster preview" className="mt-3 w-32 h-32 object-cover rounded" />
            )}
          </div>

          {!editingId && (
            <div className="border-t border-gray-100 pt-6">
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer mb-4">
                <input type="checkbox" name="recurring" checked={form.recurring} onChange={handleChange}
                  className="w-4 h-4" />
                Make this a recurring series
              </label>
              {form.recurring && (
                <div className="grid grid-cols-3 gap-6">
                  <div>
                    <label className={labelClass}>Cadence</label>
                    <select name="cadence" value={form.cadence} onChange={handleChange} className={inputClass}>
                      <option value="weekly">Weekly</option>
                      <option value="monthly">Monthly</option>
                    </select>
                  </div>
                  <div>
                    <label className={labelClass}>Every N {form.cadence === 'weekly' ? 'week(s)' : 'month(s)'}</label>
                    <input name="interval" type="number" min="1" value={form.interval} onChange={handleChange}
                      className={inputClass} />
                  </div>
                  <div>
                    <label className={labelClass}>Number of Occurrences</label>
                    <input name="occurrences" type="number" min="1" value={form.occurrences} onChange={handleChange}
                      required={form.recurring}
                      className={inputClass} />
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="flex gap-4">
            <button type="submit" disabled={saving || uploading}
              className="px-8 py-3 text-sm font-medium tracking-widest uppercase text-white transition-opacity hover:opacity-90 disabled:opacity-40"
              style={{ backgroundColor: BRAND }}>
              {saving ? 'Saving...' : 'Save'}
            </button>
            <button type="button" onClick={() => setShowForm(false)}
              className="px-8 py-3 text-sm font-medium tracking-widest uppercase text-gray-400 hover:text-gray-600 transition-colors">
              Cancel
            </button>
          </div>
        </form>
      )}

      {viewingRegs && (
        <div className="border border-gray-200 rounded-xl p-6 mb-8">
          <div className="flex justify-between items-start mb-4">
            <div>
              <p className="text-xs tracking-widest uppercase text-gray-400 mb-1">Registrations</p>
              <h2 className="text-lg font-medium text-gray-900">{viewingRegs.name}</h2>
              <p className="text-xs text-gray-400">{formatDateRange(viewingRegs)} · {viewingRegs.time?.slice(0, 5)}</p>
            </div>
            <button onClick={() => setViewingRegs(null)}
              className="text-xs tracking-widest uppercase text-gray-400 hover:text-gray-600 transition-colors">
              Close
            </button>
          </div>
          {registrations.length === 0 ? (
            <p className="text-gray-400 text-sm text-center py-6">No registrations yet.</p>
          ) : (
            <div className="space-y-1">
              <div className="flex items-center gap-4 py-2 border-b border-gray-200 mb-1">
                <div className="flex-1 text-xs tracking-widest uppercase text-gray-400">Name</div>
                <div className="w-32 text-xs tracking-widest uppercase text-gray-400">Phone</div>
                <div className="w-12 text-xs tracking-widest uppercase text-gray-400 text-right">Pax</div>
                <div className="w-28 text-xs tracking-widest uppercase text-gray-400 text-right">Registered</div>
              </div>
              {registrations.map(r => {
                const assignedTables = getAssignedTables(r.id)
                return (
                  <div key={r.id} className="border-b border-gray-100 py-2">
                    <div className="flex items-center gap-4">
                      <div className="flex-1 min-w-0 text-sm text-gray-900 truncate">{r.name}</div>
                      <div className="w-32 text-xs text-gray-500">{r.phone}</div>
                      <div className="w-12 text-xs text-gray-500 text-right">{r.pax}</div>
                      <div className="w-28 text-xs text-gray-400 text-right">
                        {new Date(r.created_at).toLocaleDateString()}
                      </div>
                    </div>
                    {r.notes && <p className="text-xs text-gray-500 mt-1">📝 {r.notes}</p>}

                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {assignedTables.map(s => (
                        <span key={s.table_id}
                          className="inline-flex items-center gap-1 text-xs bg-gray-100 text-gray-700 px-2 py-1 rounded-full">
                          {tablesById.get(s.table_id)?.table_number || 'Table'}
                          <button onClick={() => unassignTableBlock(r.id, s.table_id)}
                            className="text-gray-400 hover:text-red-600">✕</button>
                        </span>
                      ))}
                      <button onClick={() => setAssigningFor(assigningFor === r.id ? null : r.id)}
                        className="text-xs font-medium tracking-wide text-blue-600 hover:text-blue-800 transition-colors">
                        {assigningFor === r.id ? 'Cancel' : '+ Assign Table'}
                      </button>
                    </div>

                    {assigningFor === r.id && (
                      <div className="mt-2 p-3 bg-gray-50 rounded-lg">
                        {freeTablesForDate.length === 0 ? (
                          <p className="text-xs text-gray-400">No free tables for these dates.</p>
                        ) : (
                          <div className="flex flex-wrap gap-2">
                            {freeTablesForDate.map(s => (
                              <button key={s.table_id}
                                onClick={() => assignTableToRegistration(r.id, s.table_id)}
                                className="text-xs px-3 py-1.5 rounded-full border border-gray-300 hover:border-black hover:bg-white transition-colors">
                                {tablesById.get(s.table_id)?.table_number || 'Table'}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {loading ? (
        <p className="text-gray-400 text-sm">Loading...</p>
      ) : experiences.length === 0 ? (
        <p className="text-gray-400 text-sm text-center py-10">No experiences yet.</p>
      ) : (
        <>
          {upcoming.length > 0 && (
            <div className="mb-8">
              <p className="text-xs tracking-widest uppercase text-gray-400 mb-1">Upcoming</p>
              {upcoming.map(exp => <ExperienceRow key={exp.id} exp={exp} />)}
            </div>
          )}
          {past.length > 0 && (
            <div>
              <p className="text-xs tracking-widest uppercase text-gray-400 mb-1">Past</p>
              {past.map(exp => <ExperienceRow key={exp.id} exp={exp} />)}
            </div>
          )}
        </>
      )}
    </div>
  )
}
