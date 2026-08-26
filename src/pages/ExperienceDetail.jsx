import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../supabase'
import { supabaseCustomers } from '../supabaseCustomers'

const BRAND = 'var(--color-accent)'
const CREAM = 'var(--color-bg)'

const inputClass = "w-full border-b border-[var(--color-border)] bg-transparent py-3 text-sm text-[var(--color-text)] focus:outline-none focus:border-[var(--color-accent)] transition-colors placeholder-[var(--color-text-muted)]"
const labelClass = "block text-xs tracking-widest uppercase mb-1 text-[var(--color-text-2)]"

function normalisePhone(raw) {
  let p = raw.replace(/[\s\-\(\)]/g, '')
  if (p.startsWith('+')) p = p.slice(1)
  if (p.startsWith('0')) p = '60' + p.slice(1)
  return p
}

export default function ExperienceDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [experience, setExperience] = useState(undefined)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', phone: '', pax: 1, notes: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [submitted, setSubmitted] = useState(false)

  useEffect(() => { fetchExperience() }, [id])

  async function fetchExperience() {
    const { data } = await supabase.from('experiences').select('*').eq('id', id).maybeSingle()
    setExperience(data || null)
  }

  function handleChange(e) {
    const { name, value } = e.target
    setForm(prev => ({ ...prev, [name]: value }))
  }

  async function handlePhoneBlur() {
    const normalised = normalisePhone(form.phone)
    if (!normalised) return
    setForm(prev => ({ ...prev, phone: normalised }))
    const { data } = await supabaseCustomers
      .from('customers')
      .select('full_name')
      .eq('phone', normalised)
      .maybeSingle()
    if (data) {
      setForm(prev => ({ ...prev, name: prev.name || data.full_name || '' }))
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const { error: insertError } = await supabase.from('experience_registrations').insert([{
        experience_id: id,
        name: form.name,
        phone: normalisePhone(form.phone),
        pax: parseInt(form.pax) || 1,
        notes: form.notes || null
      }])
      if (insertError) throw insertError
      setSubmitted(true)
    } catch (err) {
      setError('Something went wrong. Please try again.')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  function formatPrice(price) {
    return price == null ? 'Free entry' : `RM ${Number(price).toFixed(2)}`
  }

  if (experience === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: CREAM }}>
        <p className="text-[var(--color-text-muted)] text-sm">Loading...</p>
      </div>
    )
  }

  if (experience === null) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-8" style={{ backgroundColor: CREAM }}>
        <p className="text-[var(--color-text-2)] text-sm mb-6">This experience could not be found.</p>
        <button onClick={() => navigate('/reservations')}
          className="text-xs tracking-widest uppercase transition-colors" style={{ color: BRAND }}>
          ← Back to Reservations
        </button>
      </div>
    )
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: CREAM, fontFamily: 'var(--font-body)' }}>
      <div className="max-w-lg mx-auto px-8 py-16">
        <button onClick={() => navigate('/reservations')}
          className="text-xs tracking-widest uppercase mb-8 transition-colors" style={{ color: BRAND }}>
          ← Back to Reservations
        </button>

        {experience.poster_url && (
          <div className="w-full aspect-square rounded-xl overflow-hidden mb-8 bg-[var(--color-surface-2)]">
            <img src={experience.poster_url} alt={experience.name} className="w-full h-full object-cover" />
          </div>
        )}

        <p className="text-xs tracking-widest uppercase mb-2" style={{ color: BRAND }}>
          Tonda Pizza Romana
        </p>
        <h1 className="text-3xl mb-2" style={{ color: 'var(--color-text)', fontFamily: 'var(--font-heading)', fontWeight: 'var(--font-weight-heading)', fontStyle: 'var(--font-heading-style)' }}>{experience.name}</h1>
        <p className="text-[var(--color-text-2)] text-sm mb-1">
          {experience.date} · {experience.time?.slice(0, 5)}
        </p>
        <p className="text-sm font-medium mb-6" style={{ color: BRAND }}>{formatPrice(experience.price)}</p>

        {experience.description && (
          <p className="text-[var(--color-text-2)] text-sm leading-relaxed mb-10 whitespace-pre-line">{experience.description}</p>
        )}

        {submitted ? (
          <div className="border border-[var(--color-border)] rounded-xl p-6" style={{ backgroundColor: 'var(--color-surface)' }}>
            <p className="text-sm text-[var(--color-text-2)]">
              Thanks — your interest has been registered. We'll be in touch with more details closer to the date.
            </p>
          </div>
        ) : showForm ? (
          <form onSubmit={handleSubmit} className="space-y-8">
            {error && (
              <div className="border-l-2 pl-4 py-2" style={{ borderColor: BRAND }}>
                <p className="text-sm text-[var(--color-text-2)]">{error}</p>
              </div>
            )}
            <div>
              <label className={labelClass}>Full Name *</label>
              <input name="name" value={form.name} onChange={handleChange} required
                placeholder="Your full name"
                className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Phone Number *</label>
              <input name="phone" value={form.phone} onChange={handleChange} onBlur={handlePhoneBlur} required
                placeholder="+60 12 345 6789"
                className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Number of Guests *</label>
              <input name="pax" type="number" min="1" max="50" value={form.pax} onChange={handleChange} required
                className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Notes</label>
              <textarea name="notes" value={form.notes} onChange={handleChange} rows={3}
                placeholder="Anything we should know?"
                className={inputClass + ' resize-none'} />
            </div>
            <button type="submit" disabled={loading}
              className="w-full py-4 text-sm font-medium tracking-widest uppercase text-white transition-opacity hover:opacity-90 disabled:opacity-40"
              style={{ backgroundColor: BRAND }}>
              {loading ? 'Submitting...' : 'Confirm Interest'}
            </button>
          </form>
        ) : (
          <button onClick={() => setShowForm(true)}
            className="w-full py-4 text-sm font-medium tracking-widest uppercase text-white transition-opacity hover:opacity-90"
            style={{ backgroundColor: BRAND }}>
            Register Interest
          </button>
        )}
      </div>
    </div>
  )
}
