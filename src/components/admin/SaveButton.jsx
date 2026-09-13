import { BRAND, SUCCESS } from '../../lib/adminTheme'

export default function SaveButton({ saved, onClick, label = 'Save All' }) {
  return (
    <button onClick={onClick}
      className="px-8 py-3 text-sm font-medium tracking-widest uppercase text-white transition-opacity hover:opacity-90"
      style={{ backgroundColor: saved ? SUCCESS : BRAND }}>
      {saved ? '✓ Saved' : label}
    </button>
  )
}
