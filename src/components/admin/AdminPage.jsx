import { BRAND } from '../../lib/adminTheme'

const WIDTH_CLASS = { '2xl': 'max-w-2xl', '3xl': 'max-w-3xl', '4xl': 'max-w-4xl', '5xl': 'max-w-5xl' }
const HEADER_GAP_CLASS = { '6': 'mb-6', '8': 'mb-8', '10': 'mb-10' }

export default function AdminPage({ title, subtitle, width, headerGap = '8', actions, className = '', children }) {
  const gapClass = HEADER_GAP_CLASS[headerGap]

  return (
    <div className={`min-h-screen bg-white p-4 md:p-8 ${WIDTH_CLASS[width]} mx-auto ${className}`}>
      {actions ? (
        <div className={`flex justify-between items-start ${gapClass}`}>
          <div>
            <p className="text-xs tracking-widest uppercase mb-1" style={{ color: BRAND }}>Admin</p>
            <h1 className="text-3xl font-light text-gray-900">{title}</h1>
            {subtitle && <p className="text-gray-400 text-sm mt-1">{subtitle}</p>}
          </div>
          {actions}
        </div>
      ) : (
        <>
          <p className="text-xs tracking-widest uppercase mb-1" style={{ color: BRAND }}>Admin</p>
          <h1 className={`text-3xl font-light text-gray-900 ${subtitle ? 'mb-1' : gapClass}`}>{title}</h1>
          {subtitle && <p className={`text-gray-400 text-sm ${gapClass}`}>{subtitle}</p>}
        </>
      )}
      {children}
    </div>
  )
}
