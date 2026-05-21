import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { useNavigate } from 'react-router-dom'
import logoBg from '../assets/Logo_2.png'
import hero from '../assets/Pork_Pepperoni.jpeg'

export default function Home() {
  const [isAdmin, setIsAdmin] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setIsAdmin(!!session)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setIsAdmin(!!session)
    })
    return () => subscription.unsubscribe()
  }, [])

  async function handleLogout() {
    await supabase.auth.signOut()
    navigate('/')
  }

  return (
    <div className="flex" style={{ height: '100vh', overflow: 'hidden' }}>

      {/* Left side */}
      <div className="w-full md:w-1/2 flex flex-col h-full"
        style={{ backgroundColor: '#FFFFFF' }}>

        {/* Top bar */}
        <div className="flex justify-end items-center px-10 md:px-16 py-5">
          {isAdmin ? (
            <button onClick={handleLogout}
              className="text-xs tracking-widest uppercase transition-colors"
              style={{ color: '#B0C4DE' }}
              onMouseEnter={e => e.target.style.color = '#E8420A'}
              onMouseLeave={e => e.target.style.color = '#B0C4DE'}>
              Log out
            </button>
          ) : (
            <a href="/admin/login"
              className="text-xs tracking-widest uppercase transition-colors"
              style={{ color: '#B0C4DE' }}
              onMouseEnter={e => e.target.style.color = '#E8420A'}
              onMouseLeave={e => e.target.style.color = '#B0C4DE'}>
              Staff Login
            </a>
          )}
        </div>

        {/* Main content */}
        <div className="flex flex-col justify-center flex-1 px-10 md:px-16 pb-8">
          <img src={logoBg} alt="Tonda Pizza Romana"
            className="w-40 mb-6 self-start" />

          <p className="text-xs tracking-widest uppercase mb-3" style={{ color: '#E8420A' }}>
            Taman Desa, Kuala Lumpur
          </p>

          <h1 className="text-4xl md:text-5xl font-light text-gray-900 mb-3 leading-tight">
            The Pizza<br />Romana
          </h1>

          <p className="text-gray-500 text-sm mb-8 leading-relaxed">
            Pet Friendly · Not Halal · Open Daily
          </p>

          <div className="flex flex-col gap-3 max-w-xs">
            <a href="/reservations"
              className="text-center py-3 px-6 text-sm font-medium tracking-widest uppercase text-white transition-opacity hover:opacity-90"
              style={{ backgroundColor: '#E8420A' }}>
              Make a Reservation
            </a>
            <a href="/events"
              className="text-center py-3 px-6 text-sm font-medium tracking-widest uppercase border transition-colors hover:bg-white"
              style={{ borderColor: '#E8420A', color: '#E8420A' }}>
              Book an Event
            </a>
            <a href="/offsite"
              className="text-center py-3 px-6 text-sm font-medium tracking-widest uppercase border transition-colors hover:bg-white"
              style={{ borderColor: '#E8420A', color: '#E8420A' }}>
              Off-Site Booking
            </a>
          </div>
        </div>
      </div>

      {/* Right side — hero photo, hidden on mobile */}
      <div className="hidden md:block md:w-1/2 relative overflow-hidden">
        <img
          src={hero}
          alt="Pepperoni Pizza"
          className="absolute inset-0 w-full h-full object-cover"
        />
      </div>

    </div>
  )
}
