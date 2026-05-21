import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { useNavigate } from 'react-router-dom'
import logo from '../assets/Logo_2.png'

export default function Navbar() {
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
    <nav className="border-b border-gray-100 px-6 py-4 flex justify-between items-center"
      style={{ backgroundColor: '#1B3A6B' }}>
      <a href="/" className="flex items-center gap-3">
        <img src={logo} alt="Tonda Pizza Romana" className="h-8 w-auto" />
        <span className="text-sm font-medium tracking-widest uppercase hidden md:block"
          style={{ color: 'white' }}>
          Pizza Romana
        </span>
      </a>
      {isAdmin && (
        <button onClick={handleLogout}
          className="text-xs tracking-widest uppercase transition-colors"
          style={{ color: 'white' }}>
          Log out
        </button>
      )}
    </nav>
  )
}
