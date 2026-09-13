import { BRAND } from '../../lib/adminTheme'

export default function TabBar({ tabs, value, onChange }) {
  return (
    <div className="flex gap-6 mb-6 border-b border-gray-100">
      {tabs.map(({ key, label }) => (
        <button key={key} onClick={() => onChange(key)}
          className={`pb-3 text-sm font-medium transition-colors ${
            value === key ? 'border-b-2 -mb-px' : 'text-gray-400 hover:text-gray-600'
          }`}
          style={value === key ? { borderColor: BRAND, color: BRAND } : {}}>
          {label}
        </button>
      ))}
    </div>
  )
}
