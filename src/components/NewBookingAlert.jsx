import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import AdminNav from './AdminNav'
import { useReservationInserts } from '../lib/useReservationInserts'
import { useChime } from '../lib/useChime'
import { describeBooking } from '../lib/bookingSummary'
import { BRAND } from '../lib/adminTheme'

// Owns the "new reservation" queue for the admin shell and renders the nav + banner.
export default function NewBookingAlert() {
  const [queue, setQueue] = useState([])
  const { soundOn, primed, toggle, play } = useChime()
  const location = useLocation()
  const navigate = useNavigate()
  const pathnameRef = useRef(location.pathname)
  useEffect(() => { pathnameRef.current = location.pathname }, [location.pathname])

  const onInsert = useCallback(row => {
    if (soundOn) play()
    if (pathnameRef.current !== '/admin/bookings') setQueue(q => [row, ...q])
  }, [soundOn, play])
  useReservationInserts(onInsert)

  // Adjust state during render (rather than in an effect) when navigating to the
  // Bookings page clears the queue — see https://react.dev/learn/you-might-not-need-an-effect
  const [clearedFor, setClearedFor] = useState(location.pathname)
  if (location.pathname !== clearedFor) {
    setClearedFor(location.pathname)
    if (location.pathname === '/admin/bookings') setQueue([])
  }

  const latest = queue[0]

  return (
    <>
      <AdminNav unseenCount={queue.length} soundOn={soundOn} onToggleSound={toggle} />
      {latest && (
        <div className="px-6 py-3 text-white" style={{ backgroundColor: BRAND }} role="status">
          <div className="max-w-3xl mx-auto flex items-center gap-4 flex-wrap">
            <p className="text-sm flex-1 min-w-0">
              <span className="font-medium">
                {queue.length > 1 ? `${queue.length} new reservations` : 'New reservation'}
              </span>
              {' — '}{describeBooking(latest)}
              {soundOn && !primed && <span className="ml-2 text-xs opacity-75">(tap anywhere to enable sound)</span>}
            </p>
            <button type="button" onClick={() => { setQueue([]); navigate('/admin/bookings') }}
              className="text-xs tracking-widest uppercase font-medium px-3 py-1.5 bg-white rounded" style={{ color: BRAND }}>
              View
            </button>
            <button type="button" onClick={() => setQueue([])}
              className="text-xs tracking-widest uppercase opacity-75 hover:opacity-100 transition-opacity">
              Dismiss
            </button>
          </div>
        </div>
      )}
    </>
  )
}
