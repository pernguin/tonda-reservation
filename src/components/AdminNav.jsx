import { NavLink } from 'react-router-dom'

const BRAND = '#E8420A'

export default function AdminNav({ unseenCount = 0, soundOn = false, onToggleSound }) {
  return (
    <nav className="bg-white border-b border-gray-100 px-6 py-0">
      <div className="flex gap-1 max-w-3xl mx-auto items-center">
        {[
          { to: '/admin', label: 'Dashboard' },
          { to: '/admin/bookings', label: 'Bookings' },
          { to: '/admin/experiences', label: 'Experiences' },
          { to: '/admin/tables', label: 'Floor Plan' },
          { to: '/admin/slot-rules', label: 'Slot Rules' },
          { to: '/admin/customers', label: 'Customers' },
          { href: 'https://round-reservation.vercel.app/admin/feedback', label: 'Feedback' },
          { to: '/admin/settings', label: 'Settings' },
        ].map(({ to, href, label }) =>
          href ? (
            <a
              key={href}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-3 text-xs tracking-widest uppercase font-medium border-b-2 border-transparent text-gray-400 hover:text-gray-600 transition-colors"
            >
              {label}
            </a>
          ) : (
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
              {to === '/admin/bookings' && unseenCount > 0 && (
                <span className="ml-1.5 inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full text-[10px] text-white"
                  style={{ backgroundColor: BRAND }}>
                  {unseenCount}
                </span>
              )}
            </NavLink>
          )
        )}
        {onToggleSound && (
          <button type="button" onClick={onToggleSound}
            className="ml-auto px-3 py-3 text-xs tracking-widest uppercase text-gray-400 hover:text-gray-600 transition-colors"
            title="Play a chime when a new reservation arrives">
            {soundOn ? '🔔 Sound on' : '🔕 Sound off'}
          </button>
        )}
      </div>
    </nav>
  )
}
