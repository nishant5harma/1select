import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/AuthContext'
import ErrorBoundary from './components/ErrorBoundary'
import CookieBanner from './components/CookieBanner'
import Login from './pages/Login'
import Signup from './pages/Signup'
import AdminLayout from './pages/admin/AdminLayout'
import AdminDashboard from './pages/admin/AdminDashboard'
import AdminClients from './pages/admin/AdminClients'
import AdminJobs from './pages/admin/AdminJobs'
import AdminPipeline from './pages/admin/AdminPipeline'
import AdminTalentPool from './pages/admin/AdminTalentPool'
import AdminSettings from './pages/admin/AdminSettings'
import AdminRecruiters from './pages/admin/AdminRecruiters'
import AdminAnalytics from './pages/admin/AdminAnalytics'
import RecruiterLayout from './pages/recruiter/RecruiterLayout'
import RecruiterDashboard from './pages/recruiter/RecruiterDashboard'
import RecruiterClients from './pages/recruiter/RecruiterClients'
import RecruiterJobs from './pages/recruiter/RecruiterJobs'
import RecruiterPipeline from './pages/recruiter/RecruiterPipeline'
import RecruiterCandidates from './pages/recruiter/RecruiterCandidates'
import RecruiterChat from './pages/recruiter/RecruiterChat'
import RecruiterReports from './pages/recruiter/RecruiterReports'
import RecruiterSettings from './pages/recruiter/RecruiterSettings'
import RecruiterLinkedInPool from './pages/recruiter/RecruiterLinkedInPool'
import ClientLayout from './pages/client/ClientLayout'
import ClientRegister from './pages/client/ClientRegister'
import ClientDashboard from './pages/client/ClientDashboard'
import ClientJobs from './pages/client/ClientJobs'
import ClientCandidates from './pages/client/ClientCandidates'
import ClientReports from './pages/client/ClientReports'
import ClientSettings from './pages/client/ClientSettings'
import ClientChat from './pages/client/ClientChat'
import PublicVideoInterview from './pages/PublicVideoInterview'
import PublicLiveInterview from './pages/PublicLiveInterview'
import PublicScheduleConfirm from './pages/PublicScheduleConfirm'
import PublicAssessment from './pages/PublicAssessment'
import PublicJobs from './pages/PublicJobs'
import CandidateLayout from './pages/candidate/CandidateLayout'
import CandidateLogin from './pages/candidate/CandidateLogin'
import CandidateRegister from './pages/candidate/CandidateRegister'
import CandidateDashboard from './pages/candidate/CandidateDashboard'
import CandidateProfile from './pages/candidate/CandidateProfile'
import CandidateMatches from './pages/candidate/CandidateMatches'
import AdminSourcing from './pages/admin/AdminSourcing'
import AdminLinkedInPool from './pages/admin/AdminLinkedInPool'
import AdminTalentCRM from './pages/admin/AdminTalentCRM'
import AdminCompliance from './pages/admin/AdminCompliance'
import AdminBoard from './pages/admin/AdminBoard'
import AdminBilling from './pages/admin/AdminBilling'
import Privacy from './pages/Privacy'
import Terms from './pages/Terms'
import TrialSignup from './pages/trial/TrialSignup'
import { SpeedInsights } from '@vercel/speed-insights/react'
import './App.css'


function Loader() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg)' }}>
      <span className="spinner" style={{ width: 32, height: 32 }} />
    </div>
  )
}

function roleHome(role) {
  if (role === 'admin')     return '/admin/dashboard'
  if (role === 'client')    return '/client/dashboard'
  if (role === 'candidate') return '/candidate/dashboard'
  return '/recruiter/dashboard'
}

function ProtectedRoute({ children, role }) {
  const { user, profile, profileLoading, loading } = useAuth()
  if (loading || profileLoading) return <Loader />
  if (!user) return <Navigate to="/login" replace />
  if (role && profile && profile.user_role !== role) {
    return <Navigate to={roleHome(profile.user_role)} replace />
  }
  return children
}

function RootRedirect() {
  const { user, profile, profileLoading, loading } = useAuth()
  const location = useLocation()
  if (loading || profileLoading) return <Loader />
  if (!user) {
    // fix: preserve ?code= so Supabase PKCE reset links that land on / still reach Login with the code intact
    return <Navigate to={`/login${location.search}`} replace />
  }
  return <Navigate to={roleHome(profile?.user_role)} replace />
}

export default function App() {
  return (
    <ErrorBoundary>
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/client/register" element={<ClientRegister />} />
          <Route path="/trial" element={<TrialSignup />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/terms"   element={<Terms />} />
          <Route path="/interview/:token" element={<PublicVideoInterview />} />
          <Route path="/live/:token" element={<PublicLiveInterview />} />
          <Route path="/schedule/:token" element={<PublicScheduleConfirm />} />
          <Route path="/assessment/:token" element={<PublicAssessment />} />
          <Route path="/jobs" element={<PublicJobs />} />
          <Route path="/candidate/login"    element={<CandidateLogin />} />
          <Route path="/candidate/register" element={<CandidateRegister />} />
          {/* fix: Supabase may redirect password-reset/magic-link codes to these paths depending on dashboard config */}
          <Route path="/auth/callback" element={<RootRedirect />} />
          <Route path="/auth/confirm"  element={<RootRedirect />} />
          <Route path="/" element={<RootRedirect />} />

          <Route path="/admin" element={<ProtectedRoute role="admin"><ErrorBoundary><AdminLayout /></ErrorBoundary></ProtectedRoute>}>
            <Route index element={<ErrorBoundary><AdminDashboard /></ErrorBoundary>} />
            <Route path="dashboard"   element={<ErrorBoundary><AdminDashboard /></ErrorBoundary>} />
            <Route path="clients"     element={<ErrorBoundary><AdminClients /></ErrorBoundary>} />
            <Route path="recruiters"  element={<ErrorBoundary><AdminRecruiters /></ErrorBoundary>} />
            <Route path="jobs"        element={<ErrorBoundary><AdminJobs /></ErrorBoundary>} />
            <Route path="pipeline"    element={<ErrorBoundary><AdminPipeline /></ErrorBoundary>} />
            <Route path="talent-pool"   element={<ErrorBoundary><AdminTalentPool /></ErrorBoundary>} />
            <Route path="linkedin-pool" element={<ErrorBoundary><AdminLinkedInPool /></ErrorBoundary>} />
            <Route path="talent-crm"    element={<ErrorBoundary><AdminTalentCRM /></ErrorBoundary>} />
            <Route path="sourcing"      element={<ErrorBoundary><AdminSourcing /></ErrorBoundary>} />
            <Route path="board"       element={<ErrorBoundary><AdminBoard /></ErrorBoundary>} />
            <Route path="compliance"  element={<ErrorBoundary><AdminCompliance /></ErrorBoundary>} />
            <Route path="billing"     element={<ErrorBoundary><AdminBilling /></ErrorBoundary>} />
            <Route path="analytics"   element={<ErrorBoundary><AdminAnalytics /></ErrorBoundary>} />
            <Route path="settings"    element={<ErrorBoundary><AdminSettings /></ErrorBoundary>} />
          </Route>

          <Route path="/recruiter" element={<ProtectedRoute role="recruiter"><ErrorBoundary><RecruiterLayout /></ErrorBoundary></ProtectedRoute>}>
            <Route index element={<ErrorBoundary><RecruiterDashboard /></ErrorBoundary>} />
            <Route path="dashboard" element={<ErrorBoundary><RecruiterDashboard /></ErrorBoundary>} />
            <Route path="clients"   element={<ErrorBoundary><RecruiterClients /></ErrorBoundary>} />
            <Route path="jobs"      element={<ErrorBoundary><RecruiterJobs /></ErrorBoundary>} />
            <Route path="talent-pool"   element={<ErrorBoundary><AdminTalentPool /></ErrorBoundary>} />
            <Route path="linkedin-pool" element={<ErrorBoundary><RecruiterLinkedInPool /></ErrorBoundary>} />
            <Route path="talent-crm"    element={<ErrorBoundary><AdminTalentCRM /></ErrorBoundary>} />
            <Route path="candidates" element={<ErrorBoundary><RecruiterCandidates /></ErrorBoundary>} />
            <Route path="pipeline"  element={<ErrorBoundary><RecruiterPipeline /></ErrorBoundary>} />
            <Route path="reports"   element={<ErrorBoundary><RecruiterReports /></ErrorBoundary>} />
            <Route path="chat"      element={<ErrorBoundary><RecruiterChat /></ErrorBoundary>} />
            <Route path="settings"  element={<ErrorBoundary><RecruiterSettings /></ErrorBoundary>} />
          </Route>

          <Route path="/client" element={<ProtectedRoute role="client"><ErrorBoundary><ClientLayout /></ErrorBoundary></ProtectedRoute>}>
            <Route index element={<ErrorBoundary><ClientDashboard /></ErrorBoundary>} />
            <Route path="dashboard" element={<ErrorBoundary><ClientDashboard /></ErrorBoundary>} />
            <Route path="jobs"      element={<ErrorBoundary><ClientJobs /></ErrorBoundary>} />
            <Route path="candidates" element={<ErrorBoundary><ClientCandidates /></ErrorBoundary>} />
            <Route path="reports"   element={<ErrorBoundary><ClientReports /></ErrorBoundary>} />
            <Route path="settings"  element={<ErrorBoundary><ClientSettings /></ErrorBoundary>} />
            <Route path="chat"      element={<ErrorBoundary><ClientChat /></ErrorBoundary>} />
          </Route>

          <Route path="/candidate" element={<ProtectedRoute role="candidate"><ErrorBoundary><CandidateLayout /></ErrorBoundary></ProtectedRoute>}>
            <Route index element={<ErrorBoundary><CandidateDashboard /></ErrorBoundary>} />
            <Route path="dashboard" element={<ErrorBoundary><CandidateDashboard /></ErrorBoundary>} />
            <Route path="matches"   element={<ErrorBoundary><CandidateMatches /></ErrorBoundary>} />
            <Route path="profile"   element={<ErrorBoundary><CandidateProfile /></ErrorBoundary>} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        <CookieBanner />
      </AuthProvider>
    </BrowserRouter>
    <SpeedInsights />
    </ErrorBoundary>
  )
}
