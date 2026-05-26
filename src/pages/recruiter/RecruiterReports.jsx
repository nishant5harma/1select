import { useState, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'

const REC_COLOR  = { 'Strong Hire': 'var(--green)', 'Hire': 'var(--accent)', 'Borderline': 'var(--amber)', 'Reject': 'var(--red)' }
const REC_BG     = { 'Strong Hire': 'var(--green-d)', 'Hire': 'var(--accent-d)', 'Borderline': 'var(--amber-d)', 'Reject': 'var(--red-d)' }
const DIMS       = [
  ['technicalAbility',     'Technical'],
  ['communication',        'Comm.'],
  ['roleFit',              'Role Fit'],
  ['problemSolving',       'Prob. Solv.'],
  ['experienceRelevance',  'Experience'],
]

function dimColor(v) { return v >= 70 ? 'var(--green)' : v >= 50 ? 'var(--accent)' : 'var(--red)' }

function CandidateDetailModal({ candidate, onClose }) {
  const s = candidate.scores ?? {}
  const rec = s.recommendation
  const mono = { fontFamily: 'var(--font-mono)' }
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, padding: 20 }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', width: '100%', maxWidth: 620, maxHeight: '88vh', display: 'flex', flexDirection: 'column', borderRadius: 'var(--r)', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '20px 24px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 500, color: 'var(--text)', marginBottom: 2 }}>{candidate.full_name}</div>
            <div style={{ fontSize: 12, color: 'var(--text-3)', ...mono }}>{candidate.candidate_role}{candidate.total_years ? ` · ${candidate.total_years}y exp` : ''}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            {s.overallScore != null && (
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 28, fontWeight: 700, color: dimColor(s.overallScore), lineHeight: 1 }}>{s.overallScore}</div>
                {rec && <div style={{ fontSize: 10, ...mono, textTransform: 'uppercase', letterSpacing: '0.06em', color: REC_COLOR[rec] }}>{rec}</div>}
              </div>
            )}
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: 'var(--text-3)', lineHeight: 1, padding: '4px 8px' }}>✕</button>
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflow: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 18 }}>

          {/* Dimension scores */}
          {s.overallScore != null && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 12 }}>
              {DIMS.map(([key, label]) => (
                <div key={key}>
                  <div style={{ fontSize: 10, ...mono, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-3)', marginBottom: 4 }}>{label}</div>
                  <div style={{ height: 3, background: 'var(--border)', overflow: 'hidden', borderRadius: 2 }}>
                    <div style={{ height: '100%', width: `${s[key] ?? 0}%`, background: dimColor(s[key] ?? 0), transition: 'width 0.4s' }} />
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: dimColor(s[key] ?? 0), marginTop: 3, ...mono }}>{s[key] ?? '—'}</div>
                </div>
              ))}
            </div>
          )}

          {/* Summary */}
          {candidate.summary && (
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
              <div style={{ fontSize: 10, ...mono, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-3)', marginBottom: 6 }}>Summary</div>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--text-2)', lineHeight: 1.7 }}>{candidate.summary}</p>
            </div>
          )}

          {/* AI Insight */}
          {s.insight && (
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
              <div style={{ fontSize: 10, ...mono, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-3)', marginBottom: 6 }}>AI Insight</div>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--text-2)', lineHeight: 1.7, fontStyle: 'italic' }}>{s.insight}</p>
            </div>
          )}

          {/* Match reason */}
          {candidate.match_reason && (
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
              <div style={{ fontSize: 10, ...mono, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-3)', marginBottom: 6 }}>Screening Verdict</div>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--text-2)', lineHeight: 1.7 }}>{candidate.match_reason}</p>
            </div>
          )}

          {/* Strengths & Flags */}
          {(s.strengths?.length > 0 || s.flags?.length > 0) && (
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              {s.strengths?.length > 0 && (
                <div>
                  <div style={{ fontSize: 10, ...mono, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-3)', marginBottom: 8 }}>Strengths</div>
                  {s.strengths.map((str, i) => (
                    <div key={i} style={{ fontSize: 12, color: 'var(--green)', marginBottom: 5, display: 'flex', gap: 6 }}>
                      <span>✓</span><span style={{ color: 'var(--text-2)' }}>{str}</span>
                    </div>
                  ))}
                </div>
              )}
              {s.flags?.length > 0 && (
                <div>
                  <div style={{ fontSize: 10, ...mono, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-3)', marginBottom: 8 }}>Red Flags</div>
                  {s.flags.map((f, i) => (
                    <div key={i} style={{ fontSize: 12, marginBottom: 5, display: 'flex', gap: 6 }}>
                      <span style={{ color: 'var(--red)' }}>✗</span><span style={{ color: 'var(--text-2)' }}>{f}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Best answer */}
          {s.bestAnswer && (
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
              <div style={{ fontSize: 10, ...mono, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-3)', marginBottom: 8 }}>Best Answer</div>
              <blockquote style={{ margin: 0, paddingLeft: 12, borderLeft: '2px solid var(--accent)', fontSize: 13, color: 'var(--text-2)', lineHeight: 1.7, fontStyle: 'italic' }}>{s.bestAnswer}</blockquote>
            </div>
          )}

          {/* Skills */}
          {candidate.skills?.length > 0 && (
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
              <div style={{ fontSize: 10, ...mono, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-3)', marginBottom: 8 }}>Skills</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {candidate.skills.map(sk => (
                  <span key={sk} style={{ fontSize: 11, ...mono, padding: '2px 8px', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text-2)' }}>{sk}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Bar({ value, max = 100 }) {
  return (
    <div style={{ height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden', marginTop: 3 }}>
      <div style={{ height: '100%', width: `${(value / max) * 100}%`, background: dimColor(value), borderRadius: 2, transition: 'width 0.4s ease' }} />
    </div>
  )
}

export default function RecruiterReports() {
  const { user } = useAuth()
  const location = useLocation()
  const [jobs, setJobs] = useState([])
  const [candidates, setCandidates] = useState([])
  const [pending, setPending] = useState([])
  const [selectedJobId, setSelectedJobId] = useState('all')
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState('ranked') // 'ranked' | 'comparison'
  const [detailCandidate, setDetailCandidate] = useState(null)

  useEffect(() => { if (user) load() }, [user, location.key])

  async function load() {
    setLoading(true)
    try { // fix: wrap in try/finally so setLoading(false) always fires on query error
    const { data: rcData } = await supabase
      .from('recruiter_clients')
      .select('client_id')
      .eq('recruiter_id', user.id)
    const clientIds = (rcData ?? []).map(r => r.client_id)
    if (!clientIds.length) { return }

    const { data: jobData } = await supabase.from('jobs').select('id, title, status').in('recruiter_id', clientIds).order('created_at', { ascending: false })
    const ids = (jobData ?? []).map(j => j.id)
    setJobs(jobData ?? [])
    if (!ids.length) { return }

    const [
      { data: interviewed },
      { data: awaiting },
      { data: matchInterviewed },
      { data: matchAwaiting },
    ] = await Promise.all([
      supabase.from('candidates').select('*').in('job_id', ids).not('scores', 'is', null).order('match_score', { ascending: false }).limit(500),
      supabase.from('candidates').select('*').in('job_id', ids).eq('match_pass', true).is('scores', null).limit(500),
      supabase.from('job_matches').select('*, talent_pool(full_name, candidate_role)').in('job_id', ids).not('scores', 'is', null),
      supabase.from('job_matches').select('id, job_id, match_score, match_pass, scores, talent_pool(full_name, candidate_role, skills, education, summary, match_reason)').in('job_id', ids).eq('match_pass', true).is('scores', null),
    ])

    const flatMatch = (rows) => (rows ?? []).map(m => ({
      ...m,
      full_name:      m.talent_pool?.full_name ?? '',
      candidate_role: m.talent_pool?.candidate_role ?? '',
    }))

    setCandidates([...(interviewed ?? []), ...flatMatch(matchInterviewed)])
    setPending([...(awaiting ?? []), ...flatMatch(matchAwaiting)])
    } finally {
      setLoading(false) // fix: always clear loading even when queries fail
    }
  }

  const filtered  = selectedJobId === 'all' ? candidates : candidates.filter(c => c.job_id === selectedJobId)
  const filteredPending = selectedJobId === 'all' ? pending : pending.filter(c => c.job_id === selectedJobId)
  const sorted    = [...filtered].sort((a, b) => (b.scores?.overallScore ?? 0) - (a.scores?.overallScore ?? 0))
  const hires     = sorted.filter(c => ['Strong Hire','Hire'].includes(c.scores?.recommendation))
  const others    = sorted.filter(c => !['Strong Hire','Hire'].includes(c.scores?.recommendation))

  if (loading) return <div className="page"><span className="spinner" /></div>

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>Reports</h2>
          <p>Interview results, rankings and comparison</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }} className="no-print">
          <select value={selectedJobId} onChange={e => setSelectedJobId(e.target.value)} style={{ width: 220 }}>
            <option value="all">All Jobs</option>
            {jobs.map(j => <option key={j.id} value={j.id}>{j.title}</option>)}
          </select>
          <button className="btn btn-secondary" onClick={load} disabled={loading}>
            {loading ? <span className="spinner" style={{ width: 11, height: 11 }} /> : '↻ Refresh'}
          </button>
          <button className="btn btn-secondary" onClick={() => window.print()}>Print</button>
        </div>
      </div>

      {/* Summary metrics */}
      <div className="metrics-row">
        <div className="metric-card blue">
          <span className="metric-val">{filtered.length}</span>
          <span className="metric-label">Interviewed</span>
        </div>
        <div className="metric-card green">
          <span className="metric-val">{filtered.filter(c => c.scores?.recommendation === 'Strong Hire').length}</span>
          <span className="metric-label">Strong Hire</span>
        </div>
        <div className="metric-card">
          <span className="metric-val">{hires.length}</span>
          <span className="metric-label">Hire+</span>
        </div>
        <div className="metric-card amber">
          <span className="metric-val">{filteredPending.length}</span>
          <span className="metric-label">Yet to Interview</span>
        </div>
      </div>

      {/* Awaiting interview */}
      {filteredPending.length > 0 && (
        <div className="section-card" style={{ marginBottom: 20 }}>
          <div className="section-card-head">
            <h3>Awaiting Interview</h3>
            <span className="badge badge-amber">{filteredPending.length} pending</span>
          </div>
          {filteredPending.map(c => (
            <div key={c.id} className="table-row" style={{ cursor: 'pointer' }} onClick={() => setDetailCandidate(c)}>
              <div className="col-main">
                <div className="col-name" style={{ color: 'var(--accent)' }}>{c.full_name}</div>
                <div className="col-sub">{c.candidate_role}</div>
              </div>
              <div className="col-right">
                {c.match_score != null && (
                  <span className="mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>Screen {c.match_score}</span>
                )}
                <span className="badge badge-amber">Not yet interviewed</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="section-card"><div className="empty-state">No interview results yet</div></div>
      ) : (
        <>
          {/* View toggle */}
          <div style={{ display: 'flex', gap: 2, marginBottom: 16 }} className="no-print">
            {[['ranked','Ranked List'], ['comparison','Side-by-Side Comparison']].map(([v, label]) => (
              <button key={v} onClick={() => setView(v)} className={`btn ${view === v ? 'btn-primary' : 'btn-secondary'}`}
                style={{ fontSize: 11, padding: '6px 14px' }}>
                {label}
              </button>
            ))}
          </div>

          {/* ── RANKED VIEW ── */}
          {view === 'ranked' && (
            <>
              {/* Recommended hires */}
              {hires.length > 0 && (
                <div className="section-card" style={{ marginBottom: 16 }}>
                  <div className="section-card-head">
                    <h3>Recommended — Best to Worst</h3>
                    <span className="badge badge-green">{hires.length} hire{hires.length !== 1 ? 's' : ''}</span>
                  </div>
                  <div>
                    <div style={{ display: 'grid', gridTemplateColumns: '28px 1fr 80px 80px 80px 80px 80px 80px 120px', gap: 8, padding: '8px 20px', background: 'var(--surface2)', fontFamily: 'var(--font-mono)', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-3)' }}>
                      <div>#</div><div>Candidate</div>
                      {DIMS.map(([,l]) => <div key={l} style={{ textAlign: 'right' }}>{l}</div>)}
                      <div style={{ textAlign: 'right' }}>Overall</div>
                      <div>Verdict</div>
                    </div>
                    {hires.map((c, i) => {
                      const s = c.scores ?? {}
                      return (
                        <div key={c.id} style={{ display: 'grid', gridTemplateColumns: '28px 1fr 80px 80px 80px 80px 80px 80px 120px', gap: 8, padding: '12px 20px', borderBottom: '1px solid var(--border)', alignItems: 'center', background: i === 0 ? 'rgba(45,125,78,0.03)' : 'transparent' }}>
                          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: i === 0 ? 'var(--green)' : 'var(--text-3)', fontWeight: i === 0 ? 700 : 400 }}>#{i + 1}</div>
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--accent)', cursor: 'pointer', textDecoration: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: 3 }} onClick={() => setDetailCandidate(c)}>{c.full_name}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 1 }}>{c.candidate_role}</div>
                          </div>
                          {DIMS.map(([key]) => (
                            <div key={key} style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600, color: s[key] != null ? dimColor(s[key]) : 'var(--text-3)' }}>
                              {s[key] ?? '—'}
                            </div>
                          ))}
                          <div style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 700, color: s.overallScore != null ? dimColor(s.overallScore) : 'var(--text-3)' }}>
                            {s.overallScore ?? '—'}
                          </div>
                          <div>
                            <span style={{ fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-mono)', color: REC_COLOR[s.recommendation] ?? 'var(--text-3)', background: REC_BG[s.recommendation] ?? 'transparent', padding: '2px 7px', borderRadius: 'var(--r)' }}>
                              {s.recommendation ?? '—'}
                            </span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Others */}
              {others.length > 0 && (
                <div className="section-card">
                  <div className="section-card-head">
                    <h3>Not Recommended</h3>
                    <span className="badge badge-red">{others.length}</span>
                  </div>
                  <div>
                    <div style={{ display: 'grid', gridTemplateColumns: '28px 1fr 80px 80px 80px 80px 80px 80px 120px', gap: 8, padding: '8px 20px', background: 'var(--surface2)', fontFamily: 'var(--font-mono)', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-3)' }}>
                      <div>#</div><div>Candidate</div>
                      {DIMS.map(([,l]) => <div key={l} style={{ textAlign: 'right' }}>{l}</div>)}
                      <div style={{ textAlign: 'right' }}>Overall</div>
                      <div>Verdict</div>
                    </div>
                    {others.map((c, i) => {
                      const s = c.scores ?? {}
                      return (
                        <div key={c.id} style={{ display: 'grid', gridTemplateColumns: '28px 1fr 80px 80px 80px 80px 80px 80px 120px', gap: 8, padding: '12px 20px', borderBottom: '1px solid var(--border)', alignItems: 'center', opacity: 0.7 }}>
                          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-3)' }}>#{hires.length + i + 1}</div>
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--accent)', cursor: 'pointer', textDecoration: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: 3 }} onClick={() => setDetailCandidate(c)}>{c.full_name}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 1 }}>{c.candidate_role}</div>
                          </div>
                          {DIMS.map(([key]) => (
                            <div key={key} style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600, color: s[key] != null ? dimColor(s[key]) : 'var(--text-3)' }}>
                              {s[key] ?? '—'}
                            </div>
                          ))}
                          <div style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 700, color: s.overallScore != null ? dimColor(s.overallScore) : 'var(--text-3)' }}>
                            {s.overallScore ?? '—'}
                          </div>
                          <div>
                            <span style={{ fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-mono)', color: REC_COLOR[s.recommendation] ?? 'var(--text-3)', background: REC_BG[s.recommendation] ?? 'transparent', padding: '2px 7px', borderRadius: 'var(--r)' }}>
                              {s.recommendation ?? '—'}
                            </span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </>
          )}

          {/* ── COMPARISON VIEW ── */}
          {view === 'comparison' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
              {sorted.map((c, i) => {
                const s = c.scores ?? {}
                const rec = s.recommendation
                return (
                  <div key={c.id} style={{ background: 'var(--surface)', border: `1px solid ${i === 0 ? 'var(--accent)' : 'var(--border)'}`, borderTop: `3px solid ${REC_COLOR[rec] ?? 'var(--border)'}`, borderRadius: 'var(--r)', padding: 18, position: 'relative' }}>
                    {/* Rank badge */}
                    <div style={{ position: 'absolute', top: 14, right: 14, width: 24, height: 24, borderRadius: '50%', background: i === 0 ? 'var(--accent)' : 'var(--surface2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, color: i === 0 ? '#fff' : 'var(--text-3)' }}>
                      {i + 1}
                    </div>

                    {/* Name */}
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--accent)', marginBottom: 2, paddingRight: 30, cursor: 'pointer', textDecoration: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: 3 }} onClick={() => setDetailCandidate(c)}>{c.full_name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 300 }}>{c.candidate_role}</div>
                    </div>

                    {/* Overall score */}
                    {s.overallScore != null && (
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginBottom: 14 }}>
                        <span style={{ fontFamily: 'var(--font-head)', fontSize: 36, fontWeight: 300, color: dimColor(s.overallScore), lineHeight: 1 }}>{s.overallScore}</span>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-3)' }}>/100</span>
                      </div>
                    )}

                    {/* Verdict */}
                    {rec && (
                      <div style={{ marginBottom: 14 }}>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: REC_COLOR[rec], background: REC_BG[rec], padding: '3px 8px', borderRadius: 'var(--r)' }}>
                          {rec}
                        </span>
                      </div>
                    )}

                    {/* Dimension bars */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {DIMS.map(([key, label]) => (
                        <div key={key}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-3)' }}>{label}</span>
                            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600, color: s[key] != null ? dimColor(s[key]) : 'var(--text-3)' }}>{s[key] ?? '—'}</span>
                          </div>
                          {s[key] != null && <Bar value={s[key]} />}
                        </div>
                      ))}
                    </div>

                    {/* AI insight snippet */}
                    {s.insight && (
                      <p style={{ marginTop: 14, fontSize: 11, color: 'var(--text-3)', lineHeight: 1.6, fontWeight: 300, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                        {s.insight.slice(0, 120)}{s.insight.length > 120 ? '…' : ''}
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {detailCandidate && <CandidateDetailModal candidate={detailCandidate} onClose={() => setDetailCandidate(null)} />}
    </div>
  )
}
