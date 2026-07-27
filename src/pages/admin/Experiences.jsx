import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../supabase'

const BRAND = '#8B1A1A'

const inputClass = "w-full border-b border-gray-300 bg-transparent py-3 text-sm text-gray-800 focus:outline-none focus:border-gray-800 transition-colors placeholder-gray-400"
const labelClass = "block text-xs tracking-widest uppercase mb-1 text-gray-500"

const emptyForm = {
  name: '', date: '', time: '', description: '', price: '', poster_url: '', status: 'draft'
}

export default function Experiences() {
  const [experiences, setExperiences] = useState([])
  const [registrationCounts, setRegistrationCounts] = useState({})
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [viewingRegs, setViewingRegs] = useState(null)
  const [registrations, setRegistrations] = useState([])
  const [posterError, setPosterError] = useState(null)
  const [posterFileName, setPosterFileName] = useState(null)
  const posterInputRef = useRef(null)

  const MAX_POSTER_SIZE = 5 * 1024 * 1024

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    setLoading(true)
    const { data: exps } = await supabase.from('experiences').select('*').order('date', { ascending: true })
    const { data: regs } = await supabase.from('experience_registrations').select('experience_id')
    const counts = {}
    ;(regs || []).forEach(r => { counts[r.experience_id] = (counts[r.experience_id] || 0) + 1 })
    setExperiences(exps || [])
    setRegistrationCounts(counts)
    setLoading(false)
  }

  function handleChange(e) {
    const { name, value } = e.target
    setForm(prev => ({ ...prev, [name]: value }))
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
      description: exp.description || '',
      price: exp.price ?? '',
      poster_url: exp.poster_url || '',
      status: exp.status
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
    const payload = {
      name: form.name,
      date: form.date,
      time: form.time,
      description: form.description || null,
      price: form.price === '' ? null : parseFloat(form.price),
      poster_url: form.poster_url || null,
      status: form.status
    }
    if (editingId) {
      await supabase.from('experiences').update(payload).eq('id', editingId)
    } else {
      await supabase.from('experiences').insert([payload])
    }
    setSaving(false)
    setShowForm(false)
    fetchAll()
  }

  async function handleDelete(id) {
    if (!confirm('Delete this experience? This will also delete its registrations.')) return
    await supabase.from('experiences').delete().eq('id', id)
    fetchAll()
  }

  async function openRegistrations(exp) {
    setShowForm(false)
    setViewingRegs(exp)
    const { data } = await supabase
      .from('experience_registrations')
      .select('*')
      .eq('experience_id', exp.id)
      .order('created_at', { ascending: false })
    setRegistrations(data || [])
  }

  const today = new Date().toISOString().split('T')[0]
  const upcoming = experiences.filter(e => e.date >= today)
  const past = experiences.filter(e => e.date < today)

  function formatPrice(price) {
    return price == null ? 'Free' : `RM ${Number(price).toFixed(2)}`
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
          <p className="text-xs text-gray-400">{exp.date} · {exp.time?.slice(0, 5)} · {formatPrice(exp.price)}</p>
        </div>
        <div className="text-xs text-gray-500 shrink-0 cursor-pointer" onClick={() => openRegistrations(exp)}>
          {registrationCounts[exp.id] || 0} registered
        </div>
        <div className="shrink-0"><StatusBadge status={exp.status} /></div>
        <div className="flex gap-3 shrink-0">
          <button onClick={() => openEditForm(exp)}
            className="text-xs font-medium tracking-wide text-blue-600 hover:text-blue-800 transition-colors">
            Edit
          </button>
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
              {registrations.map(r => (
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
                </div>
              ))}
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
