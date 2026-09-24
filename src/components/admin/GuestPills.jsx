import { getGuestPills } from '../../lib/guestPills'

export default function GuestPills({ customer, booking, today }) {
  const pills = getGuestPills(customer, booking, today)
  if (pills.length === 0) return null

  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {pills.map((p) => (
        <span
          key={p.key}
          className={`text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${p.className || ''}`}
          style={p.style}
        >
          {p.label}
        </span>
      ))}
    </div>
  )
}
