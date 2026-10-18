import { lazy, Suspense } from 'react'
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
import RequireAuth from './components/RequireAuth'
import NewBookingAlert from './components/NewBookingAlert'
import { Loading } from './components/admin/States'

const Dashboard = lazy(() => import('./pages/admin/Dashboard'))
const Tables = lazy(() => import('./pages/admin/Tables'))
const Bookings = lazy(() => import('./pages/admin/Bookings'))
const SlotRules = lazy(() => import('./pages/admin/SlotRules'))
const Customers = lazy(() => import('./pages/admin/Customers'))
const AdminFeedback = lazy(() => import('./pages/admin/Feedback'))
const Login = lazy(() => import('./pages/admin/Login'))
const Settings = lazy(() => import('./pages/admin/Settings'))
const Experiences = lazy(() => import('./pages/admin/Experiences'))

function Layout() {
  const location = useLocation()
  const isHome = location.pathname === '/'
  const isStandalone = isHome || location.pathname === '/feedback'

  return (
    <>
      {!isStandalone && <Navbar />}
      {location.pathname.startsWith('/admin') && location.pathname !== '/admin/login' && <NewBookingAlert />}
      <Suspense fallback={<Loading />}>
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
        <Route path="/admin/feedback" element={<RequireAuth><AdminFeedback /></RequireAuth>} />
        <Route path="/admin/settings" element={<RequireAuth><Settings /></RequireAuth>} />
        <Route path="/admin/experiences" element={<RequireAuth><Experiences /></RequireAuth>} />
      </Routes>
      </Suspense>
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