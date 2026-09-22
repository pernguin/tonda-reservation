import { useEffect, useMemo, useState } from 'react'
// Feedback lives in Round's Supabase project for both brands - see supabaseCustomers.
import { supabaseCustomers } from '../../supabaseCustomers'
import { useUrlStateBatch } from '../../lib/useUrlState'
import { BRAND } from '../../lib/adminTheme'
import AdminPage from '../../components/admin/AdminPage'
import FilterBar, { FilterField, FILTER_INPUT_CLASS } from '../../components/admin/FilterBar'
import { Loading, EmptyState } from '../../components/admin/States'

const PAGE_SIZE = 20

function formatDate(value) {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function Feedback() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [updatingId, setUpdatingId] = useState(null)

  const [view, setView] = useUrlStateBatch({ from: '', to: '', page: '1' })
  const dateFrom = view.from
  const dateTo = view.to

  useEffect(() => { fetchFeedback() }, [dateFrom, dateTo])

  async function fetchFeedback() {
    setLoading(true)
    let query = supabaseCustomers
      .from('feedback')
      .select('*, customers(full_name)')
      .order('created_at', { ascending: false })

    // Tonda's panel never shows Round's feedback.
    query = query.eq('restaurant', 'tonda')
    if (dateFrom) query = query.gte('created_at', dateFrom)
    if (dateTo) query = query.lte('created_at', `${dateTo}T23:59:59`)

    const { data, error } = await query
    setRows(error ? [] : (data || []))
    setLoading(false)
  }

  async function markRedeemed(id) {
    setUpdatingId(id)
    const redeemedAt = new Date().toISOString()
    const { error } = await supabaseCustomers
      .from('feedback')
      .update({ voucher_redeemed: true, voucher_redeemed_at: redeemedAt })
      .eq('id', id)

    if (!error) {
      setRows(prev => prev.map(r => r.id === id ? { ...r, voucher_redeemed: true, voucher_redeemed_at: redeemedAt } : r))
    }
    setUpdatingId(null)
  }

  const stats = useMemo(() => {
    const total = rows.length
    const promoters = rows.filter(r => r.nps_score >= 6).length
    const detractors = rows.filter(r => r.nps_score <= 5).length
    const avgNps = total ? rows.reduce((sum, r) => sum + r.nps_score, 0) / total : 0
    const vouchersIssued = rows.filter(r => r.voucher_code).length
    const vouchersRedeemed = rows.filter(r => r.voucher_code && r.voucher_redeemed).length
    return {
      total,
      avgNps: total ? avgNps.toFixed(1) : '—',
      promoterPct: total ? Math.round((promoters / total) * 100) : 0,
      detractorPct: total ? Math.round((detractors / total) * 100) : 0,
      vouchersIssued,
      vouchersRedeemed,
    }
  }, [rows])

  const tagCounts = useMemo(() => {
    const counts = {}
    rows.forEach(r => (r.tags || []).forEach(tag => { counts[tag] = (counts[tag] || 0) + 1 }))
    return Object.entries(counts).sort((a, b) => b[1] - a[1])
  }, [rows])

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const page = Math.min(Math.max(1, Number(view.page) || 1), totalPages)
  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const statCards = [
    { label: 'Total Responses', value: stats.total },
    { label: 'Average NPS', value: stats.avgNps },
    { label: 'Promoters', value: `${stats.promoterPct}%` },
    { label: 'Detractors', value: `${stats.detractorPct}%` },
    { label: 'Vouchers Issued / Redeemed', value: `${stats.vouchersIssued} / ${stats.vouchersRedeemed}` },
  ]

  const hasFilters = !!dateFrom || !!dateTo

  return (
    <AdminPage width="5xl" title="Feedback" subtitle="Guest NPS responses and voucher tracking">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-10">
        {statCards.map(card => (
          <div key={card.label} className="border border-gray-100 rounded-xl p-4">
            <p className="text-xs tracking-widest uppercase text-gray-400 mb-2">{card.label}</p>
            <p className="text-2xl font-light" style={{ color: BRAND }}>{card.value}</p>
          </div>
        ))}
      </div>


      <FilterBar hasFilters={hasFilters} onClear={() => setView({ from: '', to: '', page: '1' })} mb="8">
        <FilterField label="From">
          <input type="date" value={dateFrom} onChange={e => setView({ from: e.target.value, page: '1' })}
            className={FILTER_INPUT_CLASS} />
        </FilterField>
        <FilterField label="To">
          <input type="date" value={dateTo} onChange={e => setView({ to: e.target.value, page: '1' })}
            className={FILTER_INPUT_CLASS} />
        </FilterField>
      </FilterBar>

      {tagCounts.length > 0 && (
        <div className="mb-8">
          <p className="text-xs tracking-widest uppercase text-gray-400 mb-3">Tag Frequency</p>
          <div className="flex flex-wrap gap-2">
            {tagCounts.map(([tag, count]) => (
              <span key={tag} className="px-3 py-1.5 text-xs font-medium rounded-full bg-gray-100 text-gray-600">
                {tag} <span className="text-gray-400">· {count}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <Loading />
      ) : rows.length === 0 ? (
        <EmptyState message="No feedback found." />
      ) : (
        <>
          <div className="overflow-x-auto -mx-2">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left font-normal text-xs tracking-widest uppercase text-gray-400 px-2 py-2">Date</th>
                  <th className="text-left font-normal text-xs tracking-widest uppercase text-gray-400 px-2 py-2">Customer</th>
                  <th className="text-left font-normal text-xs tracking-widest uppercase text-gray-400 px-2 py-2">NPS</th>
                  <th className="text-left font-normal text-xs tracking-widest uppercase text-gray-400 px-2 py-2">Tags</th>
                  <th className="text-left font-normal text-xs tracking-widest uppercase text-gray-400 px-2 py-2">Comment</th>
                  <th className="text-left font-normal text-xs tracking-widest uppercase text-gray-400 px-2 py-2">Voucher</th>
                  <th className="text-left font-normal text-xs tracking-widest uppercase text-gray-400 px-2 py-2">Expires</th>
                  <th className="text-left font-normal text-xs tracking-widest uppercase text-gray-400 px-2 py-2">Redeemed</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map(r => {
                  const isPromoter = r.nps_score >= 6
                  const isExpired = r.voucher_code && !r.voucher_redeemed && r.voucher_expires_at && new Date(r.voucher_expires_at) < new Date()
                  return (
                    <tr key={r.id} className="border-b border-gray-100 align-top">
                      <td className="px-2 py-3 text-gray-500 whitespace-nowrap">{formatDate(r.created_at)}</td>
                      <td className="px-2 py-3 text-gray-900">{r.customers?.full_name || '—'}</td>
                      <td className="px-2 py-3">
                        <span className={`font-medium ${isPromoter ? 'text-green-600' : 'text-red-500'}`}>{r.nps_score}</span>
                      </td>
                      <td className="px-2 py-3">
                        <div className="flex flex-wrap gap-1 max-w-[160px]">
                          {(r.tags || []).map(tag => (
                            <span key={tag} className="px-2 py-0.5 text-xs rounded-full bg-gray-100 text-gray-600">{tag}</span>
                          ))}
                        </div>
                      </td>
                      <td className="px-2 py-3 text-gray-600 max-w-[220px]">
                        <p className="truncate" title={r.comment || ''}>{r.comment || '—'}</p>
                      </td>
                      <td className="px-2 py-3 text-gray-700 font-medium whitespace-nowrap">{r.voucher_code || '—'}</td>
                      <td className="px-2 py-3 text-gray-500 whitespace-nowrap">{r.voucher_code ? formatDate(r.voucher_expires_at) : '—'}</td>
                      <td className="px-2 py-3 whitespace-nowrap">
                        {!r.voucher_code ? (
                          <span className="text-gray-300">—</span>
                        ) : r.voucher_redeemed ? (
                          <button disabled
                            className="text-xs font-medium tracking-wide px-3 py-1.5 rounded-full bg-green-100 text-green-700 disabled:opacity-100">
                            Redeemed ✓
                          </button>
                        ) : isExpired ? (
                          <span className="text-xs font-medium text-red-500">Expired</span>
                        ) : (
                          <button onClick={() => markRedeemed(r.id)} disabled={updatingId === r.id}
                            className="text-xs font-medium tracking-widest uppercase px-3 py-1.5 rounded-full border transition-colors disabled:opacity-40"
                            style={{ borderColor: BRAND, color: BRAND }}>
                            {updatingId === r.id ? 'Saving...' : 'Mark redeemed'}
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-4 mt-8">
              <button onClick={() => setView({ page: String(Math.max(1, page - 1)) })} disabled={page === 1}
                className="px-4 py-2 text-xs tracking-widest uppercase border border-gray-200 text-gray-600 hover:bg-gray-50 rounded-full transition-colors disabled:opacity-40">
                Prev
              </button>
              <p className="text-xs text-gray-400 tracking-widest uppercase">Page {page} of {totalPages}</p>
              <button onClick={() => setView({ page: String(Math.min(totalPages, page + 1)) })} disabled={page === totalPages}
                className="px-4 py-2 text-xs tracking-widest uppercase border border-gray-200 text-gray-600 hover:bg-gray-50 rounded-full transition-colors disabled:opacity-40">
                Next
              </button>
            </div>
          )}
        </>
      )}
    </AdminPage>
  )
}
