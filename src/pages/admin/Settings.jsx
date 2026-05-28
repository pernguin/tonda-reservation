import { useEffect, useState } from 'react'
import { supabase } from '../../supabase'

const BRAND = '#E8420A'
const labelClass = "block text-xs tracking-widest uppercase mb-1 text-gray-500"

export default function Settings() {
  const [messages, setMessages] = useState({
    confirmation_message_reservation: '',
    confirmation_message_event: '',
    confirmation_message_offsite: ''
  })
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => { fetchSettings() }, [])

  async function fetchSettings() {
    const { data } = await supabase.from('settings').select('*')
    if (data) {
      const map = {}
      data.forEach(row => { map[row.key] = row.value })
      setMessages(prev => ({ ...prev, ...map }))
    }
    setLoading(false)
  }

  async function saveAll() {
    for (const [key, value] of Object.entries(messages)) {
      await supabase.from('settings').upsert({ key, value }, { onConflict: 'key' })
    }
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  if (loading) return <div className="p-8 text-gray-400 text-sm">Loading...</div>

  return (
    <div className="min-h-screen bg-white p-8 max-w-2xl mx-auto">
      <div className="flex justify-between items-start mb-10">
        <div>
          <p className="text-xs tracking-widest uppercase mb-1" style={{ color: BRAND }}>Admin</p>
          <h1 className="text-3xl font-light text-gray-900">Settings</h1>
          <p className="text-gray-400 text-sm mt-1">Manage confirmation messages sent to customers</p>
        </div>
        <button onClick={saveAll}
          className="px-8 py-3 text-sm font-medium tracking-widest uppercase text-white transition-opacity hover:opacity-90"
          style={{ backgroundColor: saved ? '#16a34a' : BRAND }}>
          {saved ? '✓ Saved' : 'Save All'}
        </button>
      </div>

      <div className="space-y-10">
        <div>
          <p className="text-lg font-medium text-gray-900 mb-1">Reservation Confirmation</p>
          <p className="text-xs text-gray-400 mb-3">Shown to customers after submitting a reservation request. Available placeholders: {'{name}'}, {'{date}'}, {'{time}'}, {'{guests}'}</p>
          <label className={labelClass}>Message</label>
          <textarea
            value={messages.confirmation_message_reservation}
            onChange={e => setMessages(prev => ({ ...prev, confirmation_message_reservation: e.target.value }))}
            rows={4}
            className="w-full border-b border-gray-200 bg-transparent py-3 text-sm text-gray-800 focus:outline-none focus:border-gray-800 transition-colors resize-none"
          />
        </div>

        <div>
          <p className="text-lg font-medium text-gray-900 mb-1">Event Enquiry Confirmation</p>
          <p className="text-xs text-gray-400 mb-3">Shown to customers after submitting an event enquiry.</p>
          <label className={labelClass}>Message</label>
          <textarea
            value={messages.confirmation_message_event}
            onChange={e => setMessages(prev => ({ ...prev, confirmation_message_event: e.target.value }))}
            rows={4}
            className="w-full border-b border-gray-200 bg-transparent py-3 text-sm text-gray-800 focus:outline-none focus:border-gray-800 transition-colors resize-none"
          />
        </div>

        <div>
          <p className="text-lg font-medium text-gray-900 mb-1">Off-Site Enquiry Confirmation</p>
          <p className="text-xs text-gray-400 mb-3">Shown to customers after submitting an off-site enquiry.</p>
          <label className={labelClass}>Message</label>
          <textarea
            value={messages.confirmation_message_offsite}
            onChange={e => setMessages(prev => ({ ...prev, confirmation_message_offsite: e.target.value }))}
            rows={4}
            className="w-full border-b border-gray-200 bg-transparent py-3 text-sm text-gray-800 focus:outline-none focus:border-gray-800 transition-colors resize-none"
          />
        </div>
      </div>
    </div>
  )
}
