import { useState } from 'react'
import { BRAND } from '../../lib/adminTheme'
import { FILTER_INPUT_CLASS } from './FilterBar'

function Panel({ title, onConfirm, onCancel }) {
  const [value, setValue] = useState('')
  const [error, setError] = useState('')

  const confirm = () => {
    const n = Number(value.trim())
    if (value.trim() === '' || !Number.isFinite(n) || n < 0) {
      setError('Enter a number, e.g. 180 or 96.50')
      return
    }
    onConfirm(n)
  }

  const handleKeyDown = e => {
    if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') {
      e.preventDefault()
      confirm()
    } else if (e.key === 'Escape') {
      onCancel()
    }
  }

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black" style={{ opacity: 0.4 }} onClick={onCancel} />
      <div className="absolute inset-0 flex items-end sm:items-center justify-center pointer-events-none">
        <div
          className="bg-white w-full sm:max-w-sm rounded-t-2xl sm:rounded-xl p-6 pointer-events-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="amount-prompt-title"
          onKeyDown={handleKeyDown}
        >
          <h2 id="amount-prompt-title" className="text-lg font-medium text-gray-900 mb-1">{title}</h2>
          <p className="text-xs text-gray-500 mb-5">Enter the bill total to complete this reservation.</p>

          <label htmlFor="amount-spent" className="block text-xs tracking-widest uppercase text-gray-400 mb-1">Amount spent (RM)</label>
          <input
            id="amount-spent"
            type="text"
            inputMode="decimal"
            autoFocus
            value={value}
            onChange={e => setValue(e.target.value)}
            className={`${FILTER_INPUT_CLASS} w-full text-base`}
            aria-describedby={error ? 'amount-spent-error' : undefined}
          />
          {error && (
            <p id="amount-spent-error" role="alert" className="text-xs mt-1" style={{ color: BRAND }}>{error}</p>
          )}

          <div className="flex gap-3 justify-end mt-6">
            <button
              onClick={onCancel}
              className="px-5 py-3 text-xs font-medium tracking-widest uppercase border border-gray-200 text-gray-600 rounded-full hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={confirm}
              className="px-6 py-3 text-xs font-medium tracking-widest uppercase text-white rounded-full hover:opacity-90"
              style={{ backgroundColor: BRAND }}
            >
              Complete
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function AmountPrompt({ open, title, onConfirm, onCancel }) {
  return open ? <Panel title={title} onConfirm={onConfirm} onCancel={onCancel} /> : null
}
