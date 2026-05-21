import { useEffect, useState } from 'react'
import { supabase } from '../../supabase'
import { Link } from 'react-router-dom'

const BRAND = '#E8420A'

export default function Dashboard() {
  const [stats, setStats] = useState({
    reservations: 0, events: 0, offsite: 0, customers: 0
  })

  useEffect(() => {
    async function fetchStats() {
      const [r, e, o, c] = await Promise.all([
        supabase.from('reservations').select('id', { count: 'exact' }),
        supabase.from('events').select('id', { count: 'exact' }),
        supabase.from('offsite_bookings').select('id', { count: 'exact' }),
        supabase.from('customers').select('id', { count: 'exact' })
      ])
      setStats({
        reservations: r.count || 0,
        events: e.count || 0,
        offsite: o.count || 0,
        customers: c.count || 0
      })
    }
    fetchStats()
  }, [])

  const stats_cards = [
    { label: 'Total Reservations', value: stats.reservations, link: '/admin/bookings' },
    { label: 'Event Enquiries', value: stats.events, link: '/admin/bookings' },
    { label: 'Off-Site Enquiries', value: stats.offsite, link: '/admin/bookings' },
    { label: 'Total Customers', value: stats.customers, link: '/admin/customers' },
  ]

  const quick_links = [
    { label: 'Manage Bookings', desc: 'View and confirm reservations', link: '/admin/bookings' },
    { label: 'Floor Plan', desc: 'Assign tables to reservations', link: '/admin/tables' },
    { label: 'Slot Rules', desc: 'Set session times and rules', link: '/admin/slot-rules' },
    { label: 'Customers', desc: 'View customer history', link: '/admin/customers' },
  ]

  return (
    <div className="min-h-screen bg-white p-8 max-w-3xl mx-auto">
      <p className="text-xs tracking-widest uppercase mb-1" style={{ color: BRAND }}>Admin</p>
      <h1 className="text-3xl font-light text-gray-900 mb-1">Dashboard</h1>
      <p className="text-gray-400 text-sm mb-10">Overview of all bookings and enquiries</p>

      <div className="grid grid-cols-2 gap-4 mb-10">
        {stats_cards.map(card => (
          <Link to={card.link} key={card.label}
            className="border border-gray-100 rounded-xl p-6 hover:border-gray-300 transition-colors">
            <p className="text-xs tracking-widest uppercase text-gray-400 mb-3">{card.label}</p>
            <p className="text-4xl font-light" style={{ color: BRAND }}>{card.value}</p>
          </Link>
        ))}
      </div>

      <p className="text-xs tracking-widest uppercase text-gray-400 mb-4">Quick Links</p>
      <div className="grid grid-cols-2 gap-4">
        {quick_links.map(item => (
          <Link to={item.link} key={item.label}
            className="border border-gray-100 rounded-xl p-4 hover:border-gray-300 transition-colors group">
            <p className="font-medium text-sm text-gray-800 mb-1 group-hover:text-gray-900"
              style={{ color: BRAND }}>{item.label}</p>
            <p className="text-xs text-gray-400">{item.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  )
}