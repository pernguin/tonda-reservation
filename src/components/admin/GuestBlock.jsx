import { useEffect, useRef, useState } from 'react'
import { supabaseCustomers } from '../../supabaseCustomers'
import { BRAND, SUCCESS } from '../../lib/adminTheme'
import { FILTER_INPUT_CLASS } from './FilterBar'
import { useSavedFlash } from '../../lib/useSavedFlash'
import { GUEST_TAGS } from '../../lib/guestPills'

export default function GuestBlock({ customer, onSaved, showToast }) {
  const [saved, flashSaved] = useSavedFlash()

  const [tagsBusy, setTagsBusy] = useState(false)
  const [pendingKey, setPendingKey] = useState(null)

  const [draft, setDraft] = useState(customer?.notes || '')
  const [focused, setFocused] = useState(false)
  const [prevNotes, setPrevNotes] = useState(customer?.notes ?? null)

  const [birthdayDraft, setBirthdayDraft] = useState(customer?.birthdate || '')
  const [birthdayFocused, setBirthdayFocused] = useState(false)
  const [birthdayBusy, setBirthdayBusy] = useState(false)
  const [prevBirthdate, setPrevBirthdate] = useState(customer?.birthdate ?? null)

  const draftRef = useRef(draft)
  const notesRef = useRef(customer?.notes ?? null)
  const idRef = useRef(customer?.id)
  const showToastRef = useRef(showToast)
  const onSavedRef = useRef(onSaved)
  // null means "nothing in flight" - distinct from having sent an empty string.
  const lastSentRef = useRef(null)

  // Keep refs current for the unmount-save cleanup below, without setState in an effect.
  useEffect(() => {
    draftRef.current = draft
    notesRef.current = customer?.notes ?? null
    idRef.current = customer?.id
    showToastRef.current = showToast
    onSavedRef.current = onSaved
  })

  // Notes typed but not yet blurred are saved when the row collapses (unmount). Guard against
  // notesRef being stale (the blur save's refetch hasn't landed yet) by also comparing against
  // the last value we've already sent/are sending, so the same content is never sent twice.
  useEffect(() => {
    return () => {
      const finalDraft = draftRef.current.trim()
      const original = (notesRef.current || '').trim()
      if (finalDraft === original) return
      if (lastSentRef.current !== null && finalDraft === lastSentRef.current.trim()) return
      lastSentRef.current = finalDraft
      supabaseCustomers.from('customers').update({ notes: finalDraft || null }).eq('id', idRef.current)
        .then(({ error }) => {
          if (error) showToastRef.current('Could not save notes: ' + error.message)
          else onSavedRef.current().then(() => { lastSentRef.current = null })
        })
    }
  }, [])

  const dirty = customer ? draft.trim() !== (customer.notes || '').trim() : false

  // Adjust state during render instead of in an effect: re-sync draft from a refetched
  // customer.notes, but only when the guest isn't mid-typing (not focused, not dirty).
  if (customer && customer.notes !== prevNotes) {
    setPrevNotes(customer.notes)
    if (!focused && !dirty) {
      setDraft(customer.notes || '')
    }
  }

  // Same pattern for the birthday draft: re-sync from a refetched customer.birthdate, but only
  // when the guest isn't mid-editing (not focused) and no save is in flight.
  if (customer && customer.birthdate !== prevBirthdate) {
    setPrevBirthdate(customer.birthdate)
    if (!birthdayFocused && !birthdayBusy) {
      setBirthdayDraft(customer.birthdate || '')
    }
  }

  if (!customer) return null

  const tags = customer.tags ?? []

  async function toggleTag(key) {
    if (tagsBusy) return
    const current = customer.tags ?? []
    const next = current.includes(key) ? current.filter((k) => k !== key) : [...current, key]
    setPendingKey(key)
    setTagsBusy(true)
    try {
      const { error } = await supabaseCustomers.from('customers').update({ tags: next }).eq('id', customer.id)
      if (error) {
        showToast('Could not save tags: ' + error.message)
        return
      }
      flashSaved()
      await onSaved()
    } finally {
      setTagsBusy(false)
      setPendingKey(null)
    }
  }

  async function saveBirthday(value) {
    setBirthdayBusy(true)
    try {
      const { error } = await supabaseCustomers.from('customers').update({ birthdate: value || null }).eq('id', customer.id)
      if (error) {
        showToast('Could not save birthday: ' + error.message)
        return
      }
      flashSaved()
      await onSaved()
    } finally {
      setBirthdayBusy(false)
    }
  }

  function handleBirthdayBlur() {
    setBirthdayFocused(false)
    const current = customer.birthdate || ''
    if (birthdayDraft === current) return
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birthdayDraft)) {
      setBirthdayDraft(current)
      return
    }
    saveBirthday(birthdayDraft)
  }

  async function saveNotesIfChanged() {
    const trimmed = draft.trim()
    const original = (customer.notes || '').trim()
    if (trimmed === original) return
    if (lastSentRef.current !== null && trimmed === lastSentRef.current.trim()) return
    const previousSent = lastSentRef.current
    lastSentRef.current = trimmed
    const { error } = await supabaseCustomers.from('customers').update({ notes: trimmed || null }).eq('id', customer.id)
    if (error) {
      lastSentRef.current = previousSent
      showToast('Could not save notes: ' + error.message)
      return
    }
    flashSaved()
    await onSaved()
    lastSentRef.current = null
  }

  function handleBlur() {
    setFocused(false)
    saveNotesIfChanged()
  }

  return (
    <div className="mt-3 mb-2 pt-3 border-t border-gray-200">
      <div className="flex items-baseline justify-between">
        <p className="text-xs tracking-widest uppercase text-gray-400 mb-2">
          Guest · applies to all of this guest's bookings (Round &amp; Tonda)
        </p>
        {saved && <span className="text-xs" style={{ color: SUCCESS }}>Saved ✓</span>}
      </div>

      <p className="text-xs tracking-widest uppercase text-gray-400 mb-1">Tags</p>
      <div className="flex flex-wrap gap-2 mb-3">
        {GUEST_TAGS.map((tag) => {
          const currentlyOn = tags.includes(tag.key)
          const on = tagsBusy && pendingKey === tag.key ? !currentlyOn : currentlyOn
          return (
            <button key={tag.key} type="button" aria-pressed={on} disabled={tagsBusy}
              onClick={() => toggleTag(tag.key)}
              className="min-h-10 px-3 text-xs font-medium tracking-wide rounded transition-colors disabled:opacity-60"
              style={on ? { backgroundColor: BRAND, color: 'white' } : { backgroundColor: '#f3f4f6', color: '#6b7280' }}>
              {tag.label}
            </button>
          )
        })}
      </div>

      <p className="text-xs tracking-widest uppercase text-gray-400 mb-1">Birthday</p>
      <div className="flex items-center mb-3">
        <input type="date" value={birthdayDraft} disabled={birthdayBusy}
          onFocus={() => setBirthdayFocused(true)}
          onChange={(e) => setBirthdayDraft(e.target.value)}
          onBlur={handleBirthdayBlur} className={FILTER_INPUT_CLASS} />
        {customer.birthdate && (
          <button type="button" onClick={() => saveBirthday('')} disabled={birthdayBusy}
            className="text-xs text-gray-500 hover:text-gray-800 ml-3">
            Clear
          </button>
        )}
      </div>

      <p className="text-xs tracking-widest uppercase text-gray-400 mb-1">Notes</p>
      <textarea rows={2} value={draft} className={FILTER_INPUT_CLASS + ' w-full resize-y'}
        onFocus={() => setFocused(true)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={handleBlur} />
    </div>
  )
}
