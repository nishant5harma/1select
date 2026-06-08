import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../../lib/AuthContext'
import RecruiterChatBubble from '../../components/RecruiterChatBubble'
import NotificationBell from '../../components/NotificationBell'

const NAV = [
  { to: '/recruiter/dashboard',   label: 'Dashboard',   icon: '◈' },
  { to: '/recruiter/clients',     label: 'Clients',     icon: '◉' },
  { to: '/recruiter/jobs',        label: 'Jobs',        icon: '◫' },
  { to: '/recruiter/candidates',  label: 'Candidates',  icon: '◑' },
  { to: '/recruiter/talent-pool',    label: 'Talent Pool',   icon: '◭' },
  { to: '/recruiter/linkedin-pool',  label: 'LinkedIn Pool', icon: '◆' },
  { to: '/recruiter/talent-crm',     label: 'Talent CRM',    icon: '◴' },
  { to: '/recruiter/pipeline',       label: 'Pipeline',      icon: '◐' },
  { to: '/recruiter/reports',     label: 'Reports',     icon: '◧' },
  { to: '/recruiter/chat',        label: 'AI Assistant', icon: '◎' },
  { to: '/recruiter/settings',    label: 'Settings',    icon: '◷' },
]

export default function RecruiterLayout() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()

  const handleSignOut = async () => {
    await signOut()
    navigate('/login', { replace: true })
  }

  return (
    <div className="layout">
      <aside className="sidebar" style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
        <div className="sidebar-brand">
          <img src="/oneselect-logo.png" alt="One Select" style={{ width: '100%', maxWidth: 160, height: 'auto', objectFit: 'contain', display: 'block' }} />
        </div>

        <nav className="sidebar-nav" style={{ flex: 1, overflowY: 'auto' }}>
          <div className="nav-section">Recruiter</div>
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
            >
              <span className="nav-icon">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="sf-user">
            <div className="sf-avatar">{(user?.email ?? '?')[0].toUpperCase()}</div>
            <div className="sf-meta">
              <div className="sf-email">{user?.email}</div>
            </div>
            <NotificationBell />
          </div>
          <button className="sf-signout" onClick={handleSignOut}>Sign out</button>
        </div>
      </aside>

      <main className="content">
        <Outlet />
      </main>

      <RecruiterChatBubble />
    </div>
  )
}
