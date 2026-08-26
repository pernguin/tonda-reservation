import { useState } from 'react'
import { supabase } from '../supabase'
import { findOrCreateCustomer } from '../supabaseCustomers'

const BRAND = 'var(--color-accent)'
const CREAM = 'var(--color-bg)'
const inputClass = "w-full border-b border-[var(--color-border)] bg-transparent py-3 text-sm text-[var(--color-text)] focus:outline-none focus:border-[var(--color-accent)] transition-colors placeholder-[var(--color-text-muted)]"
const labelClass = "block text-xs tracking-widest uppercase mb-1 text-[var(--color-text-2)]"
const selectClass = "w-full border-b border-[var(--color-border)] bg-transparent py-3 text-sm text-[var(--color-text)] focus:outline-none focus:border-[var(--color-accent)] transition-colors"

export default function Offsite() {
  const [form, setForm] = useState({
    full_name: '',
    phone: '',
    email: '',
    event_type: '',
    event_date: '',
    event_time: '',
    guest_count: '',
    venue_address: '',
    venue_type: '',
    indoor_outdoor: '',
    kitchen_available: '',
    sink_within_3m: '',
    power_points_available: '',
    power_points_count: '',
    setup_space_sqft: '',
    budget_range: '',
    special_requests: '',
    how_heard: '',
    preferred_contact: '',
    best_time_to_reach: ''
  })
  const [submitted, setSubmitted] = useState(false)
  const [confirmationMessage, setConfirmationMessage] = useState('Thank you for your off-site enquiry. Our team will be in touch shortly to discuss your event.')
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
      const customerId = await findOrCreateCustomer({
        full_name: form.full_name,
        phone: form.phone,
        email: form.email
      })

      const { error: offsiteError } = await supabase
        .from('offsite_bookings')
        .insert([{
          customer_id: customerId,
          event_type: form.event_type,
          event_date: form.event_date,
          event_time: form.event_time,
          guest_count: parseInt(form.guest_count),
          venue_address: form.venue_address,
          venue_type: form.venue_type,
          indoor_outdoor: form.indoor_outdoor,
          kitchen_available: form.kitchen_available === 'yes',
          sink_within_3m: form.sink_within_3m === 'yes',
          power_points_available: form.power_points_available === 'yes',
          power_points_count: form.power_points_count ? parseInt(form.power_points_count) : null,
          setup_space_sqft: form.setup_space_sqft ? parseFloat(form.setup_space_sqft) : null,
          budget_range: form.budget_range,
          special_requests: form.special_requests,
          how_heard: form.how_heard,
          preferred_contact: form.preferred_contact,
          best_time_to_reach: form.best_time_to_reach,
          status: 'pending'
        }])

      if (offsiteError) throw offsiteError
      const { data: msgData } = await supabase.from('settings').select('value').eq('key', 'confirmation_message_offsite').maybeSingle()
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
        style={{ backgroundColor: CREAM, fontFamily: 'var(--font-body)' }}>
        <div className="text-center max-w-md">
          <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6"
            style={{ backgroundColor: BRAND }}>
            <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-2xl mb-3" style={{ color: BRAND, fontFamily: 'var(--font-heading)', fontWeight: 'var(--font-weight-heading)', fontStyle: 'var(--font-heading-style)' }}>Enquiry Received</h2>
          <p className="text-[var(--color-text-2)] text-sm leading-relaxed mb-8">{confirmationMessage}</p>
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
    <div className="min-h-screen" style={{ backgroundColor: CREAM, fontFamily: 'var(--font-body)' }}>
      <div className="max-w-lg mx-auto px-8 py-16">

        <p className="text-xs tracking-widest uppercase mb-2" style={{ color: BRAND }}>
          Tonda Pizza Romana
        </p>
        <h1 className="text-3xl mb-2" style={{ color: 'var(--color-text)', fontFamily: 'var(--font-heading)', fontWeight: 'var(--font-weight-heading)', fontStyle: 'var(--font-heading-style)' }}>Off-Site Booking</h1>
        <p className="text-[var(--color-text-muted)] text-sm mb-12">We'll come to you! Fill in your venue details and we'll get back to you.</p>

        {error && (
          <div className="border-l-2 pl-4 mb-8 py-2" style={{ borderColor: BRAND }}>
            <p className="text-sm text-[var(--color-text-2)]">{error}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-8">

          {/* Contact */}
          <div>
            <p className="text-xs tracking-widest uppercase mb-6 pb-2 border-b border-[var(--color-border)]" style={{ color: BRAND }}>
              Contact Details
            </p>
            <div className="space-y-8">
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
            </div>
          </div>

          {/* Event Details */}
          <div>
            <p className="text-xs tracking-widest uppercase mb-6 pb-2 border-b border-[var(--color-border)]" style={{ color: BRAND }}>
              Event Details
            </p>
            <div className="space-y-8">
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <label className={labelClass}>Event Type *</label>
                  <select name="event_type" value={form.event_type} onChange={handleChange} required
                    className={selectClass}>
                    <option value="">Select type</option>
                    <option value="birthday">Birthday</option>
                    <option value="corporate">Corporate</option>
                    <option value="private_dining">Private Dining</option>
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
                <label className={labelClass}>Budget Range (RM)</label>
                <select name="budget_range" value={form.budget_range} onChange={handleChange}
                  className={selectClass}>
                  <option value="">Select budget range</option>
                  <option value="1000_2000">RM 1,000 – 2,000</option>
                  <option value="2000_5000">RM 2,000 – 5,000</option>
                  <option value="above_5000">Above RM 5,000</option>
                  <option value="other">Other</option>
                </select>
              </div>
            </div>
          </div>

          {/* Venue Details */}
          <div>
            <p className="text-xs tracking-widest uppercase mb-6 pb-2 border-b border-[var(--color-border)]" style={{ color: BRAND }}>
              Venue Details
            </p>
            <div className="space-y-8">
              <div>
                <label className={labelClass}>Venue Address *</label>
                <textarea name="venue_address" value={form.venue_address} onChange={handleChange}
                  required rows={2} placeholder="Full address of the venue"
                  className={inputClass + ' resize-none'} />
              </div>
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <label className={labelClass}>Venue Type *</label>
                  <select name="venue_type" value={form.venue_type} onChange={handleChange} required
                    className={selectClass}>
                    <option value="">Select type</option>
                    <option value="home">Home</option>
                    <option value="office">Office</option>
                    <option value="function_hall">Function Hall</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Indoor or Outdoor?</label>
                  <select name="indoor_outdoor" value={form.indoor_outdoor} onChange={handleChange}
                    className={selectClass}>
                    <option value="">Select</option>
                    <option value="indoor">Indoor</option>
                    <option value="outdoor">Outdoor</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <label className={labelClass}>Kitchen Available?</label>
                  <select name="kitchen_available" value={form.kitchen_available} onChange={handleChange}
                    className={selectClass}>
                    <option value="">Select</option>
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Sink Within 3m?</label>
                  <select name="sink_within_3m" value={form.sink_within_3m} onChange={handleChange}
                    className={selectClass}>
                    <option value="">Select</option>
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <label className={labelClass}>Power Points?</label>
                  <select name="power_points_available" value={form.power_points_available}
                    onChange={handleChange} className={selectClass}>
                    <option value="">Select</option>
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </select>
                </div>
                <div>
                  <label className={labelClass}>
                    {form.power_points_available === 'yes' ? 'How Many?' : 'Setup Space (sq ft)'}
                  </label>
                  {form.power_points_available === 'yes' ? (
                    <input name="power_points_count" type="number" min="1"
                      value={form.power_points_count} onChange={handleChange}
                      placeholder="e.g. 4" className={inputClass} />
                  ) : (
                    <input name="setup_space_sqft" type="number" min="0"
                      value={form.setup_space_sqft} onChange={handleChange}
                      placeholder="e.g. 200" className={inputClass} />
                  )}
                </div>
              </div>
              {form.power_points_available === 'yes' && (
                <div>
                  <label className={labelClass}>Setup Space (sq ft)</label>
                  <input name="setup_space_sqft" type="number" min="0"
                    value={form.setup_space_sqft} onChange={handleChange}
                    placeholder="e.g. 200" className={inputClass} />
                </div>
              )}
            </div>
          </div>

          {/* Additional Info */}
          <div>
            <p className="text-xs tracking-widest uppercase mb-6 pb-2 border-b border-[var(--color-border)]" style={{ color: BRAND }}>
              Additional Info
            </p>
            <div className="space-y-8">
              <div>
                <label className={labelClass}>Special Requests</label>
                <textarea name="special_requests" value={form.special_requests}
                  onChange={handleChange} rows={3}
                  placeholder="Dietary requirements, special arrangements..."
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
            </div>
          </div>

          <button type="submit" disabled={loading}
            className="w-full py-4 text-sm font-medium tracking-widest uppercase text-white transition-opacity hover:opacity-90 disabled:opacity-40"
            style={{ backgroundColor: BRAND }}>
            {loading ? 'Submitting...' : 'Submit Off-Site Enquiry'}
          </button>

        </form>
      </div>
    </div>
  )
}