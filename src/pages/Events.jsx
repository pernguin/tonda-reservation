import { useState } from 'react'
import { supabase } from '../supabase'
import { supabaseCustomers } from '../supabaseCustomers'

function normalisePhone(raw) {
  let p = raw.replace(/[\s\-\(\)]/g, '')
  if (p.startsWith('+')) p = p.slice(1)
  if (p.startsWith('0')) p = '60' + p.slice(1)
  return p
}

const BRAND = '#E8420A'
const CREAM = '#FFFFFF'
const inputClass = "w-full border-b border-gray-300 bg-transparent py-3 text-sm text-gray-800 focus:outline-none focus:border-gray-800 transition-colors placeholder-gray-400"
const labelClass = "block text-xs tracking-widest uppercase mb-1 text-gray-500"
const selectClass = "w-full border-b border-gray-300 bg-transparent py-3 text-sm text-gray-800 focus:outline-none focus:border-gray-800 transition-colors"

export default function Events() {
  const [form, setForm] = useState({
    full_name: '',
    phone: '',
    email: '',
    event_type: '',
    event_date: '',
    event_time: '',
    guest_count: '',
    package_selected: '',
    budget_range: '',
    special_requests: '',
    how_heard: '',
    preferred_contact: '',
    best_time_to_reach: ''
  })
  const [submitted, setSubmitted] = useState(false)
  const [confirmationMessage, setConfirmationMessage] = useState('Thank you for your event enquiry. Our team will be in touch shortly to discuss your event.')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value })
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const { data: customer, error: customerError } = await supabaseCustomers
        .from('customers')
        .insert([{ full_name: form.full_name, phone: normalisePhone(form.phone), email: form.email }])
        .select()
        .single()

      if (customerError) throw customerError

      const { error: eventError } = await supabase
        .from('events')
        .insert([{
          customer_id: customer.id,
          event_type: form.event_type,
          event_date: form.event_date,
          event_time: form.event_time,
          guest_count: parseInt(form.guest_count),
          package_selected: form.package_selected,
          budget_range: form.budget_range,
          special_requests: form.special_requests,
          how_heard: form.how_heard,
          preferred_contact: form.preferred_contact,
          best_time_to_reach: form.best_time_to_reach,
          status: 'pending'
        }])

      if (eventError) throw eventError
      const { data: msgData } = await supabase.from('settings').select('value').eq('key', 'confirmation_message_event').maybeSingle()
      if (msgData?.value) setConfirmationMessage(msgData.value)
      setSubmitted(true)
    } catch (err) {
      setError('Something went wrong. Please try again.')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  if (submitted) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-8"
        style={{ backgroundColor: CREAM }}>
        <div className="text-center max-w-md">
          <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6"
            style={{ backgroundColor: BRAND }}>
            <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-2xl font-light mb-3" style={{ color: BRAND }}>Enquiry Received</h2>
          <p className="text-gray-500 text-sm leading-relaxed mb-8">{confirmationMessage}</p>
          <a href="/"
            className="text-xs tracking-widest uppercase transition-colors"
            style={{ color: BRAND }}>
            ← Back to Home
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: CREAM }}>
      <div className="max-w-lg mx-auto px-8 py-16">

        <p className="text-xs tracking-widest uppercase mb-2" style={{ color: BRAND }}>
          Tonda Pizza Romana
        </p>
        <h1 className="text-3xl font-light text-gray-900 mb-2">Book an Event</h1>
        <p className="text-gray-400 text-sm mb-12">Tell us about your event and we'll get back to you to confirm details.</p>

        {error && (
          <div className="border-l-2 pl-4 mb-8 py-2" style={{ borderColor: BRAND }}>
            <p className="text-sm text-gray-700">{error}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-8">

          <div>
            <label className={labelClass}>Full Name *</label>
            <input name="full_name" value={form.full_name} onChange={handleChange} required
              placeholder="Your full name" className={inputClass} />
          </div>

          <div className="grid grid-cols-2 gap-6">
            <div>
              <label className={labelClass}>Phone Number *</label>
              <input name="phone" value={form.phone} onChange={handleChange} required
                placeholder="+60 12 345 6789" className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Email</label>
              <input name="email" type="email" value={form.email} onChange={handleChange}
                placeholder="your@email.com" className={inputClass} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-6">
            <div>
              <label className={labelClass}>Event Type *</label>
              <select name="event_type" value={form.event_type} onChange={handleChange} required
                className={selectClass}>
                <option value="">Select type</option>
                <option value="birthday">Birthday</option>
                <option value="corporate">Corporate</option>
                <option value="anniversary">Anniversary</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label className={labelClass}>Number of Guests *</label>
              <input name="guest_count" type="number" min="1" value={form.guest_count}
                onChange={handleChange} required placeholder="20" className={inputClass} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-6">
            <div>
              <label className={labelClass}>Preferred Date *</label>
              <input name="event_date" type="date" value={form.event_date}
                onChange={handleChange} required className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Preferred Time *</label>
              <input name="event_time" type="time" value={form.event_time}
                onChange={handleChange} required className={inputClass} />
            </div>
          </div>

          <div>
            <label className={labelClass}>Budget Range</label>
            <select name="budget_range" value={form.budget_range} onChange={handleChange}
              className={selectClass}>
              <option value="">Select budget range</option>
              <option value="1000_2000">RM 1,000 – 2,000</option>
              <option value="2000_5000">RM 2,000 – 5,000</option>
              <option value="above_5000">Above RM 5,000</option>
              <option value="other">Other</option>
            </select>
          </div>

          <div>
            <label className={labelClass}>Special Requests</label>
            <textarea name="special_requests" value={form.special_requests}
              onChange={handleChange} rows={3}
              placeholder="Dietary requirements, decorations, special arrangements..."
              className={inputClass + ' resize-none'} />
          </div>

          <div className="grid grid-cols-2 gap-6">
            <div>
              <label className={labelClass}>Preferred Contact</label>
              <select name="preferred_contact" value={form.preferred_contact}
                onChange={handleChange} className={selectClass}>
                <option value="">Select preference</option>
                <option value="call">Phone Call</option>
                <option value="whatsapp">WhatsApp</option>
              </select>
            </div>
            <div>
              <label className={labelClass}>Best Time to Reach You</label>
              <input name="best_time_to_reach" value={form.best_time_to_reach}
                onChange={handleChange} placeholder="e.g. Weekdays after 6pm"
                className={inputClass} />
            </div>
          </div>

          <div>
            <label className={labelClass}>How Did You Hear About Us?</label>
            <select name="how_heard" value={form.how_heard} onChange={handleChange}
              className={selectClass}>
              <option value="">Select an option</option>
              <option value="google">Google</option>
              <option value="instagram">Instagram</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="referral">Referral</option>
              <option value="other">Other</option>
            </select>
          </div>

          <button type="submit" disabled={loading}
            className="w-full py-4 text-sm font-medium tracking-widest uppercase text-white transition-opacity hover:opacity-90 disabled:opacity-40"
            style={{ backgroundColor: BRAND }}>
            {loading ? 'Submitting...' : 'Submit Event Enquiry'}
          </button>

        </form>
      </div>
    </div>
  )
}