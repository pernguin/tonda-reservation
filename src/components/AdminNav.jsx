import { NavLink } from 'react-router-dom'

const BRAND = '#E8420A'

export default function AdminNav() {
  return (
    <nav className="bg-white border-b border-gray-100 px-6 py-0">
      <div className="flex gap-1 max-w-3xl mx-auto">
        {[
          { to: '/admin', label: 'Dashboard' },
          { to: '/admin/bookings', label: 'Bookings' },
          { to: '/admin/tables', label: 'Floor Plan' },
          { to: '/admin/slot-rules', label: 'Slot Rules' },
          { to: '/admin/customers', label: 'Customers' },
          { to: '/admin/settings', label: 'Settings' },
        ].map(({ to, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/admin'}
            className={({ isActive }) =>
              `px-4 py-3 text-xs tracking-widest uppercase font-medium border-b-2 transition-colors ${
                isActive
                  ? 'border-b-2'
                  : 'border-transparent text-gray-400 hover:text-gray-600'
              }`
            }
            style={({ isActive }) => isActive ? { borderColor: BRAND, color: BRAND } : {}}
          >
            {label}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
