import { useState } from 'react'
import { supabase } from '../../supabase'
import { useNavigate } from 'react-router-dom'
import logo from '../../assets/Logo_2.png'

const BRAND = '#E8420A'
const CREAM = '#FFFFFF'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  async function handleLogin(e) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      setError('Incorrect email or password.')
      setLoading(false)
    } else {
      navigate('/admin')
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-8"
      style={{ backgroundColor: CREAM }}>

      <div className="w-full max-w-sm">
        <div className="text-center mb-12">
          <img src={logo} alt="Round" className="h-10 w-auto mx-auto mb-6" />
          <p className="text-xs tracking-widest uppercase text-gray-400">Staff Access</p>
        </div>

        {error && (
          <div className="border-l-2 pl-4 mb-8 py-2" style={{ borderColor: BRAND }}>
            <p className="text-sm text-gray-700">{error}</p>
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-8">
          <div>
            <label className="block text-xs tracking-widest uppercase mb-1 text-gray-500">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              placeholder="your@email.com"
              className="w-full border-b border-gray-300 bg-transparent py-3 text-sm text-gray-800 focus:outline-none focus:border-gray-800 transition-colors placeholder-gray-400"
            />
          </div>
          <div>
            <label className="block text-xs tracking-widest uppercase mb-1 text-gray-500">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              placeholder="••••••••"
              className="w-full border-b border-gray-300 bg-transparent py-3 text-sm text-gray-800 focus:outline-none focus:border-gray-800 transition-colors placeholder-gray-400"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full py-4 text-sm font-medium tracking-widest uppercase text-white transition-opacity hover:opacity-90 disabled:opacity-40"
            style={{ backgroundColor: BRAND }}>
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <div className="text-center mt-8">
          <a href="/"
            className="text-xs tracking-widest uppercase transition-colors"
            style={{ color: '#B0C4DE' }}
            onMouseEnter={e => e.target.style.color = BRAND}
            onMouseLeave={e => e.target.style.color = '#B0C4DE'}>
            ← Back to Home
          </a>
        </div>
      </div>
    </div>
  )
}