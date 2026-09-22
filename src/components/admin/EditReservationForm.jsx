import { useState } from 'react'
import { supabase } from '../../supabase'
import { BRAND } from '../../lib/adminTheme'
import { FILTER_INPUT_CLASS } from './FilterBar'

// Amending a booking has to re-run table assignment server-side (assign_tables is
// revoked from the client), so this goes through the amend_reservation_atomic RPC
// rather than a direct update. Customer name/phone/email are deliberately not
// editable here -- they live on the customers record, which is a separate concern.
export default function EditReservationForm({ r, onSaved, onCancel }) {
  const [form, setForm] = useState({
    reservation_date: r.reservation_date,
    reservation_time: r.reservation_time?.slice(0, 5) || '',
    guest_count: String(r.guest_count ?? ''),
    notes: r.notes || '',
    baby_chairs: String(r.baby_chairs ?? 0),
    pets: !!r.pets,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const set = (name, value) => setForm(prev => ({ ...prev, [name]: value }))

  async function save() {
    setSaving(true)
    setError(null)

    const { data, error: rpcError } = await supabase
      .rpc('amend_reservation_atomic', {
        p_id: r.id,
        p_reservation_date: form.reservation_date,
        p_reservation_time: form.reservation_time,
        p_guest_count: parseInt(form.guest_count),
        p_notes: form.notes.trim() || null,
        p_baby_chairs: parseInt(form.baby_chairs) || 0,
        p_pets: form.pets,
      })
      .single()

    if (rpcError) {
      // The RPC raises 'code: friendly message' -- show only the friendly half.
      const friendly = rpcError.message?.match(/^\w+: (.+)$/)
      setError(friendly ? friendly[1] : 'Could not save those changes.')
      setSaving(false)
      return
    }

    setSaving(false)
    onSaved(data)
  }

  const unchanged =
    form.reservation_date === r.reservation_date &&
    form.reservation_time === (r.reservation_time?.slice(0, 5) || '') &&
    form.guest_count === String(r.guest_count ?? '') &&
    form.notes === (r.notes || '') &&
    form.baby_chairs === String(r.baby_chairs ?? 0) &&
    form.pets === !!r.pets

  return (
    <div className="mb-3 pt-1" onClick={e => e.stopPropagation()}>
      <div className="flex flex-wrap gap-4 mb-3">
        <label className="flex flex-col">
          <span className="text-xs tracking-widest uppercase text-gray-400 mb-1">Date</span>
          <input type="date" value={form.reservation_date}
            onChange={e => set('reservation_date', e.target.value)} className={FILTER_INPUT_CLASS} />
        </label>
        <label className="flex flex-col">
          <span className="text-xs tracking-widest uppercase text-gray-400 mb-1">Time</span>
          <input type="time" value={form.reservation_time}
            onChange={e => set('reservation_time', e.target.value)} className={FILTER_INPUT_CLASS} />
        </label>
        <label className="flex flex-col">
          <span className="text-xs tracking-widest uppercase text-gray-400 mb-1">Guests</span>
          <input type="number" min="1" max="50" value={form.guest_count}
            onChange={e => set('guest_count', e.target.value)} className={`${FILTER_INPUT_CLASS} w-20`} />
        </label>
        <label className="flex flex-col">
          <span className="text-xs tracking-widest uppercase text-gray-400 mb-1">Baby chairs</span>
          <input type="number" min="0" max="10" value={form.baby_chairs}
            onChange={e => set('baby_chairs', e.target.value)} className={`${FILTER_INPUT_CLASS} w-20`} />
        </label>
        <label className="flex items-end gap-2 pb-2">
          <input type="checkbox" checked={form.pets}
            onChange={e => set('pets', e.target.checked)} className="w-4 h-4" />
          <span className="text-xs tracking-widest uppercase text-gray-400">Pets</span>
        </label>
      </div>

      <label className="flex flex-col mb-3">
        <span className="text-xs tracking-widest uppercase text-gray-400 mb-1">Notes</span>
        <input type="text" value={form.notes}
          onChange={e => set('notes', e.target.value)} className={FILTER_INPUT_CLASS} />
      </label>

      <p className="text-xs text-gray-400 mb-3">
        Changing the date, time or guest count re-runs table assignment. The guest is not emailed.
      </p>

      {error && <p className="text-xs mb-3" style={{ color: BRAND }}>{error}</p>}

      <div className="flex gap-4">
        <button type="button" onClick={save} disabled={saving || unchanged}
          className="text-xs font-medium tracking-wide disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ color: BRAND }}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        <button type="button" onClick={onCancel} disabled={saving}
          className="text-xs font-medium tracking-wide text-gray-400 hover:text-gray-600 disabled:opacity-40">
          Cancel
        </button>
      </div>
    </div>
  )
}
