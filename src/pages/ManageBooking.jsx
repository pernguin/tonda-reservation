import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../supabase'
import { supabaseCustomers } from '../supabaseCustomers'

const BRAND = 'var(--color-accent)'
const CREAM = 'var(--color-bg)'

export default function ManageBooking() {
  const { id } = useParams()
  const [booking, setBooking] = useState(null)
  const [loading, setLoading] = useState(true)
  const [cancelled, setCancelled] = useState(false)
  const [error, setError] = useState(null)
  const [cancelling, setCancelling] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

  useEffect(() => { fetchBooking() }, [id])

  async function fetchBooking() {
    setLoading(true)
    const { data, error } = await supabase
      .from('reservations')
      .select('*')
      .eq('id', id)
      .single()
    if (error || !data) {
      setError('Booking not found.')
      setLoading(false)
      return
    }

    let customer
    if (data.customer_id) {
      const { data: customerData } = await supabaseCustomers
        .from('customers')
        .select('id, full_name, phone, email')
        .eq('id', data.customer_id)
        .single()
      customer = customerData
    }

    setBooking({ ...data, customers: customer })
    setLoading(false)
  }

  async function cancelBooking() {
    setCancelling(true)
    const { error } = await supabase
      .from('reservations')
      .update({ status: 'cancelled' })
      .eq('id', id)
    if (error) {
      setError('Something went wrong. Please try again.')
    } else {
      setCancelled(true)
    }
    setCancelling(false)
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: CREAM }}>
        <p className="text-[var(--color-text-muted)] text-sm">Loading...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-8" style={{ backgroundColor: CREAM }}>
        <p className="text-[var(--color-text-2)] text-sm mb-4">{error}</p>
        <a href="/" className="text-xs tracking-widest uppercase" style={{ color: BRAND }}>← Back to Home</a>
      </div>
    )
  }

  if (cancelled || booking.status === 'cancelled') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-8" style={{ backgroundColor: CREAM }}>
        <div className="text-center max-w-md">
          <h2 className="text-2xl mb-3" style={{ color: 'var(--color-text-2)', fontFamily: 'var(--font-heading)', fontWeight: 'var(--font-weight-heading)', fontStyle: 'var(--font-heading-style)' }}>Booking Cancelled</h2>
          <p className="text-[var(--color-text-muted)] text-sm mb-8">Your reservation has been cancelled. We hope to see you another time.</p>
          <a href="/reservations" className="text-xs tracking-widest uppercase" style={{ color: BRAND }}>
            Make a New Reservation
          </a>
        </div>
      </div>
    )
  }

  const isPast = booking.reservation_date < new Date().toISOString().split('T')[0]

  return (
    <div className="min-h-screen" style={{ backgroundColor: CREAM, fontFamily: 'var(--font-body)' }}>
      <div className="max-w-md mx-auto px-8 py-16">

        <p className="text-xs tracking-widest uppercase mb-2" style={{ color: BRAND }}>
          Tonda Pizza Romana
        </p>
        <h1 className="text-3xl mb-8" style={{ color: 'var(--color-text)', fontFamily: 'var(--font-heading)', fontWeight: 'var(--font-weight-heading)', fontStyle: 'var(--font-heading-style)' }}>Your Reservation</h1>

        <div className="bg-[var(--color-surface)] rounded-2xl p-6 mb-6">
          <div className="mb-5 pb-5 border-b border-[var(--color-border)]">
            <p className="text-xs tracking-widest uppercase text-[var(--color-text-muted)] mb-3">Guest</p>
            <p className="font-medium text-[var(--color-text)]">{booking.customers?.full_name}</p>
            <p className="text-sm text-[var(--color-text-muted)]">{booking.customers?.phone}</p>
            {booking.customers?.email && <p className="text-sm text-[var(--color-text-muted)]">{booking.customers.email}</p>}
          </div>

          <div className="mb-5 pb-5 border-b border-[var(--color-border)]">
            <p className="text-xs tracking-widest uppercase text-[var(--color-text-muted)] mb-3">Reservation Details</p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-[var(--color-text-muted)]">Date</p>
                <p className="text-sm font-medium text-[var(--color-text)]">{booking.reservation_date}</p>
              </div>
              <div>
                <p className="text-xs text-[var(--color-text-muted)]">Time</p>
                <p className="text-sm font-medium text-[var(--color-text)]">{booking.reservation_time?.slice(0, 5)}</p>
              </div>
              <div>
                <p className="text-xs text-[var(--color-text-muted)]">Guests</p>
                <p className="text-sm font-medium text-[var(--color-text)]">{booking.guest_count}</p>
              </div>
              <div>
                <p className="text-xs text-[var(--color-text-muted)]">Status</p>
                <p className="text-sm font-medium capitalize" style={{ color: BRAND }}>{booking.status}</p>
              </div>
            </div>
            {booking.notes && (
              <div className="mt-4">
                <p className="text-xs text-[var(--color-text-muted)]">Special Requests</p>
                <p className="text-sm text-[var(--color-text-2)] mt-1">{booking.notes}</p>
              </div>
            )}
            {booking.baby_chairs > 0 && (
              <div className="mt-4">
                <p className="text-xs text-[var(--color-text-muted)]">Baby Chairs</p>
                <p className="text-sm text-[var(--color-text-2)] mt-1">{booking.baby_chairs}</p>
              </div>
            )}
            {booking.pets && (
              <div className="mt-4">
                <p className="text-xs text-[var(--color-text-muted)]">Pets</p>
                <p className="text-sm text-[var(--color-text-2)] mt-1">Yes</p>
              </div>
            )}
          </div>

          <p className="text-xs text-[var(--color-text-muted)] leading-relaxed">
            Need to make changes? Please contact us directly via WhatsApp or call us.
          </p>
        </div>

        {!isPast && booking.status !== 'completed' && booking.status !== 'seated' && (
          <>
            {!showConfirm ? (
              <button
                onClick={() => setShowConfirm(true)}
                className="w-full py-3 text-sm tracking-widest uppercase border transition-colors hover:bg-[var(--color-surface)]"
                style={{ borderColor: BRAND, color: BRAND }}>
                Cancel Reservation
              </button>
            ) : (
              <div className="bg-[var(--color-surface)] rounded-2xl p-6 text-center">
                <p className="text-sm text-[var(--color-text-2)] mb-5">Are you sure you want to cancel this reservation?</p>
                <div className="flex gap-3">
                  <button onClick={() => setShowConfirm(false)}
                    className="flex-1 py-2.5 text-xs tracking-widest uppercase border border-[var(--color-border)] text-[var(--color-text-2)] hover:bg-[var(--color-surface-2)] transition-colors rounded">
                    Keep It
                  </button>
                  <button onClick={cancelBooking} disabled={cancelling}
                    className="flex-1 py-2.5 text-xs tracking-widest uppercase text-white transition-opacity hover:opacity-90 disabled:opacity-40 rounded"
                    style={{ backgroundColor: BRAND }}>
                    {cancelling ? 'Cancelling...' : 'Yes, Cancel'}
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        <div className="text-center mt-8">
          <a href="/" className="text-xs tracking-widest uppercase transition-colors"
            style={{ color: 'var(--color-border)' }}>
            ← Back to Home
          </a>
        </div>
      </div>
    </div>
  )
}