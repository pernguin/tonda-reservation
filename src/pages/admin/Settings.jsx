import { useEffect, useState } from 'react'
import { supabase } from '../../supabase'
import AdminPage from '../../components/admin/AdminPage'
import SaveButton from '../../components/admin/SaveButton'
import { Loading } from '../../components/admin/States'
import { useSavedFlash } from '../../lib/useSavedFlash'
import { useToast } from '../../lib/useToast'

const labelClass = "block text-xs tracking-widest uppercase mb-1 text-gray-500"

export default function Settings() {
  const [messages, setMessages] = useState({
    confirmation_message_reservation: '',
    confirmation_message_event: '',
    confirmation_message_offsite: '',
    staff_alert_email: ''
  })
  const [saved, flashSaved] = useSavedFlash()
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [showToast, toastNode] = useToast()
  const fail = (message, error) => { console.error(message, error); showToast(message) }

  useEffect(() => {
    async function fetchSettings() {
      const { data, error } = await supabase.from('settings').select('*')
      if (error) {
        setLoadError(true)
        setLoading(false)
        fail('Could not load settings.', error)
        return
      }
      if (data) {
        const map = {}
        data.forEach(row => { map[row.key] = row.value })
        setMessages(prev => ({ ...prev, ...map }))
      }
      setLoading(false)
    }
    fetchSettings()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function saveAll() {
    const { error } = await supabase.from('settings')
      .upsert(Object.entries(messages).map(([key, value]) => ({ key, value })), { onConflict: 'key' })
    if (error) { fail('Could not save settings.', error); return }
    flashSaved()
  }

  if (loading) return <AdminPage width="2xl" title="Settings" subtitle="Manage confirmation messages and staff alerts" headerGap="10"><Loading /></AdminPage>

  if (loadError) return (
    <AdminPage width="2xl" title="Settings" subtitle="Manage confirmation messages and staff alerts" headerGap="10">
      <p className="text-sm text-gray-500">Could not load settings. Reload the page to try again.</p>
      {toastNode}
    </AdminPage>
  )

  return (
    <AdminPage width="2xl" title="Settings" subtitle="Manage confirmation messages and staff alerts" headerGap="10"
      actions={<SaveButton saved={saved} onClick={saveAll} />}>
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

        <div>
          <p className="text-lg font-medium text-gray-900 mb-1">Staff alert emails</p>
          <p className="text-xs text-gray-400 mb-3">Sent a copy of every new reservation. Comma-separated. Leave blank to disable.</p>
          <label className={labelClass}>Addresses</label>
          <input
            type="text"
            value={messages.staff_alert_email}
            onChange={e => setMessages(prev => ({ ...prev, staff_alert_email: e.target.value }))}
            placeholder="manager@example.com, floor@example.com"
            className="w-full border-b border-gray-200 bg-transparent py-3 text-sm text-gray-800 focus:outline-none focus:border-gray-800 transition-colors"
          />
        </div>
      </div>
      {toastNode}
    </AdminPage>
  )
}
