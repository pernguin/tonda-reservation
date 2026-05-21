import { useEffect, useState } from 'react'
import { supabase } from '../../supabase'

const BRAND = '#E8420A'

export default function Customers() {
  const [customers, setCustomers] = useState([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => { fetchCustomers() }, [])

  async function fetchCustomers() {
    setLoading(true)
    const { data } = await supabase
      .from('customers')
      .select('*, reservations(id, reservation_date, guest_count, status), events(id, event_date, event_type, status), offsite_bookings(id, event_date, event_type, status)')
      .order('created_at', { ascending: false })
    setCustomers(data || [])
    setLoading(false)
  }

  const filtered = customers.filter(c =>
    c.full_name?.toLowerCase().includes(search.toLowerCase()) ||
    c.phone?.includes(search) ||
    c.email?.toLowerCase().includes(search.toLowerCase())
  )

  function getStats(c) {
    const allBookings = [...(c.reservations || []), ...(c.events || []), ...(c.offsite_bookings || [])]
    const visits = allBookings.filter(b => b.status === 'completed' || b.status === 'seated').length
    const cancellations = allBookings.filter(b => b.status === 'cancelled').length
    const noShows = allBookings.filter(b => b.status === 'no_show').length
    const total = allBookings.length
    return { visits, cancellations, noShows, total }
  }

  return (
    <div className="min-h-screen bg-white p-8 max-w-3xl mx-auto">
      <p className="text-xs tracking-widest uppercase mb-1" style={{ color: BRAND }}>Admin</p>
      <h1 className="text-3xl font-light text-gray-900 mb-1">Customers</h1>
      <p className="text-gray-400 text-sm mb-8">All customer contact information and booking history</p>

      <input
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Search by name, phone or email..."
        className="w-full border-b border-gray-200 bg-transparent py-3 text-sm text-gray-800 focus:outline-none focus:border-gray-800 transition-colors placeholder-gray-400 mb-8"
      />

      {/* Column headers */}
      <div className="flex items-center gap-4 py-2 border-b border-gray-200 mb-1">
        <div className="flex-1 text-xs tracking-widest uppercase text-gray-400">Guest</div>
        <div className="text-xs tracking-widest uppercase text-gray-400 w-12 text-center">Visits</div>
        <div className="text-xs tracking-widest uppercase text-gray-400 w-16 text-center">Cancel</div>
        <div className="text-xs tracking-widest uppercase text-gray-400 w-16 text-center">No Show</div>
        <div className="text-xs tracking-widest uppercase text-gray-400 w-12 text-center">Total</div>
      </div>

      {loading ? (
        <p className="text-gray-400 text-sm py-4">Loading...</p>
      ) : filtered.length === 0 ? (
        <p className="text-gray-400 text-sm text-center py-10">No customers found.</p>
      ) : (
        filtered.map(c => {
          const { visits, cancellations, noShows, total } = getStats(c)
          return (
            <div key={c.id} className="flex items-center gap-4 py-4 border-b border-gray-100">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900">{c.full_name}</p>
                <p className="text-xs text-gray-400">{c.phone}</p>
                {c.email && <p className="text-xs text-gray-400">{c.email}</p>}
              </div>
              <div className="text-sm text-gray-700 w-12 text-center">{visits}</div>
              <div className="text-sm w-16 text-center" style={{ color: cancellations > 0 ? BRAND : '#9ca3af' }}>
                {cancellations}
              </div>
              <div className="text-sm w-16 text-center" style={{ color: noShows > 0 ? '#f97316' : '#9ca3af' }}>
                {noShows}
              </div>
              <div className="text-sm text-gray-400 w-12 text-center">{total}</div>
            </div>
          )
        })
      )}
    </div>
  )
}