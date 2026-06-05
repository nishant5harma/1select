import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../../lib/AuthContext'
import NotificationBell from '../../components/NotificationBell'

const NAV = [
  { to: '/admin/dashboard',   label: 'Dashboard',       icon: '◈' },
  { to: '/admin/clients',     label: 'Clients',         icon: '◉' },
  { to: '/admin/recruiters',  label: 'Recruiters',      icon: '◎' },
  { to: '/admin/jobs',        label: 'Jobs',            icon: '◫' },
  { to: '/admin/talent-pool',    label: 'Talent Pool',     icon: '◌' },
  { to: '/admin/linkedin-pool',  label: 'LinkedIn Pool',   icon: '◆' },
  { to: '/admin/talent-crm',     label: 'Talent CRM',      icon: '◴' },
  { to: '/admin/sourcing',       label: 'Sourcing',        icon: '◍' },
  { to: '/admin/pipeline',    label: 'Pipeline',        icon: '◐' },
  { to: '/admin/board',       label: 'Pipeline Board',  icon: '▦'  },
  { to: '/admin/compliance',  label: 'Compliance',      icon: '◑'  },
  { to: '/admin/analytics',   label: 'Analytics',       icon: '◱'  },
  { to: '/admin/billing',     label: 'Billing',         icon: '◇'  },
  { to: '/admin/settings',    label: 'Settings',        icon: '◷'  },
]

export default function AdminLayout() {
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
          <div className="nav-section">Admin</div>
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
            >
              <span className="nav-icon">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer" style={{ flexShrink: 0, borderTop: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div className="sidebar-user-email" style={{ margin: 0, color: 'var(--navy-text)' }}>{user?.email}</div>
            <NotificationBell />
          </div>
          <button
            className="btn btn-secondary"
            style={{ width: '100%', justifyContent: 'center', color: '#6878A0' }}
            onMouseEnter={e => e.currentTarget.style.color = 'var(--accent)'}
            onMouseLeave={e => e.currentTarget.style.color = '#6878A0'}
            onClick={handleSignOut}
          >
            Sign out
          </button>
        </div>
      </aside>

      <main className="content">
        <Outlet />
      </main>
    </div>
  )
}
