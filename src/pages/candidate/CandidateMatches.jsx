import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'

const REC_COLOR = { 'Strong Hire': 'var(--green)', 'Hire': 'var(--accent)', 'Borderline': 'var(--amber)', 'Reject': 'var(--red)' }

function dimColor(v) {
  return v >= 70 ? 'var(--green)' : v >= 50 ? 'var(--accent)' : 'var(--red)'
}

function matchStatus(m) {
  if (m.scores?.overallScore != null) return { label: 'Interview reviewed', sub: 'Final decision pending', cls: 'badge-green' }
  if (m.match_pass === true)  return { label: 'Shortlisted', sub: 'Interview invite within 2 business days', cls: 'badge-blue' }
  if (m.match_pass === false) return { label: 'Not progressed', sub: 'Not selected for this role', cls: 'badge-red' }
  return { label: 'Under review', sub: 'CV being assessed — usually within 24 hours', cls: 'badge-amber' }
}

function ScoreBar({ label, value }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
      <span style={{ width: 110, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>{label}</span>
      <div style={{ flex: 1, height: 4, background: 'var(--surface2)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${value}%`, height: '100%', background: dimColor(value), borderRadius: 2 }} />
      </div>
      <span style={{ width: 32, textAlign: 'right', color: dimColor(value), fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{value}</span>
    </div>
  )
}

export default function CandidateMatches() {
  const { user } = useAuth()
  const [matches,  setMatches]  = useState([])
  const [filter,   setFilter]   = useState('all')
  const [expanded, setExpanded] = useState(null)
  const [loading,  setLoading]  = useState(true)

  useEffect(() => { if (user) load() }, [user])

  async function load() {
    try { // fix: wrap in try/finally so setLoading(false) always fires on query error
    const { data: pool } = await supabase
      .from('talent_pool')
      .select('id')
      .eq('candidate_user_id', user.id)
      .single()

    if (pool) {
      const { data: matchData } = await supabase
        .from('job_matches')
        .select('*, jobs(id, title, experience_years, required_skills, description, show_company_name, profiles(company_name)), video_urls, scores, interview_transcript')
        .eq('talent_id', pool.id)
        .order('match_score', { ascending: false })
      setMatches(matchData ?? [])
    }
    } finally {
      setLoading(false) // fix: always clear loading even when queries fail
    }
  }

  const FILTERS = [
    { key: 'all',      label: 'All' },
    { key: 'passed',   label: 'Passed' },
    { key: 'interview',label: 'Interview Done' },
    { key: 'rejected', label: 'Not Selected' },
  ]

  const filtered = matches.filter(m => {
    if (filter === 'interview') return m.scores?.overallScore != null
    if (filter === 'passed')    return m.match_pass === true && m.scores?.overallScore == null
    if (filter === 'rejected')  return m.match_pass === false
    return true
  })

  if (loading) return <div className="page" style={{ display: 'flex', alignItems: 'center', gap: 10 }}><span className="spinner" /> Loading…</div>

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>My Matches</h2>
          <p>Roles you've been matched to</p>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {FILTERS.map(f => (
            <button
              key={f.key}
              className={`btn ${filter === f.key ? 'btn-primary' : 'btn-secondary'}`}
              style={{ fontSize: 11, padding: '4px 10px' }}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="section-card">
          <div className="empty-state" style={{ padding: '40px 20px' }}>
            <div style={{ fontSize: 32, opacity: 0.15, marginBottom: 12, fontFamily: 'var(--font-head)' }}>◎</div>
            {matches.length === 0
              ? <>
                  <div>You haven't been matched to any roles yet.</div>
                  <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 6 }}>Make sure your profile is complete and up to date.</div>
                </>
              : <div>No matches in this category.</div>
            }
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {filtered.map(m => {
            const st        = matchStatus(m)
            const isOpen    = expanded === m.id
            const hasScores = m.scores?.overallScore != null
            return (
              <div key={m.id} className="section-card" style={{ marginBottom: 0 }}>
                <div
                  style={{ padding: '16px 20px', display: 'flex', alignItems: 'flex-start', gap: 12, cursor: hasScores ? 'pointer' : 'default' }}
                  onClick={() => hasScores && setExpanded(isOpen ? null : m.id)}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
                      <span style={{ fontFamily: 'var(--font-head)', fontSize: 17 }}>{m.jobs?.title ?? 'Confidential Role'}</span>
                      <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
                        {m.jobs?.show_company_name !== false && m.jobs?.profiles?.company_name
                          ? `· ${m.jobs.profiles.company_name}`
                          : '· Confidential Company'}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                      <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{m.jobs?.experience_years ?? '?'}+ years required</span>
                      {(m.jobs?.required_skills ?? []).slice(0, 4).map(s => (
                        <span key={s} className="badge" style={{ fontSize: 10, background: 'var(--surface2)', border: '1px solid var(--border)' }}>{s}</span>
                      ))}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      {m.match_score != null && (
                        <span className="mono" style={{ fontSize: 13, fontWeight: 700, color: dimColor(m.match_score) }}>
                          {m.match_score}/100
                        </span>
                      )}
                      <span className={`badge ${st.cls}`}>{st.label}</span>
                      {hasScores && <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{isOpen ? '▲' : '▼'}</span>}
                    </div>
                    {st.sub && <div style={{ fontSize: 11, color: 'var(--text-3)', textAlign: 'right' }}>{st.sub}</div>}
                  </div>
                </div>

                {isOpen && hasScores && (
                  <div style={{ padding: '0 20px 20px', borderTop: '1px solid var(--border)', paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                      <div>
                        <div style={{ fontSize: 32, fontWeight: 700, color: dimColor(m.scores.overallScore), fontFamily: 'var(--font-mono)' }}>
                          {m.scores.overallScore}
                          <span style={{ fontSize: 14, color: 'var(--text-3)', fontWeight: 400 }}>/100</span>
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>Overall Score</div>
                      </div>
                      {m.scores.recommendation && (
                        <span style={{ fontSize: 13, fontFamily: 'var(--font-mono)', color: REC_COLOR[m.scores.recommendation] ?? 'var(--text-3)', fontWeight: 600 }}>
                          {m.scores.recommendation}
                        </span>
                      )}
                    </div>

                    {(m.scores.technicalAbility != null) && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <ScoreBar label="Technical"    value={m.scores.technicalAbility} />
                        <ScoreBar label="Communication" value={m.scores.communication} />
                        <ScoreBar label="Role Fit"     value={m.scores.roleFit} />
                        {m.scores.problemSolving     != null && <ScoreBar label="Problem Solving" value={m.scores.problemSolving} />}
                        {m.scores.experienceRelevance!= null && <ScoreBar label="Experience"      value={m.scores.experienceRelevance} />}
                      </div>
                    )}

                    {m.scores.insight && (
                      <div style={{ padding: '12px 14px', background: 'var(--surface2)', borderRadius: 6, fontSize: 13, color: 'var(--text-2)', lineHeight: 1.7, fontStyle: 'italic' }}>
                        "{m.scores.insight}"
                      </div>
                    )}

                    {m.scores.bestAnswer && (
                      <div>
                        <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Best Answer</div>
                        <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.7, borderLeft: '2px solid var(--accent)', paddingLeft: 10 }}>"{m.scores.bestAnswer}"</div>
                      </div>
                    )}

                    {/* Interview transcript */}
                    {Array.isArray(m.interview_transcript) && m.interview_transcript.length > 0 && (
                      <div>
                        <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Interview Transcript</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {m.interview_transcript.filter(t => t.role !== 'system').map((t, i) => (
                            <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                              <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: t.role === 'assistant' ? 'var(--accent)' : 'var(--text-3)', flexShrink: 0, width: 52, paddingTop: 2 }}>
                                {t.role === 'assistant' ? 'INTERVIEWER' : 'YOU'}
                              </span>
                              <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.6, flex: 1 }}>{t.content}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Interview question history */}
                    {Array.isArray(m.video_urls) && m.video_urls.length > 0 && (
                      <div>
                        <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Your Answers</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          {m.video_urls.map((v, i) => (
                            <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 12px', background: 'var(--surface2)', borderRadius: 6 }}>
                              <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--accent)', flexShrink: 0, marginTop: 2 }}>Q{i + 1}</span>
                              <div style={{ flex: 1 }}>
                                <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5 }}>{v.q}</div>
                              </div>
                              {v.url && (
                                <a href={v.url} target="_blank" rel="noopener noreferrer"
                                  style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: '#B8924A', textDecoration: 'none', flexShrink: 0, whiteSpace: 'nowrap' }}>
                                  ▶ Watch
                                </a>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <div style={{ marginTop: 24, padding: '14px 18px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, color: 'var(--text-3)', lineHeight: 1.7 }}>
        <strong style={{ color: 'var(--text-2)' }}>About our process:</strong> This role uses AI-assisted screening. A human recruiter reviews all AI decisions before final selection. Company details are kept confidential until the offer stage to ensure fair evaluation.
      </div>

      <div style={{ marginTop: 12, padding: '14px 18px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, color: 'var(--text-3)', lineHeight: 1.7, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <span>Questions about your application?</span>
        <a href="mailto:candidates@oneselect.co.uk" style={{ color: 'var(--accent)', textDecoration: 'none', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
          candidates@oneselect.co.uk →
        </a>
      </div>
    </div>
  )
}
