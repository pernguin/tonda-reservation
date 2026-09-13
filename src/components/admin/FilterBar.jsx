export const FILTER_INPUT_CLASS = "border-b border-gray-200 bg-transparent py-2 text-sm text-gray-800 focus:outline-none focus:border-gray-800 transition-colors"

export function FilterField({ label, children }) {
  return (
    <div>
      <label className="block text-xs tracking-widest uppercase text-gray-400 mb-1">{label}</label>
      {children}
    </div>
  )
}

const MB = { '6': 'mb-6', '8': 'mb-8' }

export default function FilterBar({ onClear, hasFilters, children, mb = '6' }) {
  return (
    <div className={`flex gap-4 ${MB[mb]} flex-wrap items-end`}>
      {children}
      {hasFilters && (
        <button onClick={onClear}
          className="text-xs tracking-widest uppercase text-gray-400 hover:text-gray-700 transition-colors pb-2">
          Clear
        </button>
      )}
    </div>
  )
}
