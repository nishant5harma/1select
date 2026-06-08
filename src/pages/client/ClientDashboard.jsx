import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'

const SOURCE_NAMES = {
  linkedin:          'LinkedIn',
  linkedin_sourced:  'LinkedIn',
  manually_added:    'Internal / Manual',
  talent_pool:       'Talent Pool',
  cv_upload:         'CV Upload',
}

export default function ClientDashboard() {
  const { user, profile, profileLoading, effectiveClientId } = useAuth()
  const navigate = useNavigate()

  const [stats, setStats]                   = useState({ jobs: 0, candidates: 0, screened: 0, passed: 0, interviewed: 0 })
  const [allCandidatesFull, setAllCandidatesFull] = useState([])
  const [recentCandidates, setRecentCandidates]   = useState([])
  const [recentJobs, setRecentJobs]         = useState([])
  const [recentActivity, setRecentActivity] = useState([])
  const [loading, setLoading]               = useState(true)
  const [showWelcome, setShowWelcome]       = useState(false)
  const [bannerDismissed, setBannerDismissed] = useState(false)
  const [avgMatchScore, setAvgMatchScore]   = useState(null)
  const [jobMap, setJobMap]                 = useState({})
  const [activeRole, setActiveRole]         = useState('all')

  // count-up displayed values
  const [disp, setDisp] = useState({ scanned: 0, matched: 0, review: 0, shortlisted: 0 })

  const [showPasswordChange, setShowPasswordChange] = useState(false)
  const [newPassword,    setNewPassword]    = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordError,  setPasswordError]  = useState('')
  const [passwordSaving, setPasswordSaving] = useState(false)

  const initRef    = useRef(false)
  const sourcingRef = useRef(null)

  useEffect(() => {
    if (!user || profileLoading) return
    if (!effectiveClientId) return
    if (initRef.current) return
    initRef.current = true

    const updates = { last_seen_at: new Date().toISOString() }
    if (!profile?.first_login_at) updates.first_login_at = new Date().toISOString()
    supabase.from('profiles').update(updates).eq('id', user.id)

    if (profile?.first_login === true) {
      if (profile?.subscription_status === 'trial') {
        supabase.from('profiles').update({ first_login: false }).eq('id', user.id)
        setShowWelcome(true)
        load()
      } else if (!sessionStorage.getItem(`pw_set_${user.id}`)) {
        setLoading(false)
        setShowPasswordChange(true)
      } else {
        load()
      }
    } else {
      load()
    }
  }, [user, profileLoading, effectiveClientId])

  // Animate count-up + bar fills after data loads
  useEffect(() => {
    if (loading || stats.candidates === 0) return
    const targets = {
      scanned:    stats.candidates,
      matched:    stats.passed,
      review:     Math.max(0, stats.passed - stats.interviewed),
      shortlisted: stats.interviewed,
    }
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) { setDisp(targets); triggerBars(); return }

    const dur = 1100, start = performance.now()
    const tick = (now) => {
      const p = Math.min((now - start) / dur, 1)
      const e = 1 - Math.pow(1 - p, 3)
      setDisp({
        scanned:     Math.round(e * targets.scanned),
        matched:     Math.round(e * targets.matched),
        review:      Math.round(e * targets.review),
        shortlisted: Math.round(e * targets.shortlisted),
      })
      if (p < 1) requestAnimationFrame(tick)
      else triggerBars()
    }
    requestAnimationFrame(tick)
  }, [loading, stats.candidates])

  function triggerBars() {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      sourcingRef.current?.querySelectorAll('.fstage-track i, .chan-bar i, .rc-meter i')
        .forEach(b => { b.style.width = getComputedStyle(b).getPropertyValue('--w') || '0%' })
    }))
  }

  async function load() {
    try {
      const { data: jobs } = await supabase
        .from('jobs')
        .select('id, title, status, created_at')
        .eq('recruiter_id', effectiveClientId)
        .order('created_at', { ascending: false })

      const jobIds = (jobs ?? []).map(j => j.id)
      setRecentJobs((jobs ?? []).slice(0, 4))

      const map = {}
      ;(jobs ?? []).forEach(j => { map[j.id] = j.title })
      setJobMap(map)

      if (!jobIds.length) return

      const { data: allCandidates } = await supabase
        .from('candidates')
        .select('id, full_name, candidate_role, match_score, match_pass, scores, created_at, job_id, source')
        .in('job_id', jobIds)
        .not('match_pass', 'is', null)
        .order('created_at', { ascending: false })

      const all = allCandidates ?? []
      const scored = all.filter(c => c.match_score != null)
      setAvgMatchScore(scored.length > 0
        ? Math.round(scored.reduce((s, c) => s + c.match_score, 0) / scored.length)
        : null)

      setStats({
        jobs:        jobs.length,
        candidates:  all.length,
        screened:    scored.length,
        passed:      all.filter(c => c.match_pass === true).length,
        interviewed: all.filter(c => c.scores != null).length,
      })
      setAllCandidatesFull(all)
      setRecentCandidates(all.slice(0, 6))

      const { data: activity } = await supabase
        .from('audit_log')
        .select('id, action, entity_type, metadata, created_at')
        .in('job_id', jobIds)
        .order('created_at', { ascending: false })
        .limit(10)
      setRecentActivity(activity ?? [])
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
    setNewPassword(''); setConfirmPassword(''); setPasswordSaving(false); setShowPasswordChange(false)
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
      bg:    c.scores.recommendation === 'Strong Hire' ? 'var(--green-d)'  :
             c.scores.recommendation === 'Hire'        ? 'var(--accent-d)' :
             c.scores.recommendation === 'Reject'      ? 'var(--red-d)'    : 'var(--amber-d)',
    }
    if (c.match_pass === true)  return { label: 'Awaiting Interview', color: 'var(--amber)', bg: 'var(--amber-d)' }
    if (c.match_pass === false) return { label: 'Screened Out',       color: 'var(--red)',   bg: 'var(--red-d)'   }
    if (c.match_score != null)  return { label: 'Screened',           color: 'var(--accent)',bg: 'var(--accent-d)'}
    return { label: 'Pending', color: 'var(--text-3)', bg: 'var(--surface2)' }
  }

  function convPct(num, den) {
    return den > 0 ? `${Math.round((num / den) * 100)}%` : '—'
  }

  // Per-job stats for role chips
  function jobChipStats(jobId) {
    const cands = jobId === 'all' ? allCandidatesFull : allCandidatesFull.filter(c => c.job_id === jobId)
    const shortlisted = cands.filter(c => c.scores != null).length
    const inReview = cands.filter(c => c.match_pass === true).length
    const total = Math.max(cands.length, 1)
    return {
      shortlisted,
      inReview,
      shortPct: `${Math.round((shortlisted / total) * 100)}%`,
      revPct:   `${Math.round((inReview / total) * 100)}%`,
      status:   shortlisted === 0 && cands.length > 0 ? 'warn' : 'ok',
    }
  }

  // Channel breakdown from candidate source field
  const channelData = (() => {
    const counts = {}
    allCandidatesFull.forEach(c => {
      const key = c.source || 'cv_upload'
      counts[key] = (counts[key] || 0) + 1
    })
    const total = allCandidatesFull.length || 1
    const entries = Object.entries(counts)
      .map(([key, count]) => ({
        name: SOURCE_NAMES[key] || key,
        count,
        pct: Math.round(count / total * 100),
      }))
      .sort((a, b) => b.count - a.count)
    const leader = entries[0]?.count || 1
    return entries.map(c => ({ ...c, barPct: `${Math.round(c.count / leader * 100)}%` }))
  })()

  // Funnel track widths (sqrt-scaled so small stages stay visible)
  const maxFunnel = Math.max(stats.candidates, 1)
  function sqrtTrack(val) {
    return `${Math.round(Math.sqrt(Math.max(val, 0) / maxFunnel) * 100)}%`
  }

  // Candidate cards filtered by active role chip
  const visibleCandidates = activeRole === 'all'
    ? recentCandidates
    : recentCandidates.filter(c => c.job_id === activeRole)

  if (showPasswordChange) {
    return (
      <div className="modal-overlay" style={{ zIndex: 1000 }}>
        <div className="modal" style={{ maxWidth: 420 }}>
          <div className="modal-head">
            <div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.2em', color: 'var(--accent)', marginBottom: 4 }}>One Select</div>
              <h3 style={{ margin: 0 }}>Welcome to One Select</h3>
            </div>
          </div>
          <div className="modal-body">
            <p style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.7, marginBottom: 24 }}>Please set a new password to secure your account before continuing to your dashboard.</p>
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
              <button type="submit" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', padding: '12px' }} disabled={passwordSaving}>
                {passwordSaving ? <><span className="spinner" style={{ width: 13, height: 13 }} /> Setting password…</> : 'Set Password & Continue'}
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
      {/* ── Welcome modal ── */}
      {showWelcome && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, padding: 24 }}>
          <div style={{ background: 'var(--surface)', width: '100%', maxWidth: 480, border: '1px solid var(--border)', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '28px 32px 0' }}>
              <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.2em', color: 'var(--accent)', marginBottom: 8 }}>One Select</div>
              <h2 style={{ fontFamily: 'var(--font-head)', fontWeight: 300, fontSize: 24, margin: 0, color: 'var(--text)' }}>Welcome to One Select</h2>
              <p style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.75, marginTop: 10 }}>Your AI hiring platform is ready. Here's what to do first:</p>
            </div>
            <div style={{ padding: '16px 32px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              {[
                { n: 1, text: 'Post your first job', desc: 'Describe the role and skills required — takes 2 minutes.' },
                { n: 2, text: 'Your recruiter will upload and screen CVs', desc: 'AI screening scores every CV against your requirements automatically.' },
                { n: 3, text: 'Review scores and interview results here', desc: 'Approve shortlisted candidates and watch their video interviews.' },
              ].map(step => (
                <div key={step.n} style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                  <div style={{ width: 26, height: 26, borderRadius: '50%', background: 'var(--accent)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-mono)', fontSize: 12, flexShrink: 0, fontWeight: 700 }}>{step.n}</div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{step.text}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>{step.desc}</div>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ padding: '16px 32px 28px', borderTop: '1px solid var(--border)', display: 'flex', gap: 10 }}>
              <button className="btn btn-primary" style={{ flex: 1, justifyContent: 'center', padding: '11px', fontSize: 12 }} onClick={() => dismissWelcome(true)}>Post Your First Job →</button>
              <button className="btn btn-secondary" style={{ fontSize: 12 }} onClick={() => dismissWelcome(false)}>Later</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Getting started checklist ── */}
      {showChecklist && (
        <div className="section-card" style={{ marginBottom: 20, borderLeft: '3px solid var(--accent)' }}>
          <div className="section-card-head">
            <div>
              <h3 style={{ margin: 0 }}>Getting started</h3>
              <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-3)' }}>Complete these steps to get your first hire</p>
            </div>
            <button className="btn btn-secondary" style={{ fontSize: 10, padding: '3px 8px' }} onClick={() => { localStorage.setItem(`cl_done_${user.id}`, '1'); navigate(0) }}>Dismiss</button>
          </div>
          <div style={{ padding: '4px 20px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[
              { num: 1, done: true,                 label: 'Create your account',          desc: 'Your portal is ready to use.',                                                                            action: null },
              { num: 2, done: stats.jobs > 0,       label: 'Add your first job',           desc: 'Describe the role — your recruiter will start sourcing candidates.',                                      action: { label: 'Create a job →', path: '/client/jobs' } },
              { num: 3, done: stats.candidates > 0, label: 'Review shortlisted candidates', desc: 'Once your recruiter shares candidates, their scores and interviews appear here.',                         action: stats.jobs > 0 ? { label: 'View candidates →', path: '/client/candidates' } : null },
            ].map(step => (
              <div key={step.num} style={{ display: 'flex', gap: 14, alignItems: step.done ? 'center' : 'flex-start' }}>
                <div style={{ width: 24, height: 24, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: step.done ? 'var(--green)' : 'var(--surface2)', border: step.done ? 'none' : '1px solid var(--border)', fontSize: 11, fontFamily: 'var(--font-mono)', color: step.done ? 'white' : 'var(--text-3)', fontWeight: 700 }}>
                  {step.done ? '✓' : step.num}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: step.done ? 'var(--text-3)' : 'var(--text)', textDecoration: step.done ? 'line-through' : 'none' }}>{step.label}</div>
                  {!step.done && <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>{step.desc}</div>}
                  {!step.done && step.action && (
                    <button className="btn btn-secondary" style={{ fontSize: 11, padding: '3px 10px', marginTop: 8 }} onClick={() => navigate(step.action.path)}>{step.action.label}</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── First-login banner ── */}
      {profile?.first_login === true && !bannerDismissed && !showWelcome && (
        <div style={{ background: 'var(--accent-d)', border: '1px solid var(--accent)', borderRadius: 'var(--r)', padding: '16px 20px', marginBottom: 24, display: 'flex', alignItems: 'flex-start', gap: 14 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: 'var(--font-head)', fontSize: 17, fontWeight: 400, color: 'var(--accent)', marginBottom: 4 }}>Welcome to One Select</div>
            <div style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.6 }}>Your hiring portal is ready. Post a job to start receiving AI-screened candidates from your recruiter.</div>
          </div>
          <button onClick={() => setBannerDismissed(true)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', fontSize: 18, lineHeight: 1, padding: 2 }}>×</button>
        </div>
      )}

      {/* ── Page head ── */}
      <div className="page-head">
        <div>
          <h2>Dashboard</h2>
          <p>
            Sourcing overview{profile?.company_name ? ` for ${profile.company_name}` : ''}
            {stats.jobs > 0 ? ` · ${stats.jobs} active role${stats.jobs !== 1 ? 's' : ''}` : ''}
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => navigate('/client/jobs')}>+ New Job</button>
      </div>

      {/* ── Metric cards ── */}
      <div className="metrics-row">
        <div className="metric-card blue" style={{ cursor: 'pointer' }} onClick={() => navigate('/client/jobs')}>
          <span style={{ fontSize: 15, opacity: 0.22, lineHeight: 1, marginBottom: 8 }}>◫</span>
          <span className="metric-val">{stats.jobs}</span>
          <span className="metric-label">Active Jobs</span>
          {stats.jobs === 0 && <span style={{ fontSize: 11, color: 'var(--accent)', marginTop: 6, fontFamily: 'var(--font-mono)' }}>+ Create a job to start</span>}
        </div>
        <div className="metric-card" style={{ cursor: 'pointer' }} onClick={() => navigate('/client/candidates')}>
          <span style={{ fontSize: 15, opacity: 0.22, lineHeight: 1, marginBottom: 8 }}>◌</span>
          <span className="metric-val">{stats.candidates}</span>
          <span className="metric-label">Shared with You</span>
          {stats.candidates === 0 && stats.jobs > 0 && <span style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 6, fontFamily: 'var(--font-mono)' }}>Your recruiter will share soon</span>}
        </div>
        <div className="metric-card amber" style={{ cursor: 'pointer' }} onClick={() => navigate('/client/candidates')}>
          <span style={{ fontSize: 15, opacity: 0.22, lineHeight: 1, marginBottom: 8 }}>◐</span>
          <span className="metric-val">{stats.passed}</span>
          <span className="metric-label">Awaiting Interview</span>
          {stats.passed === 0 && stats.candidates > 0 && <span style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 6, fontFamily: 'var(--font-mono)' }}>Screening in progress</span>}
        </div>
        <div className="metric-card green" style={{ cursor: 'pointer' }} onClick={() => navigate('/client/reports')}>
          <span style={{ fontSize: 15, opacity: 0.22, lineHeight: 1, marginBottom: 8 }}>◱</span>
          <span className="metric-val">{stats.interviewed}</span>
          <span className="metric-label">Interviews Done</span>
          {stats.interviewed === 0 && stats.passed > 0 && <span style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 6, fontFamily: 'var(--font-mono)' }}>Interviews not yet started</span>}
        </div>
      </div>

      {/* ── Role context chips ── */}
      {stats.jobs > 0 && (
        <div className="roles-row" ref={sourcingRef}>
          {/* All roles chip */}
          {(() => {
            const s = jobChipStats('all')
            return (
              <div
                className={`role-chip role-all${activeRole === 'all' ? ' active' : ''}`}
                onClick={() => setActiveRole('all')}
              >
                <div className="rc-head"><span className="rc-status all" /><span className="rc-title">All roles</span></div>
                <div className="rc-stats">
                  <span className="rc-big">{s.shortlisted}</span>
                  <span className="rc-lbl">shortlisted</span>
                  <span className="rc-rev"><b>{s.inReview}</b> in review</span>
                </div>
                <div className="rc-meter">
                  <i className="seg-short" style={{ '--w': s.shortPct }} />
                  <i className="seg-rev"   style={{ '--w': s.revPct }} />
                </div>
              </div>
            )
          })()}
          {/* Per-job chips */}
          {recentJobs.map(j => {
            const s = jobChipStats(j.id)
            return (
              <div
                key={j.id}
                className={`role-chip${activeRole === j.id ? ' active' : ''}`}
                onClick={() => setActiveRole(activeRole === j.id ? 'all' : j.id)}
              >
                <div className="rc-head">
                  <span className={`rc-status ${s.status}`} />
                  <span className="rc-title" title={j.title}>{j.title}</span>
                </div>
                <div className="rc-stats">
                  <span className="rc-big">{s.shortlisted}</span>
                  <span className="rc-lbl">shortlisted</span>
                  <span className="rc-rev"><b>{s.inReview}</b> in review</span>
                </div>
                <div className="rc-meter">
                  <i className="seg-short" style={{ '--w': s.shortPct }} />
                  <i className="seg-rev"   style={{ '--w': s.revPct }} />
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── Sourcing Activity ── */}
      {stats.candidates > 0 && (
        <div className="section-card" style={{ marginBottom: 20 }} ref={stats.jobs === 0 ? sourcingRef : undefined}>
          <div className="section-card-head">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <h3>Sourcing Activity</h3>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'var(--font-mono)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-3)' }}>
                <span className="live-dot" />
                Live · last 30 days
              </span>
            </div>
            <button
              style={{ fontFamily: 'var(--font-mono)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer' }}
              onMouseEnter={e => e.currentTarget.style.textDecoration = 'underline'}
              onMouseLeave={e => e.currentTarget.style.textDecoration = 'none'}
              onClick={() => navigate('/client/candidates')}
            >View full pipeline →</button>
          </div>

          {/* Funnel stage tiles */}
          <div className="funnel-grid">
            {/* Stage 1 – Profiles Scanned */}
            <div className="fstage s-scanned">
              <div className="fstage-top"><span className="fdot neutral" /><span className="fstage-label">Shared with You</span></div>
              <div className="fnum">{disp.scanned.toLocaleString()}</div>
              <div className="fstage-sub"><b>{stats.jobs}</b> active role{stats.jobs !== 1 ? 's' : ''}</div>
              <div className="fstage-track"><i style={{ '--w': '100%' }} /></div>
            </div>

            <div className="fconn">
              <span className="fconn-pct">{convPct(stats.passed, stats.candidates)}</span>
              <span className="fconn-arrow"><span className="fconn-line" /><span className="fconn-tip">▶</span></span>
              <span className="fconn-cap">passed screen</span>
            </div>

            {/* Stage 2 – Matched */}
            <div className="fstage s-matched">
              <div className="fstage-top"><span className="fdot accent" /><span className="fstage-label">Matched</span></div>
              <div className="fnum">{disp.matched.toLocaleString()}</div>
              <div className="fstage-sub">
                {avgMatchScore != null ? <><b>{avgMatchScore}</b> avg. match score</> : 'scoring in progress'}
              </div>
              <div className="fstage-track"><i style={{ '--w': sqrtTrack(stats.passed) }} /></div>
            </div>

            <div className="fconn">
              <span className="fconn-pct">{convPct(Math.max(0, stats.passed - stats.interviewed), stats.passed)}</span>
              <span className="fconn-arrow"><span className="fconn-line" /><span className="fconn-tip">▶</span></span>
              <span className="fconn-cap">awaiting iv</span>
            </div>

            {/* Stage 3 – Under Review */}
            <div className="fstage s-review">
              <div className="fstage-top"><span className="fdot amber" /><span className="fstage-label">Under Review</span></div>
              <div className="fnum">{disp.review.toLocaleString()}</div>
              <div className="fstage-sub"><b>{Math.max(0, stats.passed - stats.interviewed)}</b> awaiting interview</div>
              <div className="fstage-track"><i style={{ '--w': sqrtTrack(Math.max(0, stats.passed - stats.interviewed)) }} /></div>
            </div>

            <div className="fconn">
              <span className="fconn-pct">{convPct(stats.interviewed, stats.passed)}</span>
              <span className="fconn-arrow"><span className="fconn-line" /><span className="fconn-tip">▶</span></span>
              <span className="fconn-cap">shortlisted</span>
            </div>

            {/* Stage 4 – Shortlisted */}
            <div className="fstage s-shortlist">
              <div className="fstage-top"><span className="fdot green" /><span className="fstage-label">Shortlisted</span></div>
              <div className="fnum">{disp.shortlisted.toLocaleString()}</div>
              <div className="fstage-sub"><b>{stats.interviewed}</b> results ready</div>
              <div className="fstage-track"><i style={{ '--w': sqrtTrack(stats.interviewed) }} /></div>
            </div>
          </div>

          {/* Sourcing channels breakdown */}
          {channelData.length > 0 && (
            <div className="channels">
              <div className="channels-head">
                <span className="channels-title">Where profiles came from</span>
                <span className="channels-total"><b>{stats.candidates.toLocaleString()}</b> profiles · last 30 days</span>
              </div>
              <div className="chan-grid">
                {channelData.map((ch, i) => (
                  <div key={i} className="chan">
                    <span className="chan-name">{ch.name}</span>
                    <span className="chan-val">{ch.count.toLocaleString()}<span className="pct">{ch.pct}%</span></span>
                    <div className="chan-bar"><i style={{ '--w': ch.barPct }} /></div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Footer stat strip */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', borderTop: '1px solid var(--border)', background: 'var(--surface-2)' }}>
            {[
              { val: avgMatchScore ?? '—', unit: avgMatchScore != null ? '/100' : null, label: 'Avg. match score' },
              { val: stats.passed > 0 ? `${Math.round(stats.interviewed / stats.passed * 100)}` : '—', unit: stats.passed > 0 ? '%' : null, label: 'Interview rate' },
              { val: stats.jobs, unit: null, label: `Active role${stats.jobs !== 1 ? 's' : ''}` },
            ].map((item, i) => (
              <div key={i} style={{ padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: 3, borderRight: i < 2 ? '1px solid var(--border)' : 'none' }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 20, fontWeight: 500, color: 'var(--text)' }}>
                  {item.val}{item.unit && <span style={{ fontSize: 12, color: 'var(--text-3)', marginLeft: 3 }}>{item.unit}</span>}
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-3)' }}>{item.label}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Recent Activity ── */}
      {recentActivity.length > 0 && (
        <div className="section-card" style={{ marginBottom: 20 }}>
          <div className="section-card-head"><h3>Recent Activity</h3></div>
          <div style={{ padding: '4px 0 8px' }}>
            {recentActivity.map(entry => {
              const meta = entry.metadata ?? {}
              let icon = '◌', text = ''
              if (entry.action === 'interview_invited')  { icon = '✉'; text = `Interview invite sent to ${meta.candidate_name ?? 'a candidate'}` }
              else if (entry.action === 'decision_hired')    { icon = '✓'; text = `${meta.candidate_name ?? 'Candidate'} marked as hired` }
              else if (entry.action === 'decision_rejected') { icon = '✕'; text = `${meta.candidate_name ?? 'Candidate'} was not progressed` }
              else if (entry.action === 'client_approved')   { icon = '✓'; text = `You approved ${meta.candidate_name ?? 'a candidate'}` }
              else if (entry.action === 'client_rejected')   { icon = '✕'; text = `You rejected ${meta.candidate_name ?? 'a candidate'}` }
              else { text = entry.action.replace(/_/g, ' ') }
              const diff = Date.now() - new Date(entry.created_at).getTime()
              const ago = diff < 60000 ? 'just now' : diff < 3600000 ? `${Math.floor(diff / 60000)}m ago` : diff < 86400000 ? `${Math.floor(diff / 3600000)}h ago` : new Date(entry.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
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

      {/* ── Shortlisted Candidates ── */}
      {visibleCandidates.length > 0 ? (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '8px 2px 14px', marginTop: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <h3 style={{ fontFamily: 'var(--font-head)', fontSize: 20, fontWeight: 400, color: '#F0EDE8', margin: 0 }}>Shortlisted Candidates</h3>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--navy-text-2)' }}>
                {visibleCandidates.length} candidate{visibleCandidates.length !== 1 ? 's' : ''}
                {activeRole !== 'all' && recentJobs.find(j => j.id === activeRole) ? ` · ${recentJobs.find(j => j.id === activeRole).title}` : ''}
              </span>
            </div>
            <button
              style={{ fontFamily: 'var(--font-mono)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer' }}
              onMouseEnter={e => e.currentTarget.style.textDecoration = 'underline'}
              onMouseLeave={e => e.currentTarget.style.textDecoration = 'none'}
              onClick={() => navigate('/client/candidates')}
            >View all →</button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14, marginBottom: 24 }}>
            {visibleCandidates.map(c => {
              const st = getStatus(c)
              const score = c.match_score
              const jobTitle = jobMap[c.job_id]
              const initials = (c.full_name ?? '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
              const ringR = 18.5
              const ringC = 2 * Math.PI * ringR
              const ringColor = score != null ? (score >= 70 ? 'var(--green)' : score >= 50 ? 'var(--accent)' : 'var(--red)') : 'var(--border)'
              const ringOffset = score != null ? (ringC * (1 - score / 100)).toFixed(1) : ringC.toFixed(1)
              return (
                <div
                  key={c.id}
                  className="cand-card"
                  onClick={() => navigate('/client/candidates')}
                >
                  {jobTitle && (
                    <div className="cand-for">For · <b>{jobTitle}</b></div>
                  )}
                  <div className="cand-main">
                    <div className="cand-avatar">{initials}</div>
                    <div className="cand-id">
                      <div className="cand-name">{c.full_name}</div>
                      <div className="cand-role">{c.candidate_role}</div>
                    </div>
                    {score != null && (
                      <div className="score-ring" style={{ width: 46, height: 46 }}>
                        <svg width="46" height="46" viewBox="0 0 46 46" style={{ transform: 'rotate(-90deg)' }}>
                          <circle className="ring-bg" cx="23" cy="23" r={ringR} fill="none" strokeWidth="3" />
                          <circle className="ring-fg" cx="23" cy="23" r={ringR} fill="none" strokeWidth="3"
                            stroke={ringColor} strokeLinecap="round"
                            strokeDasharray={ringC.toFixed(1)} strokeDashoffset={ringOffset} />
                        </svg>
                        <div className="ring-inner">
                          <div className="ring-val">{score}</div>
                          <div className="ring-cap">match</div>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="cand-skills">
                    <span className="skill">{c.candidate_role}</span>
                  </div>
                  <div className="cand-foot">
                    <div className="cand-meta">
                      <span className="badge" style={{ color: st.color, background: st.bg }}>
                        {st.label}
                      </span>
                      {c.scores?.overallScore != null && (
                        <span className="cand-exp score-pill" style={{ color: c.scores.overallScore >= 70 ? 'var(--green)' : c.scores.overallScore >= 50 ? 'var(--accent)' : 'var(--red)' }}>
                          IV {(c.scores.overallScore / 10).toFixed(1)}/10
                        </span>
                      )}
                    </div>
                    <span className="cand-view">View profile →</span>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      ) : stats.candidates === 0 ? (
        <div className="section-card" style={{ marginBottom: 20 }}>
          <div className="section-card-head"><h3>Shortlisted Candidates</h3></div>
          <div className="empty-state">
            <div style={{ fontSize: 28, marginBottom: 10, opacity: 0.3 }}>◎</div>
            <div style={{ fontWeight: 400, color: 'var(--text-2)', marginBottom: 6 }}>No candidates yet</div>
            <div style={{ fontSize: 12 }}>Your One Select recruiter will share candidates shortly.</div>
          </div>
        </div>
      ) : null}

      {/* ── Your Jobs ── */}
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
  )
}
