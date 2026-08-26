import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { useNavigate, useLocation } from 'react-router-dom'
import logo from '../assets/Logo_2.png'

export default function Navbar() {
  const [isAdmin, setIsAdmin] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  const isAdminRoute = location.pathname.startsWith('/admin')

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
    <nav className="border-b border-gray-100 px-6 py-4 flex justify-between items-center"
      style={{
        backgroundColor: isAdminRoute ? '#1B3A6B' : 'var(--color-header-bg)',
        fontFamily: isAdminRoute ? undefined : 'var(--font-body)'
      }}>
      <a href="/" className="flex items-center gap-3">
        <img src={logo} alt="Tonda Pizza Romana" className="h-8 w-auto" />
        <span className="text-sm font-medium tracking-widest uppercase hidden md:block"
          style={{ color: isAdminRoute ? 'white' : 'var(--color-header-text)' }}>
          Pizza Romana
        </span>
      </a>
      <div className="flex items-center gap-6">
        {!isAdminRoute && (
          <a href="https://www.tondapizzaromana.com"
            className="text-xs tracking-widest uppercase transition-colors hover:opacity-70"
            style={{ color: 'var(--color-header-text)' }}>
            ← Back to Site
          </a>
        )}
        {isAdmin && (
          <button onClick={handleLogout}
            className="text-xs tracking-widest uppercase transition-colors"
            style={{ color: isAdminRoute ? 'white' : 'var(--color-header-text)' }}>
            Log out
          </button>
        )}
      </div>
    </nav>
  )
}
