export function Loading({ className = '' }) {
  return <p className={`text-gray-400 text-sm ${className}`}>Loading...</p>
}

export function EmptyState({ message, className = '' }) {
  return <p className={`text-gray-400 text-sm text-center py-10 ${className}`}>{message}</p>
}
