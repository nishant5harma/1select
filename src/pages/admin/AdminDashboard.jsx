import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'

const STAT_CARDS = [
  { key: 'clients',     label: 'Total Clients',          path: '/admin/clients',     tone: 'accent' },
  { key: 'jobs',        label: 'Active Jobs',            path: '/admin/jobs',        tone: 'blue'   },
  { key: 'candidates',  label: 'Candidates Processed',   path: '/admin/pipeline',    tone: 'amber'  },
  { key: 'interviews',  label: 'Interviews Done',        path: '/admin/analytics',   tone: 'green'  },
  { key: 'poolTotal',   label: 'Talent Pool',            path: '/admin/talent-pool', tone: 'neutral' },
  { key: 'poolAvailable', label: 'Available in Pool',    path: '/admin/talent-pool', tone: 'green'  },
  { key: 'mrr',         label: 'Monthly Revenue',        path: '/admin/billing',     tone: 'green', format: 'currency' },
  { key: 'placements',  label: 'Placements This Month',  path: '/admin/pipeline',    tone: 'accent' },
]

const QUICK_LINKS = [
  { label: 'Manage Clients',   path: '/admin/clients',    icon: '◉' },
  { label: 'All Jobs',         path: '/admin/jobs',       icon: '◫' },
  { label: 'Pipeline Board',   path: '/admin/board',      icon: '▦' },
  { label: 'Talent Pool',      path: '/admin/talent-pool', icon: '◌' },
  { label: 'Analytics',        path: '/admin/analytics',  icon: '◱' },
  { label: 'Billing',          path: '/admin/billing',    icon: '◇' },
]

function formatStatValue(key, value, format) {
  if (format === 'currency') return `₹${Number(value).toLocaleString('en-IN')}`
  return value
}

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

export default function AdminDashboard() {
  const { user, profile, profileLoading } = useAuth()
  const navigate = useNavigate()
  const [stats, setStats] = useState({ clients: 0, jobs: 0, candidates: 0, interviews: 0, poolTotal: 0, poolAvailable: 0, mrr: 0, placements: 0 })
  const [recentJobs, setRecentJobs] = useState([])
  const [loading, setLoading] = useState(true)
  const [sendingUpdates, setSendingUpdates] = useState(false)
  const [updateResult, setUpdateResult] = useState(null)

  const [showPasswordChange, setShowPasswordChange] = useState(false)
  const [newPassword,     setNewPassword]     = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordError,   setPasswordError]   = useState('')
  const [passwordSaving,  setPasswordSaving]  = useState(false)

  const initRef = useRef(false)

  useEffect(() => {
    if (!user || profileLoading) return
    if (initRef.current) return
    initRef.current = true

    supabase.from('profiles').update({ last_seen_at: new Date().toISOString() }).eq('id', user.id)

    if (profile?.first_login && !sessionStorage.getItem(`pw_set_${user.id}`)) {
      setLoading(false)
      setShowPasswordChange(true)
    } else {
      load()
    }
  }, [user, profileLoading])

  async function load() {
    try {
      const ms = (() => { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d.toISOString() })()
      const [
        { count: clients },
        { count: jobs },
        { count: candidates },
        { count: interviews },
        { data: recent },
        { count: poolTotal },
        { count: poolAvailable },
        { data: clientProfiles },
        { count: placements },
      ] = await Promise.all([
        supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('user_role', 'client'),
        supabase.from('jobs').select('*', { count: 'exact', head: true }).eq('status', 'active'),
        supabase.from('candidates').select('*', { count: 'exact', head: true }),
        supabase.from('candidates').select('*', { count: 'exact', head: true }).not('scores', 'is', null),
        supabase.from('jobs').select('id, title, status, created_at, profiles(company_name)').order('created_at', { ascending: false }).limit(8),
        supabase.from('talent_pool').select('*', { count: 'exact', head: true }),
        supabase.from('talent_pool').select('*', { count: 'exact', head: true }).eq('availability', 'available'),
        supabase.from('profiles').select('subscription_status, price_override, plans(price_monthly)').eq('user_role', 'client'),
        supabase.from('candidates').select('*', { count: 'exact', head: true }).eq('final_decision', 'hired').gte('updated_at', ms),
      ])
      const mrr = (clientProfiles ?? []).reduce((sum, c) => {
        if (c.subscription_status !== 'active') return sum
        const price = c.price_override ?? c.plans?.price_monthly ?? 0
        return sum + Number(price)
      }, 0)
      setStats({ clients: clients ?? 0, jobs: jobs ?? 0, candidates: candidates ?? 0, interviews: interviews ?? 0, poolTotal: poolTotal ?? 0, poolAvailable: poolAvailable ?? 0, mrr, placements: placements ?? 0 })
      setRecentJobs(recent ?? [])
    } finally {
      setLoading(false)
    }
  }

  async function handlePasswordChange(e) {
    e.preventDefault()
    setPasswordError('')
    if (newPassword.length < 8) { setPasswordError('Password must be at least 8 characters'); return }
    if (newPassword !== confirmPassword) { setPasswordError('Passwords do not match'); return }

    setPasswordSaving(true)
    const { error: updateErr } = await supabase.auth.updateUser({ password: newPassword })
    if (updateErr) { setPasswordError(updateErr.message); setPasswordSaving(false); return }

    await supabase.from('profiles').update({ first_login: false }).eq('id', user.id)
    sessionStorage.setItem(`pw_set_${user.id}`, '1')

    setNewPassword('')
    setConfirmPassword('')
    setPasswordSaving(false)
    setShowPasswordChange(false)
    load()
  }

  async function sendWeeklyUpdates() {
    setSendingUpdates(true)
    setUpdateResult(null)
    try {
      const { error } = await supabase.functions.invoke('weekly-client-update', { body: {} })
      setUpdateResult(error ? { ok: false, msg: error.message } : { ok: true, msg: 'Weekly updates sent to all active clients.' })
    } catch (e) {
      setUpdateResult({ ok: false, msg: e.message })
    }
    setSendingUpdates(false)
  }

  if (showPasswordChange) {
    return (
      <div className="modal-overlay" style={{ zIndex: 1000 }}>
        <div className="modal" style={{ maxWidth: 420 }}>
          <div className="modal-head">
            <div>
              <div className="adm-eyebrow">One Select</div>
              <h3 style={{ margin: 0 }}>Welcome to One Select</h3>
            </div>
          </div>
          <div className="modal-body">
            <p style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.7, marginBottom: 24 }}>
              Please set a new password to secure your admin account before continuing.
            </p>
            {passwordError && <div className="error-banner" style={{ marginBottom: 16 }}>{passwordError}</div>}
            <form onSubmit={handlePasswordChange}>
              <div className="field" style={{ marginBottom: 14 }}>
                <label>New Password</label>
                <input type="password" placeholder="At least 8 characters" value={newPassword} onChange={e => setNewPassword(e.target.value)} autoFocus autoComplete="new-password" />
              </div>
              <div className="field" style={{ marginBottom: 24 }}>
                <label>Confirm Password</label>
                <input type="password" placeholder="Repeat your new password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} autoComplete="new-password" />
              </div>
              <button type="submit" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={passwordSaving}>
                {passwordSaving ? <><span className="spinner" style={{ width: 13, height: 13 }} /> Saving…</> : 'Set Password & Continue'}
              </button>
            </form>
          </div>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="page admin-dash">
        <div className="adm-loading"><span className="spinner" /></div>
      </div>
    )
  }

  const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const name = profile?.full_name?.split(' ')[0] || 'Admin'

  return (
    <div className="page admin-dash">
      <header className="adm-header">
        <div className="adm-header-text">
          <p className="adm-eyebrow">{today}</p>
          <h1 className="adm-title">{greeting()}, {name}</h1>
          <p className="adm-subtitle">Platform-wide overview across clients, jobs, and hiring activity.</p>
        </div>
        <div className="adm-header-actions">
          <button type="button" className="adm-btn-primary" disabled={sendingUpdates} onClick={sendWeeklyUpdates}>
            {sendingUpdates ? <><span className="spinner" style={{ width: 12, height: 12 }} /> Sending…</> : 'Send Weekly Updates'}
          </button>
          {updateResult && (
            <p className={`adm-toast ${updateResult.ok ? 'adm-toast--ok' : 'adm-toast--err'}`}>{updateResult.msg}</p>
          )}
        </div>
      </header>

      <section className="adm-stat-grid" aria-label="Key metrics">
        {STAT_CARDS.map(({ key, label, path, tone, format }) => (
          <button
            key={key}
            type="button"
            className={`adm-stat-card adm-stat-card--${tone}`}
            onClick={() => navigate(path)}
          >
            <span className="adm-stat-val">{formatStatValue(key, stats[key], format)}</span>
            <span className="adm-stat-label">{label}</span>
          </button>
        ))}
      </section>

      <div className="adm-body-grid">
        <section className="adm-panel">
          <div className="adm-panel-head">
            <h2>Recent Jobs</h2>
            <button type="button" className="adm-link-btn" onClick={() => navigate('/admin/jobs')}>View all →</button>
          </div>
          {recentJobs.length === 0 ? (
            <div className="adm-empty">
              <span className="adm-empty-icon">◫</span>
              <p className="adm-empty-title">No jobs yet</p>
              <p className="adm-empty-sub">Newly created jobs across the platform will appear here.</p>
            </div>
          ) : (
            <ul className="adm-job-list">
              {recentJobs.map(j => (
                <li key={j.id}>
                  <button type="button" className="adm-job-row" onClick={() => navigate('/admin/jobs')}>
                    <span className="adm-job-avatar">{(j.title ?? 'J')[0].toUpperCase()}</span>
                    <span className="adm-job-info">
                      <span className="adm-job-title">{j.title}</span>
                      <span className="adm-job-company">{j.profiles?.company_name ?? '—'}</span>
                    </span>
                    <span className="adm-job-meta">
                      <span className={`adm-pill adm-pill--${j.status === 'active' ? 'green' : 'amber'}`}>
                        {j.status ?? 'active'}
                      </span>
                      <span className="adm-job-date">
                        {new Date(j.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside className="adm-panel adm-panel--sidebar">
          <div className="adm-panel-head">
            <h2>Quick Actions</h2>
          </div>
          <nav className="adm-quick-links">
            {QUICK_LINKS.map(link => (
              <button key={link.path} type="button" className="adm-quick-link" onClick={() => navigate(link.path)}>
                <span className="adm-quick-icon">{link.icon}</span>
                <span>{link.label}</span>
                <span className="adm-quick-arrow">→</span>
              </button>
            ))}
          </nav>
          <div className="adm-tip">
            <p className="adm-tip-label">Tip</p>
            <p className="adm-tip-text">Use the Pipeline Board to drag candidates between stages and track hiring progress in real time.</p>
            <button type="button" className="adm-link-btn" onClick={() => navigate('/admin/board')}>Open Pipeline Board →</button>
          </div>
        </aside>
      </div>
    </div>
  )
}
