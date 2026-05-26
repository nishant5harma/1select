import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'

export default function RecruiterDashboard() {
  const { user, profile, profileLoading } = useAuth()
  const navigate = useNavigate()
  const [clients, setClients] = useState([])
  const [stats, setStats] = useState({ clients: 0, jobs: 0, candidates: 0, interviewed: 0 })
  const [funnel, setFunnel] = useState(null)
  const [loading, setLoading] = useState(true)

  // First-login password change
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
    try { // fix: wrap in try/finally so setLoading(false) always fires on query error
    // Load clients assigned to this recruiter
    const { data: rcData } = await supabase
      .from('recruiter_clients')
      .select('client_id, profiles!recruiter_clients_client_id_fkey(id, company_name, email, full_name, created_at)')
      .eq('recruiter_id', user.id)

    const assignedClients = (rcData ?? []).map(r => r.profiles).filter(Boolean)
    const clientIds = assignedClients.map(c => c.id)

    if (!clientIds.length) {
      setClients([])
      setStats({ clients: 0, jobs: 0, candidates: 0, interviewed: 0 })
      return
    }

    // Load jobs for all assigned clients
    const { data: jobsData } = await supabase
      .from('jobs')
      .select('id, title, status, recruiter_id, candidates(count)')
      .in('recruiter_id', clientIds)

    const allJobs = jobsData ?? []
    const jobIds = allJobs.map(j => j.id)

    // Load candidate stats
    let interviewed = 0
    if (jobIds.length) {
      const [{ data: cData }, { data: mData }] = await Promise.all([
        supabase.from('candidates').select('id, job_id, match_pass, scores, live_interview_status, final_decision').in('job_id', jobIds),
        supabase.from('job_matches').select('id, job_id, match_pass, scores, live_interview_status, final_decision').in('job_id', jobIds),
      ])
      const all = [...(cData ?? []), ...(mData ?? [])]
      interviewed = all.filter(c => c.scores?.overallScore != null).length
      const total    = all.length
      const passed   = all.filter(c => c.match_pass === true).length
      const videoComp = interviewed
      const liveSched = all.filter(c => c.live_interview_status === 'scheduled' || c.live_interview_status === 'completed').length
      const hired    = all.filter(c => c.final_decision === 'hired').length
      if (total > 0) setFunnel({ total, passed, videoComp, liveSched, hired })
    }

    const totalCandidates = allJobs.reduce((sum, j) => sum + (j.candidates?.[0]?.count ?? 0), 0)

    const enriched = assignedClients.map(c => ({
      ...c,
      jobs: allJobs.filter(j => j.recruiter_id === c.id),
    }))

    setClients(enriched)
    setStats({
      clients: assignedClients.length,
      jobs: allJobs.length,
      candidates: totalCandidates,
      interviewed,
    })
    } finally {
      setLoading(false) // fix: always clear loading even when queries fail
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

  // ── First-login password change screen ────────────────────────────────────
  if (showPasswordChange) {
    return (
      <div className="modal-overlay" style={{ zIndex: 1000 }}>
        <div className="modal" style={{ maxWidth: 420 }}>
          <div className="modal-head">
            <div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.2em', color: 'var(--accent)', marginBottom: 4 }}>
                One Select
              </div>
              <h3 style={{ margin: 0 }}>Welcome to One Select</h3>
            </div>
          </div>
          <div className="modal-body">
            <p style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.7, marginBottom: 24 }}>
              Please set a new password to secure your account before continuing to your dashboard.
            </p>
            {passwordError && <div className="error-banner" style={{ marginBottom: 16 }}>{passwordError}</div>}
            <form onSubmit={handlePasswordChange}>
              <div className="field" style={{ marginBottom: 14 }}>
                <label>New Password</label>
                <input
                  type="password"
                  placeholder="At least 8 characters"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  autoFocus
                  autoComplete="new-password"
                />
              </div>
              <div className="field" style={{ marginBottom: 24 }}>
                <label>Confirm Password</label>
                <input
                  type="password"
                  placeholder="Repeat your new password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                />
              </div>
              <button
                type="submit"
                className="btn btn-primary"
                style={{ width: '100%', justifyContent: 'center', padding: '12px' }}
                disabled={passwordSaving}
              >
                {passwordSaving
                  ? <><span className="spinner" style={{ width: 13, height: 13 }} /> Setting password…</>
                  : 'Set Password & Continue'}
              </button>
            </form>
          </div>
        </div>
      </div>
    )
  }

  if (loading) return <div className="page"><span className="spinner" /></div>

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>Recruiter Dashboard</h2>
          <p>Your assigned clients and their hiring pipelines</p>
        </div>
        <button className="btn btn-primary" onClick={() => navigate('/recruiter/pipeline')}>
          Open Pipeline
        </button>
      </div>

      <div className="metrics-row">
        <div className="metric-card blue" style={{ cursor: 'pointer' }} onClick={() => navigate('/recruiter/clients')}>
          <span className="metric-val">{stats.clients}</span>
          <span className="metric-label">Assigned Clients</span>
        </div>
        <div className="metric-card" style={{ cursor: 'pointer' }} onClick={() => navigate('/recruiter/jobs')}>
          <span className="metric-val">{stats.jobs}</span>
          <span className="metric-label">Active Jobs</span>
        </div>
        <div className="metric-card amber" style={{ cursor: 'pointer' }} onClick={() => navigate('/recruiter/candidates')}>
          <span className="metric-val">{stats.candidates}</span>
          <span className="metric-label">CVs Submitted</span>
        </div>
        <div className="metric-card green" style={{ cursor: 'pointer' }} onClick={() => navigate('/recruiter/reports')}>
          <span className="metric-val">{stats.interviewed}</span>
          <span className="metric-label">Interviews Done</span>
        </div>
      </div>

      {funnel && (
        <div className="section-card">
          <div className="section-card-head"><h3>Pipeline Conversion</h3></div>
          <div style={{ padding: '12px 20px 20px', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {[
              { label: 'CVs',           value: funnel.total,     color: '#9ca3af',  rate: null },
              { label: 'Screening Pass', value: funnel.passed,   color: '#B8924A',  rate: funnel.total     ? Math.round(funnel.passed    / funnel.total     * 100) : 0 },
              { label: 'Video Done',    value: funnel.videoComp, color: '#6366f1',  rate: funnel.passed    ? Math.round(funnel.videoComp / funnel.passed    * 100) : 0 },
              { label: 'Live Interview', value: funnel.liveSched, color: '#22c55e',  rate: funnel.videoComp ? Math.round(funnel.liveSched / funnel.videoComp * 100) : 0 },
              { label: 'Hired',         value: funnel.hired,     color: '#10b981',  rate: funnel.liveSched ? Math.round(funnel.hired     / funnel.liveSched  * 100) : 0 },
            ].map(s => (
              <div key={s.label} style={{ flex: '1 1 90px', minWidth: 80, padding: '12px 14px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, borderLeft: `3px solid ${s.color}` }}>
                <div style={{ fontSize: 22, fontWeight: 300, fontFamily: 'var(--font-head)', color: s.color }}>{s.value}</div>
                <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-3)', marginTop: 4 }}>{s.label}</div>
                {s.rate !== null && <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', marginTop: 2 }}>{s.rate}%</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {clients.length === 0 ? (
        <div className="section-card">
          <div className="empty-state">
            <div style={{ fontSize: 28, marginBottom: 10, opacity: 0.3 }}>◉</div>
            <div style={{ fontWeight: 400, color: 'var(--text-2)', marginBottom: 6 }}>No clients assigned yet</div>
            <div style={{ fontSize: 12 }}>Your admin will assign clients to you.</div>
          </div>
        </div>
      ) : (
        <div className="section-card">
          <div className="section-card-head"><h3>Your Clients</h3></div>
          {clients.map(c => {
            const activeJobs = c.jobs.filter(j => j.status === 'active').length
            const totalCandidates = c.jobs.reduce((sum, j) => sum + (j.candidates?.[0]?.count ?? 0), 0)
            return (
              <div
                key={c.id}
                className="table-row clickable"
                onClick={() => navigate(`/recruiter/pipeline?client=${c.id}`)}
              >
                <div className="profile-avatar" style={{ width: 36, height: 36, fontSize: 15, borderRadius: 'var(--r)', flexShrink: 0 }}>
                  {(c.company_name ?? c.full_name ?? '?')[0].toUpperCase()}
                </div>
                <div className="col-main">
                  <div className="col-name">{c.company_name || c.full_name || c.email}</div>
                  <div className="col-sub">{c.email}</div>
                </div>
                <div className="col-right">
                  <span className="mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>
                    {activeJobs} job{activeJobs !== 1 ? 's' : ''}
                  </span>
                  <span className="mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>
                    {totalCandidates} candidate{totalCandidates !== 1 ? 's' : ''}
                  </span>
                  <span className="badge badge-blue" style={{ fontSize: 10 }}>View Pipeline →</span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
