import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'

export default function ClientDashboard() {
  const { user, profile, profileLoading, effectiveClientId } = useAuth()
  const navigate = useNavigate()

  const [stats, setStats]                   = useState({ jobs: 0, candidates: 0, screened: 0, passed: 0, interviewed: 0 })
  const [recentCandidates, setRecentCandidates] = useState([])
  const [recentJobs, setRecentJobs]         = useState([])
  const [recentActivity, setRecentActivity] = useState([])
  const [loading, setLoading]               = useState(true)
  const [showWelcome, setShowWelcome]       = useState(false)
  const [bannerDismissed, setBannerDismissed] = useState(false)

  const [showPasswordChange, setShowPasswordChange] = useState(false)
  const [newPassword,    setNewPassword]    = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordError,  setPasswordError]  = useState('')
  const [passwordSaving, setPasswordSaving] = useState(false)

  const initRef = useRef(false)

  useEffect(() => {
    if (!user || profileLoading) return
    if (!effectiveClientId) return // fix: wait until effectiveClientId is resolved for stakeholders
    if (initRef.current) return
    initRef.current = true

    const updates = { last_seen_at: new Date().toISOString() }
    if (!profile?.first_login_at) updates.first_login_at = new Date().toISOString()
    supabase.from('profiles').update(updates).eq('id', user.id)

    if (profile?.first_login === true) {
      if (profile?.subscription_status === 'trial') {
        // Self-registered trial — show welcome modal, clear first_login flag
        supabase.from('profiles').update({ first_login: false }).eq('id', user.id)
        setShowWelcome(true)
        load()
      } else if (!sessionStorage.getItem(`pw_set_${user.id}`)) {
        // Admin-created account — show password set modal
        setLoading(false)
        setShowPasswordChange(true)
      } else {
        load()
      }
    } else {
      load()
    }
  }, [user, profileLoading, effectiveClientId]) // fix: include effectiveClientId so stakeholders load correctly

  async function load() {
    try { // fix: wrap in try/finally so setLoading(false) always fires on query error
      const { data: jobs } = await supabase
        .from('jobs')
        .select('id, title, status, created_at')
        .eq('recruiter_id', effectiveClientId)
        .order('created_at', { ascending: false })

      const jobIds = (jobs ?? []).map(j => j.id)
      setRecentJobs((jobs ?? []).slice(0, 4))

      if (!jobIds.length) {
        return
      }

      const { data: allCandidates } = await supabase
        .from('candidates')
        .select('id, full_name, candidate_role, match_score, match_pass, scores, created_at, job_id')
        .in('job_id', jobIds)
        .not('match_pass', 'is', null)   // only show screened candidates to clients
        .order('created_at', { ascending: false })

      const all = allCandidates ?? []
      setStats({
        jobs:        jobs.length,
        candidates:  all.length,
        screened:    all.filter(c => c.match_score != null).length,
        passed:      all.filter(c => c.match_pass === true).length,
        interviewed: all.filter(c => c.scores != null).length,
      })
      setRecentCandidates(all.slice(0, 6))

      const { data: activity } = await supabase
        .from('audit_log')
        .select('id, action, entity_type, metadata, created_at')
        .in('job_id', jobIds)
        .order('created_at', { ascending: false })
        .limit(10)
      setRecentActivity(activity ?? [])
    } finally {
      setLoading(false) // fix: always clear loading even when queries fail
    }
  }

  async function handlePasswordChange(e) {
    e.preventDefault()
    setPasswordError('')

    if (newPassword.length < 8) {
      setPasswordError('Password must be at least 8 characters')
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('Passwords do not match')
      return
    }

    setPasswordSaving(true)
    const { error: updateErr } = await supabase.auth.updateUser({ password: newPassword })
    if (updateErr) {
      setPasswordError(updateErr.message)
      setPasswordSaving(false)
      return
    }

    await supabase.from('profiles').update({ first_login: false }).eq('id', user.id)
    sessionStorage.setItem(`pw_set_${user.id}`, '1')

    setNewPassword('')
    setConfirmPassword('')
    setPasswordSaving(false)
    setShowPasswordChange(false)
    load()
  }

  function dismissWelcome(goCreate = false) {
    localStorage.setItem(`welcomed_${user.id}`, '1')
    setShowWelcome(false)
    setBannerDismissed(true)
    if (goCreate) navigate('/client/jobs')
  }

  const checklistDismissed = !!localStorage.getItem(`cl_done_${user?.id}`)
  const showChecklist = !checklistDismissed && (stats.jobs === 0 || stats.candidates === 0)

  function getStatus(c) {
    if (c.scores) return {
      label: c.scores.recommendation ?? 'Interviewed',
      color: c.scores.recommendation === 'Strong Hire' ? 'var(--green)'  :
             c.scores.recommendation === 'Hire'        ? 'var(--accent)' :
             c.scores.recommendation === 'Reject'      ? 'var(--red)'    : 'var(--amber)',
      bg:    'var(--accent-d)',
    }
    if (c.match_pass === true)  return { label: 'Awaiting Interview', color: 'var(--amber)', bg: 'var(--amber-d)' }
    if (c.match_pass === false) return { label: 'Screened Out',       color: 'var(--red)',   bg: 'var(--red-d)'   }
    if (c.match_score != null)  return { label: 'Screened',           color: 'var(--accent)',bg: 'var(--accent-d)'}
    return { label: 'Pending', color: 'var(--text-3)', bg: 'var(--surface2)' }
  }

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
      {showWelcome && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, padding: 24 }}>
          <div style={{ background: 'var(--surface)', width: '100%', maxWidth: 480, border: '1px solid var(--border)', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '28px 32px 0' }}>
              <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.2em', color: 'var(--accent)', marginBottom: 8 }}>One Select</div>
              <h2 style={{ fontFamily: 'var(--font-head)', fontWeight: 300, fontSize: 24, margin: 0, color: 'var(--text)' }}>Welcome to One Select</h2>
              <p style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.75, marginTop: 10 }}>
                Your AI hiring platform is ready. Here's what to do first:
              </p>
            </div>
            <div style={{ padding: '16px 32px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              {[
                { n: 1, text: 'Post your first job', desc: 'Describe the role and skills required — takes 2 minutes.' },
                { n: 2, text: 'Your recruiter will upload and screen CVs', desc: 'AI screening scores every CV against your requirements automatically.' },
                { n: 3, text: 'Review scores and interview results here', desc: 'Approve shortlisted candidates and watch their video interviews.' },
              ].map(step => (
                <div key={step.n} style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                  <div style={{ width: 26, height: 26, borderRadius: '50%', background: 'var(--accent)', color: 'var(--text)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-mono)', fontSize: 12, flexShrink: 0, fontWeight: 700 }}>{step.n}</div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{step.text}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>{step.desc}</div>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ padding: '16px 32px 28px', borderTop: '1px solid var(--border)', display: 'flex', gap: 10 }}>
              <button
                className="btn btn-primary"
                style={{ flex: 1, justifyContent: 'center', padding: '11px', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.07em' }}
                onClick={() => dismissWelcome(true)}
              >
                Post Your First Job →
              </button>
              <button className="btn btn-secondary" style={{ fontSize: 12 }} onClick={() => dismissWelcome(false)}>
                Later
              </button>
            </div>
          </div>
        </div>
      )}

      {showChecklist && (
        <div className="section-card" style={{ marginBottom: 20, borderLeft: '3px solid var(--accent)' }}>
          <div className="section-card-head">
            <div>
              <h3 style={{ margin: 0 }}>Getting started</h3>
              <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-3)' }}>Complete these steps to get your first hire</p>
            </div>
            <button
              className="btn btn-secondary"
              style={{ fontSize: 10, padding: '3px 8px' }}
              onClick={() => { localStorage.setItem(`cl_done_${user.id}`, '1'); navigate(0) }}
            >
              Dismiss
            </button>
          </div>
          <div style={{ padding: '4px 20px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[
              {
                num: 1,
                done: true,
                label: 'Create your account',
                desc:  'Your portal is ready to use.',
                action: null,
              },
              {
                num: 2,
                done: stats.jobs > 0,
                label: 'Add your first job',
                desc:  'Describe the role — your recruiter will start sourcing candidates.',
                action: { label: 'Create a job →', path: '/client/jobs' },
              },
              {
                num: 3,
                done: stats.candidates > 0,
                label: 'Review shortlisted candidates',
                desc:  'Once your recruiter screens CVs, shortlisted candidates and their interview scores appear here.',
                action: stats.jobs > 0 ? { label: 'View candidates →', path: '/client/candidates' } : null,
              },
            ].map(step => (
              <div key={step.num} style={{ display: 'flex', gap: 14, alignItems: step.done ? 'center' : 'flex-start' }}>
                <div style={{
                  width: 24, height: 24, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: step.done ? 'var(--green)' : 'var(--surface2)',
                  border: step.done ? 'none' : '1px solid var(--border)',
                  fontSize: 11, fontFamily: 'var(--font-mono)', color: step.done ? 'white' : 'var(--text-3)', fontWeight: 700,
                }}>
                  {step.done ? '✓' : step.num}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: step.done ? 'var(--text-3)' : 'var(--text)', textDecoration: step.done ? 'line-through' : 'none' }}>{step.label}</div>
                  {!step.done && <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>{step.desc}</div>}
                  {!step.done && step.action && (
                    <button className="btn btn-secondary" style={{ fontSize: 11, padding: '3px 10px', marginTop: 8 }} onClick={() => navigate(step.action.path)}>
                      {step.action.label}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {profile?.first_login === true && !bannerDismissed && !showWelcome && (
        <div style={{
          background: 'var(--accent-d)',
          border: '1px solid var(--accent)',
          borderRadius: 'var(--r)',
          padding: '16px 20px',
          marginBottom: 24,
          display: 'flex',
          alignItems: 'flex-start',
          gap: 14,
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: 'var(--font-head)', fontSize: 17, fontWeight: 400, color: 'var(--accent)', marginBottom: 4, letterSpacing: '0.02em' }}>Welcome to One Select</div>
            <div style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.6 }}>
              Your hiring portal is ready. Post a job to start receiving AI-screened candidates from your recruiter, and review shortlists and interview results right here.
            </div>
          </div>
          <button
            onClick={() => setBannerDismissed(true)}
            aria-label="Dismiss welcome message"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', fontSize: 18, lineHeight: 1, padding: 2 }}
          >×</button>
        </div>
      )}

      <div className="page-head">
        <div>
          <h2>Welcome back{profile?.company_name ? `, ${profile.company_name}` : ''}</h2>
          <p>Here's your hiring pipeline at a glance</p>
        </div>
        <button className="btn btn-primary" onClick={() => navigate('/client/jobs')}>+ New Job</button>
      </div>

      <div className="metrics-row">
        <div className="metric-card blue" style={{ cursor: 'pointer' }} onClick={() => navigate('/client/jobs')}>
          <span style={{ fontSize: 15, opacity: 0.22, lineHeight: 1, marginBottom: 8 }}>◫</span>
          <span className="metric-val">{stats.jobs}</span>
          <span className="metric-label">Active Jobs</span>
          {stats.jobs === 0 && <span style={{ fontSize: 11, color: 'var(--accent)', marginTop: 6, fontFamily: 'var(--font-mono)', letterSpacing: '0.04em' }}>+ Create a job to start</span>}
        </div>
        <div className="metric-card" style={{ cursor: 'pointer' }} onClick={() => navigate('/client/candidates')}>
          <span style={{ fontSize: 15, opacity: 0.22, lineHeight: 1, marginBottom: 8 }}>◌</span>
          <span className="metric-val">{stats.candidates}</span>
          <span className="metric-label">CVs Submitted</span>
          {stats.candidates === 0 && stats.jobs > 0 && <span style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 6, fontFamily: 'var(--font-mono)', letterSpacing: '0.04em' }}>Your recruiter will upload CVs</span>}
        </div>
        <div className="metric-card amber" style={{ cursor: 'pointer' }} onClick={() => navigate('/client/candidates?tab=Awaiting+Interview')}>
          <span style={{ fontSize: 15, opacity: 0.22, lineHeight: 1, marginBottom: 8 }}>◐</span>
          <span className="metric-val">{stats.passed}</span>
          <span className="metric-label">Awaiting Interview</span>
          {stats.passed === 0 && stats.candidates > 0 && <span style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 6, fontFamily: 'var(--font-mono)', letterSpacing: '0.04em' }}>Screening in progress</span>}
        </div>
        <div className="metric-card green" style={{ cursor: 'pointer' }} onClick={() => navigate('/client/reports')}>
          <span style={{ fontSize: 15, opacity: 0.22, lineHeight: 1, marginBottom: 8 }}>◱</span>
          <span className="metric-val">{stats.interviewed}</span>
          <span className="metric-label">Interviews Done</span>
          {stats.interviewed === 0 && stats.passed > 0 && <span style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 6, fontFamily: 'var(--font-mono)', letterSpacing: '0.04em' }}>Interviews not yet started</span>}
        </div>
      </div>

      {stats.candidates > 0 && (
        <div className="section-card" style={{ marginBottom: 20 }}>
          <div className="section-card-head"><h3>Hiring Funnel</h3></div>
          <div style={{ padding: '20px 24px', display: 'flex', gap: 0, alignItems: 'stretch' }}>
            {[
              { label: 'CVs Submitted',  value: stats.candidates,  color: 'var(--text-3)' },
              { label: 'Screened',       value: stats.screened,    color: 'var(--accent)'  },
              { label: 'Passed Screen',  value: stats.passed,      color: 'var(--amber)'   },
              { label: 'Interviewed',    value: stats.interviewed, color: 'var(--green)'   },
            ].map((step, i, arr) => {
              const pct = arr[0].value > 0 ? Math.round((step.value / arr[0].value) * 100) : 0
              return (
                <div key={step.label} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative' }}>
                  {i > 0 && (
                    <div style={{ position: 'absolute', left: 0, top: '50%', transform: 'translateY(-50%)', width: 1, height: 40, background: 'var(--border)' }} />
                  )}
                  <div style={{ fontFamily: 'var(--font-head)', fontSize: 32, fontWeight: 300, color: step.color, lineHeight: 1 }}>{step.value}</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-3)', marginTop: 6, textAlign: 'center' }}>{step.label}</div>
                  {i > 0 && <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: step.color, marginTop: 4 }}>{pct}%</div>}
                  <div style={{ marginTop: 12, width: '60%', height: 3, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${pct}%`, background: step.color, borderRadius: 2 }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {recentActivity.length > 0 && (
        <div className="section-card" style={{ marginBottom: 20 }}>
          <div className="section-card-head"><h3>Recent Activity</h3></div>
          <div style={{ padding: '4px 0 8px' }}>
            {recentActivity.map(entry => {
              const meta = entry.metadata ?? {}
              let icon = '◌'
              let text = ''
              if (entry.action === 'interview_invited') { icon = '✉'; text = `Interview invite sent to ${meta.candidate_name ?? 'a candidate'}` }
              else if (entry.action === 'decision_hired')    { icon = '✓'; text = `${meta.candidate_name ?? 'Candidate'} marked as hired` }
              else if (entry.action === 'decision_rejected') { icon = '✕'; text = `${meta.candidate_name ?? 'Candidate'} was not progressed` }
              else if (entry.action === 'client_approved')   { icon = '✓'; text = `You approved ${meta.candidate_name ?? 'a candidate'}` }
              else if (entry.action === 'client_rejected')   { icon = '✕'; text = `You rejected ${meta.candidate_name ?? 'a candidate'}` }
              else { text = entry.action.replace(/_/g, ' ') }
              const when = new Date(entry.created_at)
              const ago = (() => {
                const diff = Date.now() - when.getTime()
                if (diff < 60000)  return 'just now'
                if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
                if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
                return when.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
              })()
              return (
                <div key={entry.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 20px', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--surface2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, flexShrink: 0, color: 'var(--text-3)' }}>{icon}</div>
                  <div style={{ flex: 1, fontSize: 13, color: 'var(--text-2)' }}>{text}</div>
                  <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', flexShrink: 0 }}>{ago}</div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
        <div className="section-card">
          <div className="section-card-head">
            <h3>Recent Candidates</h3>
            <button className="btn btn-secondary" style={{ fontSize: 11, padding: '5px 10px' }} onClick={() => navigate('/client/candidates')}>View all</button>
          </div>
          {recentCandidates.length === 0 ? (
            <div className="empty-state">
              <div style={{ fontSize: 28, marginBottom: 10, opacity: 0.3 }}>◎</div>
              <div style={{ fontWeight: 400, color: 'var(--text-2)', marginBottom: 6 }}>No candidates yet</div>
              <div style={{ fontSize: 12 }}>Your One Select recruiter will upload CVs shortly.</div>
            </div>
          ) : (
            recentCandidates.map(c => {
              const st = getStatus(c)
              return (
                <div key={c.id} className="table-row clickable" onClick={() => navigate('/client/candidates')}>
                  <div className="profile-avatar" style={{ width: 32, height: 32, fontSize: 13, borderRadius: 'var(--r)', flexShrink: 0 }}>
                    {(c.full_name ?? '?')[0].toUpperCase()}
                  </div>
                  <div className="col-main">
                    <div className="col-name">{c.full_name}</div>
                    <div className="col-sub">{c.candidate_role}</div>
                  </div>
                  <div className="col-right">
                    {c.scores?.overallScore != null && (
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: c.scores.overallScore >= 70 ? 'var(--green)' : c.scores.overallScore >= 50 ? 'var(--accent)' : 'var(--red)' }}>
                        {(c.scores.overallScore / 10).toFixed(1)}/10
                      </span>
                    )}
                    <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: st.color, background: st.bg, padding: '2px 7px', borderRadius: 'var(--r)', textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>
                      {st.label}
                    </span>
                  </div>
                </div>
              )
            })
          )}
        </div>

        <div className="section-card">
          <div className="section-card-head">
            <h3>Your Jobs</h3>
            <button className="btn btn-secondary" style={{ fontSize: 11, padding: '5px 10px' }} onClick={() => navigate('/client/jobs')}>View all</button>
          </div>
          {recentJobs.length === 0 ? (
            <div className="empty-state">
              <div style={{ fontSize: 28, marginBottom: 10, opacity: 0.3 }}>◫</div>
              <div style={{ fontWeight: 400, color: 'var(--text-2)', marginBottom: 6 }}>No jobs yet</div>
              <div style={{ fontSize: 12, marginBottom: 16 }}>Create your first job posting to get started.</div>
              <button className="btn btn-primary" style={{ fontSize: 11 }} onClick={() => navigate('/client/jobs')}>+ Create Job</button>
            </div>
          ) : (
            recentJobs.map(j => (
              <div key={j.id} className="table-row clickable" onClick={() => navigate('/client/jobs')}>
                <div className="col-main">
                  <div className="col-name">{j.title}</div>
                  <div className="col-sub">{new Date(j.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
                </div>
                <div className="col-right">
                  <span className={`badge ${j.status === 'active' ? 'badge-green' : 'badge-amber'}`}>{j.status ?? 'active'}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
