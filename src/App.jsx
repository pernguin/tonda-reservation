import ManageBooking from './pages/ManageBooking'
import Feedback from './pages/Feedback'
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom'
import Navbar from './components/Navbar'
import Footer from './components/Footer'
import Home from './pages/Home'
import Reservations from './pages/Reservations'
import Events from './pages/Events'
import Offsite from './pages/Offsite'
import ExperienceDetail from './pages/ExperienceDetail'
import Dashboard from './pages/admin/Dashboard'
import Tables from './pages/admin/Tables'
import Bookings from './pages/admin/Bookings'
import SlotRules from './pages/admin/SlotRules'
import Customers from './pages/admin/Customers'
import Login from './pages/admin/Login'
import RequireAuth from './components/RequireAuth'
import AdminNav from './components/AdminNav'
import Settings from './pages/admin/Settings'
import Experiences from './pages/admin/Experiences'

function Layout() {
  const location = useLocation()
  const isHome = location.pathname === '/'
  const isStandalone = isHome || location.pathname === '/feedback'

  return (
    <>
      {!isStandalone && <Navbar />}
      {location.pathname.startsWith('/admin') && location.pathname !== '/admin/login' && <AdminNav />}
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/reservations" element={<Reservations />} />
        <Route path="/events" element={<Events />} />
        <Route path="/offsite" element={<Offsite />} />
        <Route path="/experiences/:id" element={<ExperienceDetail />} />
        <Route path="/booking/:id" element={<ManageBooking />} />
        <Route path="/feedback" element={<Feedback />} />
        <Route path="/admin/login" element={<Login />} />
        <Route path="/admin" element={<RequireAuth><Dashboard /></RequireAuth>} />
        <Route path="/admin/tables" element={<RequireAuth><Tables /></RequireAuth>} />
        <Route path="/admin/bookings" element={<RequireAuth><Bookings /></RequireAuth>} />
        <Route path="/admin/slot-rules" element={<RequireAuth><SlotRules /></RequireAuth>} />
        <Route path="/admin/customers" element={<RequireAuth><Customers /></RequireAuth>} />
        <Route path="/admin/settings" element={<RequireAuth><Settings /></RequireAuth>} />
        <Route path="/admin/experiences" element={<RequireAuth><Experiences /></RequireAuth>} />
      </Routes>
      {!isStandalone && <Footer />}
    </>
  )
}

function App() {
  return (
    <BrowserRouter>
      <Layout />
    </BrowserRouter>
  )
}

export default App