import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../supabase'
import { supabaseCustomers } from '../supabaseCustomers'

const BRAND = '#E8420A'
const CREAM = '#FFFFFF'

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
        <p className="text-gray-400 text-sm">Loading...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-8" style={{ backgroundColor: CREAM }}>
        <p className="text-gray-500 text-sm mb-4">{error}</p>
        <a href="/" className="text-xs tracking-widest uppercase" style={{ color: BRAND }}>← Back to Home</a>
      </div>
    )
  }

  if (cancelled || booking.status === 'cancelled') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-8" style={{ backgroundColor: CREAM }}>
        <div className="text-center max-w-md">
          <h2 className="text-2xl font-light mb-3 text-gray-700">Booking Cancelled</h2>
          <p className="text-gray-400 text-sm mb-8">Your reservation has been cancelled. We hope to see you another time.</p>
          <a href="/reservations" className="text-xs tracking-widest uppercase" style={{ color: BRAND }}>
            Make a New Reservation
          </a>
        </div>
      </div>
    )
  }

  const isPast = booking.reservation_date < new Date().toISOString().split('T')[0]

  return (
    <div className="min-h-screen" style={{ backgroundColor: CREAM }}>
      <div className="max-w-md mx-auto px-8 py-16">

        <p className="text-xs tracking-widest uppercase mb-2" style={{ color: BRAND }}>
          Tonda Pizza Romana
        </p>
        <h1 className="text-3xl font-light text-gray-900 mb-8">Your Reservation</h1>

        <div className="bg-white rounded-2xl p-6 mb-6">
          <div className="mb-5 pb-5 border-b border-gray-100">
            <p className="text-xs tracking-widest uppercase text-gray-400 mb-3">Guest</p>
            <p className="font-medium text-gray-900">{booking.customers?.full_name}</p>
            <p className="text-sm text-gray-400">{booking.customers?.phone}</p>
            {booking.customers?.email && <p className="text-sm text-gray-400">{booking.customers.email}</p>}
          </div>

          <div className="mb-5 pb-5 border-b border-gray-100">
            <p className="text-xs tracking-widest uppercase text-gray-400 mb-3">Reservation Details</p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-gray-400">Date</p>
                <p className="text-sm font-medium text-gray-800">{booking.reservation_date}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Time</p>
                <p className="text-sm font-medium text-gray-800">{booking.reservation_time?.slice(0, 5)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Guests</p>
                <p className="text-sm font-medium text-gray-800">{booking.guest_count}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Status</p>
                <p className="text-sm font-medium capitalize" style={{ color: BRAND }}>{booking.status}</p>
              </div>
            </div>
            {booking.notes && (
              <div className="mt-4">
                <p className="text-xs text-gray-400">Special Requests</p>
                <p className="text-sm text-gray-700 mt-1">{booking.notes}</p>
              </div>
            )}
            {booking.baby_chairs > 0 && (
              <div className="mt-4">
                <p className="text-xs text-gray-400">Baby Chairs</p>
                <p className="text-sm text-gray-700 mt-1">{booking.baby_chairs}</p>
              </div>
            )}
            {booking.pets && (
              <div className="mt-4">
                <p className="text-xs text-gray-400">Pets</p>
                <p className="text-sm text-gray-700 mt-1">Yes</p>
              </div>
            )}
          </div>

          <p className="text-xs text-gray-400 leading-relaxed">
            Need to make changes? Please contact us directly via WhatsApp or call us.
          </p>
        </div>

        {!isPast && booking.status !== 'completed' && booking.status !== 'seated' && (
          <>
            {!showConfirm ? (
              <button
                onClick={() => setShowConfirm(true)}
                className="w-full py-3 text-sm tracking-widest uppercase border transition-colors hover:bg-white"
                style={{ borderColor: BRAND, color: BRAND }}>
                Cancel Reservation
              </button>
            ) : (
              <div className="bg-white rounded-2xl p-6 text-center">
                <p className="text-sm text-gray-600 mb-5">Are you sure you want to cancel this reservation?</p>
                <div className="flex gap-3">
                  <button onClick={() => setShowConfirm(false)}
                    className="flex-1 py-2.5 text-xs tracking-widest uppercase border border-gray-200 text-gray-500 hover:bg-gray-50 transition-colors rounded">
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
            style={{ color: '#B0C4DE' }}>
            ← Back to Home
          </a>
        </div>
      </div>
    </div>
  )
}