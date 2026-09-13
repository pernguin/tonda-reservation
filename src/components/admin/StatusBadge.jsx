// eslint-disable-next-line react-refresh/only-export-components -- shared with StatusBadge.test.js and other pages
export const STATUS_COLORS = {
  pending: 'bg-yellow-100 text-yellow-800',
  confirmed: 'bg-blue-100 text-blue-800',
  seated: 'bg-green-100 text-green-800',
  completed: 'bg-gray-100 text-gray-800',
  cancelled: 'bg-red-100 text-red-800',
  no_show: 'bg-orange-100 text-orange-800',
  published: 'bg-green-100 text-green-800',
  draft: 'bg-gray-100 text-gray-600',
}

const FALLBACK = 'bg-gray-100 text-gray-600'

// eslint-disable-next-line react-refresh/only-export-components -- shared with StatusBadge.test.js and other pages
export function colorFor(status) {
  return STATUS_COLORS[status] || FALLBACK
}

export default function StatusBadge({ status }) {
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${colorFor(status)}`}>
      {status}
    </span>
  )
}
