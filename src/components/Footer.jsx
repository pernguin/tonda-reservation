import { useLocation } from 'react-router-dom'

export default function Footer() {
  const location = useLocation()
  const isAdminRoute = location.pathname.startsWith('/admin')

  if (isAdminRoute) {
    return (
      <footer className="py-8 px-8" style={{ backgroundColor: '#FFFFFF', borderTop: '1px solid #B0C4DE' }}>
        <div className="max-w-lg mx-auto flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="text-xs tracking-widest uppercase" style={{ color: '#E8420A' }}>
            Tonda Pizza Romana
          </p>
          <p className="text-xs text-gray-400">
            © 2025 · Taman Desa, Kuala Lumpur
          </p>
          <div className="flex gap-6">
            <a href="/reservations"
              className="text-xs tracking-widest uppercase text-gray-400 hover:text-gray-700 transition-colors">
              Reserve
            </a>
            <a href="/events"
              className="text-xs tracking-widest uppercase text-gray-400 hover:text-gray-700 transition-colors">
              Events
            </a>
            <a href="/offsite"
              className="text-xs tracking-widest uppercase text-gray-400 hover:text-gray-700 transition-colors">
              Off-Site
            </a>
          </div>
        </div>
      </footer>
    )
  }

  return (
    <footer className="py-8 px-8" style={{
      backgroundColor: 'var(--color-footer-bg)',
      borderTop: '1px solid var(--color-footer-card-border)',
      fontFamily: 'var(--font-body)'
    }}>
      <div className="max-w-lg mx-auto flex flex-col md:flex-row justify-between items-center gap-4">
        <p className="text-xs tracking-widest uppercase" style={{ color: 'var(--color-footer-link)' }}>
          Tonda Pizza Romana
        </p>
        <p className="text-xs" style={{ color: 'var(--color-footer-text)' }}>
          © 2025 · Taman Desa, Kuala Lumpur
        </p>
        <div className="flex gap-6">
          <a href="https://www.tondapizzaromana.com"
            className="text-xs tracking-widest uppercase transition-colors hover:opacity-70"
            style={{ color: 'var(--color-footer-link)' }}>
            ← Back to Site
          </a>
          <a href="/reservations"
            className="text-xs tracking-widest uppercase transition-colors hover:opacity-70"
            style={{ color: 'var(--color-footer-text)' }}>
            Reserve
          </a>
          <a href="/events"
            className="text-xs tracking-widest uppercase transition-colors hover:opacity-70"
            style={{ color: 'var(--color-footer-text)' }}>
            Events
          </a>
          <a href="/offsite"
            className="text-xs tracking-widest uppercase transition-colors hover:opacity-70"
            style={{ color: 'var(--color-footer-text)' }}>
            Off-Site
          </a>
        </div>
      </div>
    </footer>
  )
}
