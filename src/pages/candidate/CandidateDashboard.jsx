import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'

const PROFILE_FIELDS = ['full_name', 'email', 'candidate_role', 'total_years', 'skills', 'summary', 'linkedin_url']

function profileScore(pool) {
  if (!pool) return 0
  const filled = PROFILE_FIELDS.filter(f => {
    const v = pool[f]
    if (Array.isArray(v)) return v.length > 0
    return v != null && String(v).trim() !== '' && v !== 0
  })
  return Math.round((filled.length / PROFILE_FIELDS.length) * 100)
}

function scoreColor(s) {
  return s >= 80 ? 'var(--green)' : s >= 50 ? 'var(--amber)' : 'var(--red)'
}

function dimColor(v) {
  return v >= 70 ? 'var(--green)' : v >= 50 ? 'var(--accent)' : 'var(--red)'
}

function matchStatus(m) {
  if (m.scores?.overallScore != null) return { label: 'Interview reviewed', sub: 'Final decision pending', cls: 'badge-green' }
  if (m.match_pass === true)  return { label: 'Shortlisted', sub: 'Interview invite coming within 2 business days', cls: 'badge-blue' }
  if (m.match_pass === false) return { label: 'Not progressed', sub: 'Not selected for this role', cls: 'badge-red' }
  return { label: 'Under review', sub: 'CV being assessed — usually within 24 hours', cls: 'badge-amber' }
}

function appStatus(c) {
  if (c.final_decision === 'hired')    return { label: 'Offer made',         sub: 'Check your email for details',                     cls: 'badge-green' }
  if (c.final_decision === 'rejected') return { label: 'Not progressed',     sub: 'Not selected for this role',                       cls: 'badge-red'   }
  if (c.scores?.overallScore != null)  return { label: 'Interview reviewed', sub: 'Final decision pending',                           cls: 'badge-blue'  }
  if (c.match_pass === true)           return { label: 'Shortlisted',        sub: 'Interview invite coming within 2 business days',   cls: 'badge-blue'  }
  if (c.match_pass === false)          return { label: 'Not progressed',     sub: 'Not selected for this role',                       cls: 'badge-red'   }
  return                                      { label: 'Under review',       sub: 'CV being assessed — usually within 24 hours',      cls: 'badge-amber' }
}

export default function CandidateDashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [poolEntry,     setPoolEntry]     = useState(null)
  const [matches,       setMatches]       = useState([])
  const [applications,  setApplications]  = useState([])
  const [loading,       setLoading]       = useState(true)

  useEffect(() => { if (user) load() }, [user])

  async function load() {
    try { // fix: wrap in try/finally so setLoading(false) always fires on query error
    const { data: pool } = await supabase
      .from('talent_pool')
      .select('*')
      .eq('candidate_user_id', user.id)
      .single()

    setPoolEntry(pool)

    const [matchRes, appRes] = await Promise.all([
      pool
        ? supabase.from('job_matches').select('*, jobs(id, title, experience_years, required_skills)').eq('talent_id', pool.id).order('match_score', { ascending: false })
        : Promise.resolve({ data: [] }),
      supabase.from('candidates').select('id, full_name, candidate_role, match_pass, match_score, scores, final_decision, created_at, jobs(id, title)').eq('candidate_user_id', user.id).order('created_at', { ascending: false }),
    ])

    setMatches(matchRes.data ?? [])
    setApplications(appRes.data ?? [])
    } finally {
      setLoading(false) // fix: always clear loading even when queries fail
    }
  }

  if (loading) return <div className="page" style={{ display: 'flex', alignItems: 'center', gap: 10 }}><span className="spinner" /> Loading…</div>

  const score       = profileScore(poolEntry)
  const interviewsDone = matches.filter(m => m.scores?.overallScore != null).length
  const avgScore    = interviewsDone > 0
    ? Math.round(matches.filter(m => m.scores?.overallScore != null).reduce((a, m) => a + m.scores.overallScore, 0) / interviewsDone)
    : null

  const displayMatches = matches.slice(0, 3)

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>Welcome back{poolEntry?.full_name ? `, ${poolEntry.full_name.split(' ')[0]}` : ''}</h2>
          <p>Your talent profile</p>
        </div>
      </div>

      {/* Metrics */}
      <div className="metrics-row">
        <div className="metric-card" style={{ cursor: 'pointer', position: 'relative', overflow: 'hidden' }} onClick={() => navigate('/candidate/profile')}>
          <span className="metric-val" style={{ color: scoreColor(score) }}>{score}%</span>
          <span className="metric-label">Profile Complete</span>
          <div style={{ position: 'absolute', bottom: 0, left: 0, width: `${score}%`, height: 3, background: scoreColor(score), borderRadius: '0 2px 2px 0', transition: 'width 0.6s' }} />
        </div>
        <div className="metric-card blue" style={{ cursor: 'pointer' }} onClick={() => navigate('/candidate/matches')}>
          <span className="metric-val">{matches.length}</span>
          <span className="metric-label">Active Matches</span>
        </div>
        <div className="metric-card green">
          <span className="metric-val">{interviewsDone}</span>
          <span className="metric-label">Interviews Completed</span>
        </div>
        <div className="metric-card amber">
          <span className="metric-val">{avgScore != null ? `${avgScore}` : '—'}</span>
          <span className="metric-label">Avg. Interview Score</span>
        </div>
      </div>

      {/* Profile completeness hint */}
      {score < 80 && (
        <div style={{ padding: '12px 16px', background: 'var(--surface)', border: '1px solid var(--border)', borderLeft: '3px solid var(--accent)', borderRadius: 8, marginBottom: 20, fontSize: 13, color: 'var(--text-2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Your profile is {score}% complete — a complete profile improves your matching quality.</span>
          <button className="btn btn-secondary" style={{ fontSize: 11, padding: '4px 10px' }} onClick={() => navigate('/candidate/profile')}>Complete Profile →</button>
        </div>
      )}

      {/* Direct Applications */}
      {applications.length > 0 && (
        <div className="section-card">
          <div className="section-card-head">
            <h3>Your Applications</h3>
          </div>
          {applications.map(c => {
            const st = appStatus(c)
            return (
              <div key={c.id} className="table-row" style={{ cursor: 'default' }}>
                <div className="col-main">
                  <div className="col-name">{c.jobs?.title ?? 'Role'}</div>
                  <div className="col-sub">{c.candidate_role} · Applied {new Date(c.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })}</div>
                </div>
                <div className="col-right" style={{ flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    {c.match_score != null && (
                      <span className="mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>Score {c.match_score}</span>
                    )}
                    <span className={`badge ${st.cls}`}>{st.label}</span>
                  </div>
                  {st.sub && <div style={{ fontSize: 11, color: 'var(--text-3)', textAlign: 'right' }}>{st.sub}</div>}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Active Matches */}
      <div className="section-card">
        <div className="section-card-head">
          <h3>Your Active Matches</h3>
          {matches.length > 3 && (
            <button className="btn btn-secondary" style={{ fontSize: 11, padding: '4px 10px' }} onClick={() => navigate('/candidate/matches')}>View All {matches.length} →</button>
          )}
        </div>
        {matches.length === 0 ? (
          <div className="empty-state" style={{ padding: '30px 20px' }}>
            <div style={{ fontSize: 28, opacity: 0.15, marginBottom: 10 }}>◎</div>
            <div>You haven't been matched to any roles yet.</div>
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 6 }}>Keep your profile up to date to improve your chances.</div>
          </div>
        ) : (
          displayMatches.map(m => {
            const st = matchStatus(m)
            return (
              <div key={m.id} className="table-row" style={{ cursor: 'pointer' }} onClick={() => navigate('/candidate/matches')}>
                <div className="col-main">
                  <div className="col-name">{m.jobs?.title ?? 'Confidential Role'}</div>
                  <div className="col-sub">{m.jobs?.experience_years ?? '?'}+ years · {(m.jobs?.required_skills ?? []).slice(0, 3).join(', ')}</div>
                </div>
                <div className="col-right">
                  {m.match_score != null && (
                    <span className="mono" style={{ fontSize: 12, fontWeight: 700, color: dimColor(m.match_score) }}>
                      {m.match_score}/100
                    </span>
                  )}
                  <span className={`badge ${st.cls}`}>{st.label}</span>
                  {m.scores?.recommendation && (
                    <span className="mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>{m.scores.recommendation}</span>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* Profile Snapshot */}
      {poolEntry && (
        <div className="section-card">
          <div className="section-card-head">
            <h3>Profile Snapshot</h3>
            <button className="btn btn-secondary" style={{ fontSize: 11, padding: '4px 10px' }} onClick={() => navigate('/candidate/profile')}>Edit Profile →</button>
          </div>
          <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <strong style={{ fontFamily: 'var(--font-head)', fontSize: 18 }}>{poolEntry.full_name}</strong>
              {poolEntry.candidate_role && <span style={{ fontSize: 13, color: 'var(--text-2)', alignSelf: 'flex-end' }}>· {poolEntry.candidate_role}</span>}
              {poolEntry.total_years > 0 && <span style={{ fontSize: 13, color: 'var(--text-3)', alignSelf: 'flex-end' }}>· {poolEntry.total_years}y exp</span>}
            </div>
            {poolEntry.summary && <p style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.7, margin: 0 }}>{poolEntry.summary}</p>}
            {(poolEntry.skills ?? []).length > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {poolEntry.skills.map(s => (
                  <span key={s} className="badge" style={{ fontSize: 11, background: 'var(--surface2)', border: '1px solid var(--border)' }}>{s}</span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
