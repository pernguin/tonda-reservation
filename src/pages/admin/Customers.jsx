import { useEffect, useState } from 'react'
import { supabaseCustomers } from '../../supabaseCustomers'

const BRAND = '#E8420A'
const PAGE_SIZE = 50
const LETTERS = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''), '#']
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
]
const LAST_VISITED_OPTIONS = [
  { value: '30', label: '30 days' },
  { value: '60', label: '60 days' },
  { value: '90', label: '90 days' },
  { value: '180', label: '180 days' },
  { value: '365', label: '1 year' }
]
const DEFAULT_FILTERS = {
  birthdayMonth: '',
  lastVisitedDays: '',
  minVisits: '',
  hasNoShows: false,
  emailConsent: false,
  smsConsent: false
}

function formatDate(value) {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function formatBirthday(value) {
  if (!value) return '—'
  const [, month, day] = value.split('-').map(Number)
  return new Date(2000, month - 1, day).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function countActiveFilters(f) {
  let n = 0
  if (f.birthdayMonth) n++
  if (f.lastVisitedDays) n++
  if (f.minVisits && Number(f.minVisits) > 0) n++
  if (f.hasNoShows) n++
  if (f.emailConsent) n++
  if (f.smsConsent) n++
  return n
}

function Toggle({ checked, onChange, label }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex items-center justify-between w-full py-3"
    >
      <span className="text-sm text-gray-700">{label}</span>
      <span
        className="w-10 h-6 rounded-full relative transition-colors shrink-0"
        style={{ backgroundColor: checked ? BRAND : '#e5e7eb' }}
      >
        <span
          className="absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform shadow"
          style={{ transform: checked ? 'translateX(18px)' : 'translateX(2px)' }}
        />
      </span>
    </button>
  )
}

export default function Customers() {
  const [customers, setCustomers] = useState([])
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [activeLetter, setActiveLetter] = useState(null)
  const [filters, setFilters] = useState(DEFAULT_FILTERS)
  const [draftFilters, setDraftFilters] = useState(DEFAULT_FILTERS)
  const [sheetMounted, setSheetMounted] = useState(false)
  const [sheetVisible, setSheetVisible] = useState(false)
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [toast, setToast] = useState('')

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => {
    fetchPage(0, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, activeLetter, filters])

  useEffect(() => {
    if (!sheetMounted) return
    const t = setTimeout(() => setSheetVisible(true), 10)
    return () => clearTimeout(t)
  }, [sheetMounted])

  async function fetchPage(pageNum, replace) {
    if (replace) setLoading(true)
    else setLoadingMore(true)
    setPage(pageNum)

    const from = pageNum * PAGE_SIZE

    function baseQuery(selectOptions) {
      let q = supabaseCustomers.from('customers').select('*', selectOptions).order('full_name', { ascending: true })

      const term = debouncedSearch.trim().replace(/,/g, '')
      if (term) {
        q = q.or(`full_name.ilike.%${term}%,phone.ilike.%${term}%,email.ilike.%${term}%`)
      }

      if (activeLetter === '#') {
        q = q.not('full_name', 'imatch', '^[a-zA-Z]')
      } else if (activeLetter) {
        q = q.ilike('full_name', `${activeLetter}%`)
      }

      if (filters.lastVisitedDays) {
        const cutoff = new Date()
        cutoff.setDate(cutoff.getDate() - Number(filters.lastVisitedDays))
        q = q.lt('last_visited_at', cutoff.toISOString())
      }
      if (filters.minVisits && Number(filters.minVisits) > 0) {
        q = q.gte('visit_count', Number(filters.minVisits))
      }
      if (filters.hasNoShows) q = q.gt('no_show_count', 0)
      if (filters.emailConsent) q = q.eq('marketing_email', true)
      if (filters.smsConsent) q = q.eq('marketing_sms', true)
      return q
    }

    if (filters.birthdayMonth) {
      // Birth month can't be filtered server-side without a DB-side generated
      // column/RPC (PostgREST has no EXTRACT() filter). PostgREST also caps every
      // response at its configured max-rows (1000 here) regardless of the range
      // requested, so a single query can silently miss most of the table — fetch
      // every row matching the other filters in max-rows-sized chunks, then
      // extract the month from the "YYYY-MM-DD" string (not new Date(), which is
      // timezone-sensitive) and paginate the matched set here.
      const CHUNK = 1000
      const { count } = await baseQuery({ count: 'exact', head: true })
      const chunkCount = Math.max(1, Math.ceil((count || 0) / CHUNK))
      const pages = await Promise.all(
        Array.from({ length: chunkCount }, (_, i) => baseQuery().range(i * CHUNK, i * CHUNK + CHUNK - 1))
      )
      const all = pages.flatMap(p => p.data || [])
      const month = parseInt(filters.birthdayMonth, 10)
      const matched = all.filter(c => c.birthdate && parseInt(c.birthdate.split('-')[1], 10) === month)
      const pageSlice = matched.slice(from, from + PAGE_SIZE)
      setCustomers(prev => replace ? pageSlice : [...prev, ...pageSlice])
      setHasMore(matched.length > from + PAGE_SIZE)
    } else {
      const to = from + PAGE_SIZE - 1
      const { data } = await baseQuery().range(from, to)
      setCustomers(prev => replace ? (data || []) : [...prev, ...(data || [])])
      setHasMore((data || []).length === PAGE_SIZE)
    }

    setLoading(false)
    setLoadingMore(false)
  }

  function loadMore() {
    const next = page + 1
    setPage(next)
    fetchPage(next, false)
  }

  function toggleLetter(l) {
    setActiveLetter(prev => (prev === l ? null : l))
  }

  function openFilterSheet() {
    setDraftFilters(filters)
    setSheetMounted(true)
  }

  function closeFilterSheet() {
    setSheetVisible(false)
    setTimeout(() => setSheetMounted(false), 300)
  }

  function applyFilters() {
    setFilters(draftFilters)
    closeFilterSheet()
  }

  function resetFilters() {
    setDraftFilters(DEFAULT_FILTERS)
    setFilters(DEFAULT_FILTERS)
  }

  function toggleSelect(id) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    setSelectedIds(prev => {
      const allSelected = customers.length > 0 && customers.every(c => prev.has(c.id))
      return allSelected ? new Set() : new Set(customers.map(c => c.id))
    })
  }

  function showToast(msg) {
    setToast(msg)
    setTimeout(() => setToast(''), 2500)
  }

  const activeFilterCount = countActiveFilters(filters)
  const allSelected = customers.length > 0 && customers.every(c => selectedIds.has(c.id))

  return (
    <div className={`min-h-screen bg-white p-4 md:p-8 max-w-4xl mx-auto ${selectedIds.size > 0 ? 'pb-24' : ''}`}>
      <p className="text-xs tracking-widest uppercase mb-1" style={{ color: BRAND }}>Admin</p>
      <h1 className="text-3xl font-light text-gray-900 mb-1">Customers</h1>
      <p className="text-gray-400 text-sm mb-8">All customer contact information and booking history</p>

      <div className="flex items-center gap-3 mb-4">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by name, phone or email..."
          className="flex-1 min-w-0 border-b border-gray-200 bg-transparent py-3 text-sm text-gray-800 focus:outline-none focus:border-gray-800 transition-colors placeholder-gray-400"
        />
        <button
          onClick={openFilterSheet}
          className="relative shrink-0 border border-gray-200 rounded-full px-4 py-2 text-xs font-medium tracking-widest uppercase text-gray-600 hover:bg-gray-50 transition-colors"
        >
          Filters
          {activeFilterCount > 0 && (
            <span
              className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full text-[10px] flex items-center justify-center text-white"
              style={{ backgroundColor: BRAND }}
            >
              {activeFilterCount}
            </span>
          )}
        </button>
      </div>

      {/* A-Z bar */}
      <div className="flex gap-1 overflow-x-auto pb-2 mb-6" style={{ scrollbarWidth: 'thin' }}>
        {LETTERS.map(l => (
          <button
            key={l}
            onClick={() => toggleLetter(l)}
            className="shrink-0 w-7 h-7 rounded-full text-xs font-medium transition-colors"
            style={activeLetter === l ? { backgroundColor: BRAND, color: 'white' } : { color: '#6b7280' }}
          >
            {l}
          </button>
        ))}
      </div>

      {/* Column headers */}
      <div className="flex items-center gap-3 py-2 border-b border-gray-200 mb-1">
        <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} className="shrink-0 w-4 h-4" />
        <div className="flex-1 min-w-0 text-xs tracking-widest uppercase text-gray-400">Guest</div>
        <div className="text-xs tracking-widest uppercase text-gray-400 w-20 text-center">Last Visited</div>
        <div className="text-xs tracking-widest uppercase text-gray-400 w-12 text-center">Visits</div>
        <div className="hidden md:block text-xs tracking-widest uppercase text-gray-400 w-16 text-center">Cancel</div>
        <div className="hidden md:block text-xs tracking-widest uppercase text-gray-400 w-16 text-center">No Show</div>
        <div className="hidden md:block text-xs tracking-widest uppercase text-gray-400 w-16 text-center">Birthdate</div>
        <div className="hidden md:block text-xs tracking-widest uppercase text-gray-400 w-12 text-center">Total</div>
      </div>

      {loading ? (
        <p className="text-gray-400 text-sm py-4">Loading...</p>
      ) : customers.length === 0 ? (
        <p className="text-gray-400 text-sm text-center py-10">No customers found.</p>
      ) : (
        <>
          {customers.map(c => (
            <div key={c.id} className="flex items-center gap-3 py-4 border-b border-gray-100">
              <input
                type="checkbox"
                checked={selectedIds.has(c.id)}
                onChange={() => toggleSelect(c.id)}
                className="shrink-0 w-4 h-4"
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900">{c.full_name}</p>
                <p className="text-xs text-gray-400">{c.phone}</p>
                {c.email && <p className="text-xs text-gray-400">{c.email}</p>}
              </div>
              <div className="text-xs text-gray-700 w-20 text-center">{formatDate(c.last_visited_at)}</div>
              <div className="text-sm text-gray-700 w-12 text-center">{c.visit_count || 0}</div>
              <div className="hidden md:block text-sm w-16 text-center" style={{ color: c.cancellation_count > 0 ? BRAND : '#9ca3af' }}>
                {c.cancellation_count || 0}
              </div>
              <div className="hidden md:block text-sm w-16 text-center" style={{ color: c.no_show_count > 0 ? '#f97316' : '#9ca3af' }}>
                {c.no_show_count || 0}
              </div>
              <div className="hidden md:block text-xs text-gray-500 w-16 text-center">{formatBirthday(c.birthdate)}</div>
              <div className="hidden md:block text-sm text-gray-400 w-12 text-center">{c.reservation_count || 0}</div>
            </div>
          ))}

          {hasMore && (
            <div className="flex justify-center py-6">
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="px-6 py-2 text-xs font-medium tracking-widest uppercase border border-gray-200 text-gray-600 hover:bg-gray-50 rounded-full transition-colors disabled:opacity-50"
              >
                {loadingMore ? 'Loading...' : 'Load More'}
              </button>
            </div>
          )}
        </>
      )}

      {/* Filter bottom sheet */}
      {sheetMounted && (
        <div className="fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-black transition-opacity duration-300"
            style={{ opacity: sheetVisible ? 0.4 : 0 }}
            onClick={closeFilterSheet}
          />
          <div
            className="absolute left-0 right-0 bottom-0 bg-white rounded-t-2xl px-6 pt-5 pb-8 max-h-[85vh] overflow-y-auto transition-transform duration-300"
            style={{ transform: sheetVisible ? 'translateY(0)' : 'translateY(100%)' }}
          >
            <div className="w-10 h-1 rounded-full bg-gray-200 mx-auto mb-5" />
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-light text-gray-900">Filters</h3>
              <button onClick={closeFilterSheet} className="text-gray-400 hover:text-gray-800 text-sm">✕</button>
            </div>

            <p className="text-xs tracking-widest uppercase text-gray-400 mb-2">Birthday Month</p>
            <select
              value={draftFilters.birthdayMonth}
              onChange={e => setDraftFilters(f => ({ ...f, birthdayMonth: e.target.value }))}
              className="w-full border-b border-gray-200 bg-transparent py-2 text-sm text-gray-800 focus:outline-none focus:border-gray-800 mb-5"
            >
              <option value="">Any month</option>
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>{m}</option>
              ))}
            </select>

            <p className="text-xs tracking-widest uppercase text-gray-400 mb-2">Last Visited More Than</p>
            <select
              value={draftFilters.lastVisitedDays}
              onChange={e => setDraftFilters(f => ({ ...f, lastVisitedDays: e.target.value }))}
              className="w-full border-b border-gray-200 bg-transparent py-2 text-sm text-gray-800 focus:outline-none focus:border-gray-800 mb-5"
            >
              <option value="">Any time</option>
              {LAST_VISITED_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label} ago</option>
              ))}
            </select>

            <p className="text-xs tracking-widest uppercase text-gray-400 mb-2">Minimum Visit Count</p>
            <input
              type="number"
              min="0"
              value={draftFilters.minVisits}
              onChange={e => setDraftFilters(f => ({ ...f, minVisits: e.target.value }))}
              placeholder="0"
              className="w-full border-b border-gray-200 bg-transparent py-2 text-sm text-gray-800 focus:outline-none focus:border-gray-800 mb-2"
            />

            <div className="mt-3 divide-y divide-gray-100">
              <Toggle
                label="Has no-shows"
                checked={draftFilters.hasNoShows}
                onChange={v => setDraftFilters(f => ({ ...f, hasNoShows: v }))}
              />
              <Toggle
                label="Marketing email consent"
                checked={draftFilters.emailConsent}
                onChange={v => setDraftFilters(f => ({ ...f, emailConsent: v }))}
              />
              <Toggle
                label="Marketing SMS consent"
                checked={draftFilters.smsConsent}
                onChange={v => setDraftFilters(f => ({ ...f, smsConsent: v }))}
              />
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={resetFilters}
                className="flex-1 py-3 rounded-lg border border-gray-200 text-xs font-medium tracking-widest uppercase text-gray-600 hover:bg-gray-50 transition-colors"
              >
                Reset
              </button>
              <button
                onClick={applyFilters}
                className="flex-1 py-3 rounded-lg text-xs font-medium tracking-widest uppercase text-white transition-opacity hover:opacity-90"
                style={{ backgroundColor: BRAND }}
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Campaign selection bar */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 md:px-8 py-3 flex items-center justify-between z-40 shadow-[0_-2px_10px_rgba(0,0,0,0.06)]">
          <p className="text-sm text-gray-700">{selectedIds.size} customer{selectedIds.size !== 1 ? 's' : ''} selected</p>
          <button
            onClick={() => showToast('Coming soon — WhatsApp integration')}
            className="px-5 py-2 text-xs font-medium tracking-widest uppercase text-white rounded-full transition-opacity hover:opacity-90"
            style={{ backgroundColor: BRAND }}
          >
            Start Campaign
          </button>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-xs px-4 py-2 rounded-full z-50 shadow-lg">
          {toast}
        </div>
      )}
    </div>
  )
}
