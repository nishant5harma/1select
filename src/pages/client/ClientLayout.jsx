import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../../lib/AuthContext'
import { usePlan } from '../../hooks/usePlan'
import ChatBubble from '../../components/ChatBubble'
import NotificationBell from '../../components/NotificationBell'

const NAV = [
  { to: '/client/dashboard',  label: 'Dashboard',    icon: '◈' },
  { to: '/client/jobs',       label: 'My Jobs',      icon: '◫' },
  { to: '/client/candidates', label: 'Candidates',   icon: '◉' },
  { to: '/client/reports',    label: 'Reports',      icon: '◧' },
  { to: '/client/chat',       label: 'AI Assistant', icon: '◎' },
  { to: '/client/settings',   label: 'Settings',     icon: '◷' },
]

export default function ClientLayout() {
  const { user, profile, signOut } = useAuth()
  const navigate = useNavigate()
  const { isTrial, isExpired, trialDaysLeft } = usePlan()

  const handleSignOut = async () => {
    await signOut()
    navigate('/login', { replace: true })
  }

  if (profile?.subscription_status === 'suspended') {
    const billingSubject = encodeURIComponent(`Account Suspension – ${profile.company_name ?? 'enquiry'}`)
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: 14, background: 'var(--bg)', color: 'var(--text)', fontFamily: 'var(--font-body)', padding: 24, textAlign: 'center' }}>
        <div style={{ fontSize: 32, opacity: 0.15 }}>◉</div>
        <h2 style={{ fontFamily: 'var(--font-head)', fontWeight: 300, margin: 0 }}>Account Suspended</h2>
        {profile.company_name && (
          <p style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>{profile.company_name}</p>
        )}
        <p style={{ fontSize: 13, color: 'var(--text-3)', margin: 0, maxWidth: 440, lineHeight: 1.8 }}>
          Access to your portal has been suspended — usually due to a past-due invoice or a hold placed by your account manager.
          Contact our billing team to reinstate your account.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, marginTop: 6 }}>
          <a
            href={`mailto:billing@oneselect.co.uk?subject=${billingSubject}`}
            style={{ padding: '10px 28px', background: 'var(--accent)', color: '#fff', textDecoration: 'none', borderRadius: 6, fontSize: 13, fontFamily: 'var(--font-mono)', letterSpacing: '0.05em', textTransform: 'uppercase' }}
          >
            Contact Billing
          </a>
          <button className="btn btn-secondary" style={{ fontSize: 12 }} onClick={handleSignOut}>Sign out</button>
        </div>
        <p style={{ fontSize: 11, color: 'var(--text-3)', margin: 0 }}>billing@oneselect.co.uk</p>
      </div>
    )
  }

  if (isExpired) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: 16, background: 'var(--bg)', color: 'var(--text)', fontFamily: 'var(--font-body)', padding: 24, textAlign: 'center' }}>
        <div style={{ fontSize: 32, opacity: 0.12 }}>◉</div>
        <h2 style={{ fontFamily: 'var(--font-head)', fontWeight: 300, fontSize: 26, margin: 0 }}>Your Free Trial Has Ended</h2>
        <p style={{ fontSize: 13, color: 'var(--text-3)', maxWidth: 440, lineHeight: 1.85, margin: 0 }}>
          Thank you for trying One Select. To continue accessing your pipeline and candidates, please get in touch with our team.
        </p>
        <a
          href="mailto:hello@oneselect.co.uk"
          style={{ padding: '11px 32px', background: 'var(--accent)', color: '#fff', textDecoration: 'none', fontFamily: 'var(--font-mono)', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em' }}
        >
          Contact us to continue
        </a>
        <p style={{ fontSize: 12, color: 'var(--text-3)', margin: 0 }}>Or email us: hello@oneselect.co.uk</p>
        <button className="btn btn-secondary" style={{ fontSize: 12, marginTop: 8 }} onClick={async () => { await signOut(); navigate('/login', { replace: true }) }}>
          Sign out
        </button>
      </div>
    )
  }

  const daysLeft = trialDaysLeft()
  const showTrialBanner = isTrial && !isExpired && daysLeft != null && daysLeft <= 3

  return (
    <div className="layout">
      <aside className="sidebar" style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
        <div className="sidebar-brand">
          <img src="/oneselect-logo.png" alt="One Select" style={{ width: '100%', maxWidth: 160, height: 'auto', objectFit: 'contain', display: 'block' }} />
        </div>
        {profile?.company_name && (
          <div className="sidebar-company">{profile.company_name}</div>
        )}

        <nav className="sidebar-nav" style={{ flex: 1, overflowY: 'auto' }}>
          <div className="nav-section">Client Portal</div>
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
            <div className="sf-avatar">{(profile?.company_name ?? user?.email ?? '?')[0].toUpperCase()}</div>
            <div className="sf-meta">
              {profile?.company_name && <div className="sf-name">{profile.company_name}</div>}
              <div className="sf-email">{user?.email}</div>
            </div>
            <NotificationBell />
          </div>
          <button className="sf-signout" onClick={handleSignOut}>Sign out</button>
        </div>
      </aside>

      <main className="content">
        {showTrialBanner && (
          <div style={{
            padding: '9px 20px', fontSize: 12, fontFamily: 'var(--font-body)',
            background: daysLeft <= 0 ? 'rgba(239,68,68,0.08)' : 'rgba(245,158,11,0.08)',
            borderBottom: `1px solid ${daysLeft <= 0 ? 'var(--red)' : 'var(--amber)'}`,
            color: daysLeft <= 0 ? 'var(--red)' : 'var(--amber)',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexShrink: 0,
          }}>
            <span>
              {daysLeft <= 0
                ? 'Your free trial has expired.'
                : `Your free trial ends in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}.`}
              {' '}Talk to us to continue.
            </span>
            <a href="mailto:hello@oneselect.co.uk" style={{ color: 'inherit', fontFamily: 'var(--font-mono)', fontSize: 11, textDecoration: 'none', whiteSpace: 'nowrap', textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '1px solid currentColor' }}>
              Contact us →
            </a>
          </div>
        )}
        <Outlet />
      </main>
      <ChatBubble />
    </div>
  )
}
