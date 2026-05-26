import { useState, useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'
import { usePlan } from '../../hooks/usePlan'
import { downloadCsv, candidateRows } from '../../utils/exportCsv'
import { logAudit } from '../../utils/audit'

const REC_COLOR = { 'Strong Hire': 'var(--green)', 'Hire': 'var(--accent)', 'Borderline': 'var(--amber)', 'Reject': 'var(--red)' }

function ProfileLinks({ c }) {
  const links = [
    c.linkedin_url  && { href: c.linkedin_url,  label: 'LinkedIn' },
    c.github_url    && { href: c.github_url,     label: 'GitHub' },
    c.portfolio_url && { href: c.portfolio_url,  label: 'Portfolio' },
  ].filter(Boolean)
  if (!links.length) return null
  return (
    <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
      {links.map(({ href, label }) => (
        <a key={label} href={href} target="_blank" rel="noopener noreferrer"
          style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--accent)', textDecoration: 'none', padding: '2px 8px', border: '1px solid var(--accent)', opacity: 0.8 }}>
          ↗ {label}
        </a>
      ))}
    </div>
  )
}
const DIMS = [
  ['technicalAbility','Technical Ability'],
  ['communication','Communication'],
  ['roleFit','Role Fit'],
  ['problemSolving','Problem Solving'],
  ['experienceRelevance','Experience Relevance'],
]
const INTERVIEW_COMPLETE = 'INTERVIEW_COMPLETE'
const TABS = ['All', 'Interview Pending', 'Interview Done', 'Screened Out']

function dimColor(v) { return v >= 70 ? 'var(--green)' : v >= 50 ? 'var(--accent)' : 'var(--red)' }

function ScoreRing({ score, size = 72 }) {
  const r = size / 2 - 6, circ = 2 * Math.PI * r, fill = (score / 100) * circ, color = dimColor(score)
  return (
    <div className="score-ring">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--border2)" strokeWidth="5"/>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth="5"
          strokeDasharray={`${fill} ${circ}`} strokeLinecap="round" transform={`rotate(-90 ${size/2} ${size/2})`}/>
      </svg>
      <div className="ring-inner"><span className="ring-val-lg">{score}</span></div>
    </div>
  )
}

function VideoModal({ candidate, onClose }) {
  const [activeIdx, setActiveIdx] = useState(0)
  const videoRef = useRef(null)
  const { full_name, video_urls = [], scores, interview_transcript = [] } = candidate
  const s = scores ?? {}
  const rec = s.recommendation
  const mono = { fontFamily: 'var(--font-mono)' }

  useEffect(() => {
    if (videoRef.current && video_urls[activeIdx]?.url) {
      videoRef.current.load()
      videoRef.current.play().catch(() => {})
    }
  }, [activeIdx])

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, padding: 20 }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{ background: '#F8F7F4', width: '100%', maxWidth: 860, maxHeight: '90vh', overflow: 'auto', display: 'flex', flexDirection: 'column', border: '1px solid #E8E4DC' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 28px', borderBottom: '1px solid #E8E4DC', flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 10, ...mono, textTransform: 'uppercase', letterSpacing: '0.12em', color: '#9CA3AF', marginBottom: 4 }}>Video Interview</div>
            <div style={{ fontSize: 18, fontFamily: 'Georgia, serif', fontWeight: 400, color: '#2D3748' }}>{full_name}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            {s.overallScore != null && (
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 24, fontWeight: 700, color: REC_COLOR[rec] ?? '#B8924A' }}>{s.overallScore}</div>
                {rec && <div style={{ fontSize: 11, ...mono, textTransform: 'uppercase', letterSpacing: '0.05em', color: REC_COLOR[rec] ?? '#9CA3AF' }}>{rec}</div>}
              </div>
            )}
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: '#9CA3AF', padding: '4px 8px', lineHeight: 1 }}>✕</button>
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* Video player */}
          <div>
            <div style={{ background: '#000', overflow: 'hidden', aspectRatio: '16/9' }}>
              {video_urls[activeIdx]?.url
                ? <video ref={videoRef} controls style={{ width: '100%', height: '100%', objectFit: 'contain' }} src={video_urls[activeIdx].url} />
                : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.3)', fontSize: 13 }}>No recording for this question</div>
              }
            </div>
            {video_urls[activeIdx]?.q && (
              <div style={{ padding: '10px 14px', background: 'white', border: '1px solid #E8E4DC', borderLeft: '3px solid #B8924A', marginTop: 10 }}>
                <div style={{ fontSize: 10, ...mono, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#9CA3AF', marginBottom: 4 }}>Question {activeIdx + 1}</div>
                <div style={{ fontSize: 13, color: '#4A5568', lineHeight: 1.6 }}>{video_urls[activeIdx].q}</div>
              </div>
            )}
            {video_urls.length > 1 && (
              <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                {video_urls.map((v, i) => (
                  <button key={i} onClick={() => setActiveIdx(i)} style={{
                    padding: '5px 14px', border: `1px solid ${i === activeIdx ? '#B8924A' : '#E8E4DC'}`,
                    background: i === activeIdx ? 'rgba(184,146,74,0.08)' : 'white',
                    color: i === activeIdx ? '#B8924A' : '#9CA3AF',
                    cursor: 'pointer', fontSize: 12, fontFamily: 'var(--font-mono)',
                  }}>
                    Q{i + 1}{!v.url ? ' ⚠' : ''}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* AI score dimensions */}
          {s.overallScore != null && (
            <div style={{ background: 'white', border: '1px solid #E8E4DC', padding: '20px 24px' }}>
              <div style={{ fontSize: 10, ...mono, textTransform: 'uppercase', letterSpacing: '0.12em', color: '#9CA3AF', marginBottom: 16 }}>AI Assessment</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 16, marginBottom: s.insight ? 16 : 0 }}>
                {DIMS.map(([key, label]) => (
                  <div key={key}>
                    <div style={{ fontSize: 11, color: '#9CA3AF', fontFamily: 'var(--font-mono)', marginBottom: 5 }}>{label}</div>
                    <div style={{ height: 3, background: '#E8E4DC', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${s[key] ?? 0}%`, background: dimColor(s[key] ?? 0), transition: 'width 0.4s' }} />
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: dimColor(s[key] ?? 0), marginTop: 4 }}>{s[key] ?? '—'}</div>
                  </div>
                ))}
              </div>
              {s.insight && (
                <p style={{ fontSize: 13, color: '#6B7280', lineHeight: 1.7, margin: 0, paddingTop: 16, borderTop: '1px solid #E8E4DC', fontStyle: 'italic' }}>
                  {s.insight}
                </p>
              )}
            </div>
          )}

          {/* Transcript */}
          {interview_transcript.length > 0 && (
            <div style={{ background: 'white', border: '1px solid #E8E4DC', padding: '20px 24px' }}>
              <div style={{ fontSize: 10, ...mono, textTransform: 'uppercase', letterSpacing: '0.12em', color: '#9CA3AF', marginBottom: 16 }}>Interview Transcript</div>
              <div className="transcript-wrap">
                {interview_transcript.map((msg, i) => (
                  <div key={i} className={`bubble ${msg.role}`}>
                    <div className="bubble-who">{msg.role === 'assistant' ? 'Interviewer' : 'Candidate'}</div>
                    <div className="bubble-body">{msg.content?.replace(INTERVIEW_COMPLETE, '').trim()}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function CVModal({ candidate, onClose }) {
  const { full_name, raw_text } = candidate
  const text = (raw_text ?? '').trim()

  function download() {
    const blob = new Blob([text || `${full_name}\n\nNo CV text available.`], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${full_name.replace(/\s+/g, '_')}_CV.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2100, padding: 20 }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{ background: '#F8F7F4', width: '100%', maxWidth: 760, maxHeight: '88vh', display: 'flex', flexDirection: 'column', border: '1px solid #E8E4DC' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 24px', borderBottom: '1px solid #E8E4DC', flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.12em', color: '#9CA3AF', marginBottom: 3 }}>CV / Resume</div>
            <div style={{ fontSize: 17, fontFamily: 'Georgia, serif', fontWeight: 400, color: '#2D3748' }}>{full_name}</div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              onClick={download}
              style={{ padding: '6px 14px', border: '1px solid #B8924A', background: 'rgba(184,146,74,0.08)', color: '#B8924A', cursor: 'pointer', fontSize: 12, fontFamily: 'var(--font-mono)' }}
            >
              ↓ Download .txt
            </button>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: '#9CA3AF', padding: '4px 8px', lineHeight: 1 }}>✕</button>
          </div>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: '24px' }}>
          {text
            ? <pre style={{ margin: 0, fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.75, color: '#4A5568', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{text}</pre>
            : <div style={{ textAlign: 'center', padding: '40px 0', color: '#9CA3AF', fontFamily: 'var(--font-mono)', fontSize: 13 }}>No CV text available for this candidate.</div>
          }
        </div>
      </div>
    </div>
  )
}

function CandidateProfile({ candidate, onBack, onWatch, onViewCV, onOffer, onDeclineOffer, onReopenOffer }) {
  const s = candidate.scores ?? {}
  const transcript = candidate.interview_transcript ?? []
  const rec = s.recommendation
  const hasVideo = candidate.video_urls?.length > 0
  const hasCV = !!(candidate.raw_text ?? '').trim()
  const canOffer = candidate.match_pass === true && candidate.offer_status !== 'sent' && candidate.offer_status !== 'rejected' && candidate.final_decision !== 'hired'
  const offerDone = candidate.offer_status === 'sent' || candidate.final_decision === 'hired'
  const offerRejected = candidate.offer_status === 'rejected'

  return (
    <div>
      <div className="no-print" style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
        <button className="btn btn-secondary" onClick={onBack}>← Back to list</button>
        {hasCV && (
          <button className="btn btn-secondary" onClick={onViewCV}>
            CV
          </button>
        )}
        {hasVideo && (
          <button
            className="btn btn-primary"
            onClick={onWatch}
            style={{ background: '#B8924A', borderColor: '#B8924A' }}
          >
            ▶ Watch Interview
          </button>
        )}
        {offerDone && (
          <>
            <span className="badge badge-green" style={{ fontSize: 12 }}>Offer Sent</span>
            <button className="btn btn-secondary" style={{ fontSize: 11, padding: '4px 10px', color: 'var(--red)', borderColor: 'var(--red)' }} onClick={onDeclineOffer}>
              Candidate Declined
            </button>
          </>
        )}
        {offerRejected && (
          <>
            <span className="badge badge-red" style={{ fontSize: 12 }}>Offer Declined</span>
            <button className="btn btn-secondary" style={{ fontSize: 11, padding: '4px 10px' }} onClick={onReopenOffer}>
              Re-open
            </button>
          </>
        )}
        {canOffer && (
          <button className="btn btn-primary" style={{ background: 'var(--green)', borderColor: 'var(--green)', marginLeft: 'auto' }} onClick={onOffer}>
            Make Offer
          </button>
        )}
      </div>

      <div className="profile-hero">
        <div className="profile-avatar">{(candidate.full_name ?? '?')[0].toUpperCase()}</div>
        <div className="profile-id" style={{ flex: 1 }}>
          <h3>{candidate.full_name}</h3>
          <p>{candidate.candidate_role} · {candidate.total_years}y exp</p>
          <ProfileLinks c={candidate} />
          {candidate.match_score != null && (
            <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <span className={`badge ${candidate.match_pass ? 'badge-green' : 'badge-red'}`}>
                Screen {candidate.match_score}/100
              </span>
            </div>
          )}
        </div>
        {s.overallScore != null && (
          <div style={{ textAlign: 'center', flexShrink: 0 }}>
            <ScoreRing score={s.overallScore} size={72} />
            {rec && (
              <div style={{ marginTop: 6, fontSize: 10, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.05em', color: REC_COLOR[rec] ?? 'var(--text-3)' }}>
                {rec}
              </div>
            )}
          </div>
        )}
      </div>

      {candidate.match_reason && (
        <div style={{ marginBottom: 16, padding: '12px 16px', background: 'var(--surface)', border: '1px solid var(--border)', borderLeft: `2px solid ${candidate.match_pass ? 'var(--green)' : 'var(--red)'}`, fontSize: 13, color: 'var(--text-2)', fontWeight: 300 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>Screening verdict</span>
          {candidate.match_reason}
        </div>
      )}

      {s.overallScore == null && candidate.match_pass && (
        <div style={{ padding: '32px 24px', textAlign: 'center', background: 'var(--surface)', border: '1px solid var(--border)', marginBottom: 16 }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--text-3)', marginBottom: 8 }}>Interview Status</div>
          <div style={{ fontSize: 15, color: 'var(--amber)', fontFamily: 'var(--font-mono)' }}>
            {hasVideo ? 'Video Submitted — Awaiting Score' : 'Interview Pending'}
          </div>
          {!hasVideo && <div style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 6, fontWeight: 300 }}>This candidate passed screening and has been invited to complete their video interview.</div>}
        </div>
      )}

      {s.overallScore != null && (
        <div className="profile-grid">
          <div className="profile-section">
            <h4>Dimension Scores</h4>
            {DIMS.map(([key, label]) => (
              <div key={key} className="score-dim">
                <span className="dim-label">{label}</span>
                <div className="dim-track"><div className="dim-fill" style={{ width: `${s[key] ?? 0}%`, background: dimColor(s[key] ?? 0) }} /></div>
                <span className="dim-val">{s[key] ?? '—'}</span>
              </div>
            ))}
          </div>

          <div className="profile-section">
            {s.insight && (
              <>
                <h4>AI Insight</h4>
                <p className="insight-text">{s.insight}</p>
              </>
            )}
            {s.strengths?.length > 0 && (
              <>
                <h4 style={{ marginTop: 16 }}>Strengths</h4>
                <ul className="strength-list">
                  {s.strengths.map((str, i) => <li key={i}><span className="dot-green" />{str}</li>)}
                </ul>
              </>
            )}
            {s.flags?.length > 0 && (
              <>
                <h4 style={{ marginTop: 16 }}>Red Flags</h4>
                <ul className="flag-list">
                  {s.flags.map((f, i) => <li key={i}><span className="dot-red" />{f}</li>)}
                </ul>
              </>
            )}
          </div>

          {s.bestAnswer && (
            <div className="profile-section full">
              <h4>Best Answer</h4>
              <blockquote className="best-answer">{s.bestAnswer}</blockquote>
            </div>
          )}

          {transcript.length > 0 && (
            <div className="profile-section full">
              <h4>Interview Transcript</h4>
              <div className="transcript-wrap">
                {transcript.map((msg, i) => (
                  <div key={i} className={`bubble ${msg.role}`}>
                    <div className="bubble-who">{msg.role === 'assistant' ? 'Interviewer' : 'Candidate'}</div>
                    <div className="bubble-body">{msg.content.replace(INTERVIEW_COMPLETE, '').trim()}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function ClientCandidates() {
  const { user, effectiveClientId, isStakeholder } = useAuth()
  const { isTrial } = usePlan()
  const location = useLocation()
  const [jobs, setJobs] = useState([])
  const [candidates, setCandidates] = useState([])
  const [loading, setLoading] = useState(true)
  const [jobFilter, setJobFilter] = useState('all')
  const [tab, setTab] = useState('All')
  const [selectedId, setSelectedId] = useState(null)
  const [watchId, setWatchId] = useState(null)
  const [cvId, setCvId] = useState(null)
  const [showDismissed, setShowDismissed] = useState(false)
  const [confirmRemoveId, setConfirmRemoveId] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [offerModal, setOfferModal] = useState(null)
  const [clientNoteDraft, setClientNoteDraft] = useState({}) // id → text
  const [compareIds, setCompareIds] = useState([])
  const [showCompare, setShowCompare] = useState(false)
  const [approvePrompt, setApprovePrompt] = useState(null)
  const jobIdsRef    = useRef([])
  const channelRef   = useRef(null)

  function subscribeToJobs(ids) {
    if (channelRef.current) supabase.removeChannel(channelRef.current)
    if (!ids.length) return
    const filter = `job_id=in.(${ids.join(',')})`
    channelRef.current = supabase
      .channel('client-candidates-live')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'candidates', filter }, ({ new: row }) => {
        setCandidates(prev => prev.map(c => c.id === row.id ? { ...c, ...row } : c))
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'candidates', filter }, ({ new: row }) => {
        setCandidates(prev => prev.some(c => c.id === row.id) ? prev : [...prev, row])
      })
      .subscribe()
  }

  useEffect(() => {
    if (!user) return
    load()
    return () => { if (channelRef.current) supabase.removeChannel(channelRef.current) }
  }, [user])

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const t = params.get('tab')
    if (t && TABS.includes(t)) setTab(t)
  }, [location.search])

  async function load() {
    try { // fix: wrap in try/finally so setLoading(false) always fires on query error
    const { data: jobData } = await supabase.from('jobs').select('id, title').eq('recruiter_id', effectiveClientId)
    const ids = (jobData ?? []).map(j => j.id)
    jobIdsRef.current = ids
    setJobs(jobData ?? [])
    subscribeToJobs(ids)
    if (!ids.length) { return }

    const { data: cData } = await supabase
      .from('candidates')
      .select('*')
      .in('job_id', ids)
      .not('match_pass', 'is', null)   // only show screened candidates to clients
      .order('match_score', { ascending: false, nullsFirst: false })

    setCandidates(cData ?? [])
    } finally {
      setLoading(false) // fix: always clear loading even when queries fail
    }
  }

  async function dismissCandidate(id) {
    await supabase.from('candidates').update({ client_dismissed: true }).eq('id', id)
    setCandidates(prev => prev.map(c => c.id === id ? { ...c, client_dismissed: true } : c))
    setConfirmRemoveId(null)
    if (selectedId === id) setSelectedId(null)
  }

  async function restoreCandidate(id) {
    await supabase.from('candidates').update({ client_dismissed: false }).eq('id', id)
    setCandidates(prev => prev.map(c => c.id === id ? { ...c, client_dismissed: false } : c))
  }

  async function approveCandidate(id, reason) {
    const c = candidates.find(x => x.id === id)
    const updates = { client_approved: true }
    if (reason?.trim()) {
      const existing = (c?.client_notes ?? '').trim()
      updates.client_notes = existing ? `${existing}\n✓ Approved: ${reason.trim()}` : `✓ Approved: ${reason.trim()}`
    }
    await supabase.from('candidates').update(updates).eq('id', id)
    setCandidates(prev => prev.map(x => x.id === id ? { ...x, ...updates } : x))
    logAudit(supabase, { actorId: user?.id, actorRole: 'client', action: 'client_approved', entityType: 'candidate', entityId: id, jobId: c?.job_id, metadata: { candidate_name: c?.full_name, reason: reason?.trim() || null } })
    setApprovePrompt(null)
  }

  async function rejectCandidate(id, reason) {
    const c = candidates.find(x => x.id === id)
    const updates = { client_approved: false }
    if (reason?.trim()) {
      const existing = (c?.client_notes ?? '').trim()
      updates.client_notes = existing ? `${existing}\n✕ Rejected: ${reason.trim()}` : `✕ Rejected: ${reason.trim()}`
    }
    await supabase.from('candidates').update(updates).eq('id', id)
    setCandidates(prev => prev.map(x => x.id === id ? { ...x, ...updates } : x))
    logAudit(supabase, { actorId: user?.id, actorRole: 'client', action: 'client_rejected', entityType: 'candidate', entityId: id, jobId: c?.job_id, metadata: { candidate_name: c?.full_name, reason: reason?.trim() || null } })
    setApprovePrompt(null)
  }

  async function saveClientNote(id, text) {
    await supabase.from('candidates').update({ client_notes: text.trim() || null }).eq('id', id)
    setCandidates(prev => prev.map(c => c.id === id ? { ...c, client_notes: text.trim() || null } : c))
  }

  async function sendOffer() {
    const { candidate, note } = offerModal
    setOfferModal(m => ({ ...m, sending: true, error: null }))
    const { error } = await supabase.from('candidates')
      .update({ offer_status: 'sent', decision_notes: note || null, final_decision: 'hired' })
      .eq('id', candidate.id)
    if (error) {
      setOfferModal(m => ({ ...m, sending: false, error: error.message }))
    } else {
      setCandidates(prev => prev.map(c => c.id === candidate.id ? { ...c, offer_status: 'sent', final_decision: 'hired' } : c))
      setOfferModal(null)
    }
  }

  async function declineOffer(id) {
    await supabase.from('candidates').update({ offer_status: 'rejected', final_decision: null }).eq('id', id)
    setCandidates(prev => prev.map(c => c.id === id ? { ...c, offer_status: 'rejected', final_decision: null } : c))
  }

  async function reopenOffer(id) {
    await supabase.from('candidates').update({ offer_status: null, final_decision: null }).eq('id', id)
    setCandidates(prev => prev.map(c => c.id === id ? { ...c, offer_status: null, final_decision: null } : c))
  }

  function slaDays(c) {
    if (c.match_pass !== true || c.client_approved != null) return null
    return Math.floor((Date.now() - new Date(c.created_at)) / 86400000)
  }

  function getStatus(c) {
    if (c.scores?.overallScore != null) return 'Interview Done'
    if (c.match_pass === true) return 'Interview Pending'
    if (c.match_pass === false) return 'Screened Out'
    return 'Pending'
  }

  const byJob = jobFilter === 'all' ? candidates : candidates.filter(c => c.job_id === jobFilter)
  const active    = byJob.filter(c => !c.client_dismissed)
  const dismissed = byJob.filter(c => c.client_dismissed)

  const searchActive = active.filter(c => {
    if (!searchQuery.trim()) return true
    const words = searchQuery.toLowerCase().split(/\s+/)
    const hay = [c.full_name, c.candidate_role, c.email, c.summary, ...(c.skills ?? [])].join(' ').toLowerCase()
    return words.every(w => hay.includes(w))
  })
  const tabFilteredAll = searchActive.filter(c => tab === 'All' || getStatus(c) === tab)
  const tabFiltered = tabFilteredAll
  const trialHidden = 0

  const counts = {
    'All': searchActive.length,
    'Interview Pending': searchActive.filter(c => getStatus(c) === 'Interview Pending').length,
    'Interview Done': searchActive.filter(c => getStatus(c) === 'Interview Done').length,
    'Screened Out': searchActive.filter(c => getStatus(c) === 'Screened Out').length,
  }

  const selected    = candidates.find(c => c.id === selectedId)
  const watching    = candidates.find(c => c.id === watchId)
  const cvCandidate = candidates.find(c => c.id === cvId)

  if (loading) return <div className="page"><span className="spinner" /></div>

  if (selected) {
    return (
      <div className="page">
        <CandidateProfile
          candidate={selected}
          onBack={() => setSelectedId(null)}
          onWatch={() => setWatchId(selected.id)}
          onViewCV={() => setCvId(selected.id)}
          onOffer={() => setOfferModal({ candidate: selected, note: '', sending: false, error: null })}
          onDeclineOffer={() => declineOffer(selected.id)}
          onReopenOffer={() => reopenOffer(selected.id)}
        />
        <div className="section-card" style={{ marginTop: 16 }}>
          <div className="section-card-head"><h3>Your Notes</h3></div>
          <div className="section-card-body">
            <textarea
              rows={4}
              style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'var(--font-body)', fontSize: 13, lineHeight: 1.6 }}
              placeholder="Add private notes — notice period, salary expectations, concerns, next steps…"
              value={clientNoteDraft[selected.id] ?? (selected.client_notes ?? '')}
              onChange={e => setClientNoteDraft(d => ({ ...d, [selected.id]: e.target.value }))}
              onBlur={() => {
                const text = clientNoteDraft[selected.id] ?? selected.client_notes ?? ''
                if (text !== (selected.client_notes ?? '')) saveClientNote(selected.id, text)
              }}
            />
            <div style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', marginTop: 6 }}>Saved automatically. Not visible to the candidate.</div>
          </div>
        </div>

        {!selected.client_dismissed && (
          confirmRemoveId === selected.id ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16, padding: '12px 16px', background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <span style={{ fontSize: 13, color: 'var(--text-2)' }}>Remove this candidate from your pipeline?</span>
              <button className="btn btn-secondary" style={{ fontSize: 12, color: 'var(--red)', borderColor: 'var(--red)' }} onClick={() => dismissCandidate(selected.id)}>Remove</button>
              <button className="btn btn-secondary" style={{ fontSize: 12 }} onClick={() => setConfirmRemoveId(null)}>Cancel</button>
            </div>
          ) : (
            <div style={{ marginTop: 16 }}>
              <button className="btn btn-secondary" style={{ fontSize: 12, color: 'var(--red)', borderColor: 'var(--red)' }} onClick={() => setConfirmRemoveId(selected.id)}>
                Remove Candidate
              </button>
            </div>
          )
        )}
        {selected.client_dismissed && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16, padding: '12px 16px', background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <span style={{ fontSize: 13, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>This candidate has been removed.</span>
            <button className="btn btn-secondary" style={{ fontSize: 12 }} onClick={() => restoreCandidate(selected.id)}>Restore</button>
          </div>
        )}
        {watching && <VideoModal candidate={watching} onClose={() => setWatchId(null)} />}
        {cvCandidate && <CVModal candidate={cvCandidate} onClose={() => setCvId(null)} />}
        {offerModal && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2200, padding: 20 }}
            onClick={e => { if (e.target === e.currentTarget) setOfferModal(null) }}>
            <div style={{ background: '#F8F7F4', width: '100%', maxWidth: 460, padding: 28, border: '1px solid #E8E4DC', display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.12em', color: '#9CA3AF', marginBottom: 4 }}>Make Offer</div>
                <div style={{ fontSize: 17, fontFamily: 'Georgia, serif', color: '#2D3748' }}>{offerModal.candidate.full_name}</div>
                <div style={{ fontSize: 13, color: '#9CA3AF', marginTop: 2 }}>{offerModal.candidate.candidate_role}</div>
              </div>
              <div>
                <label style={{ fontSize: 11, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#9CA3AF', display: 'block', marginBottom: 6 }}>
                  Note (optional)
                </label>
                <textarea
                  rows={3}
                  value={offerModal.note}
                  onChange={e => setOfferModal(m => ({ ...m, note: e.target.value }))}
                  placeholder="Any message or next steps for the recruiter…"
                  style={{ width: '100%', padding: '9px 12px', border: '1px solid #E8E4DC', background: 'white', fontSize: 13, resize: 'vertical', boxSizing: 'border-box', fontFamily: 'var(--font-body)' }}
                />
              </div>
              {offerModal.error && <div style={{ fontSize: 12, color: 'var(--red)' }}>{offerModal.error}</div>}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button className="btn btn-secondary" onClick={() => setOfferModal(null)}>Cancel</button>
                <button className="btn btn-primary" style={{ background: 'var(--green)', borderColor: 'var(--green)' }}
                  disabled={offerModal.sending} onClick={sendOffer}>
                  {offerModal.sending ? 'Sending…' : 'Confirm Offer'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>Candidates</h2>
          <p>{byJob.length} candidate{byJob.length !== 1 ? 's' : ''} total</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="search"
            placeholder="Search by name, role, skills…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            style={{ width: 220, padding: '7px 12px', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 12, fontFamily: 'var(--font-body)' }}
          />
          <select value={jobFilter} onChange={e => setJobFilter(e.target.value)} style={{ width: 200 }}>
            <option value="all">All Jobs</option>
            {jobs.map(j => <option key={j.id} value={j.id}>{j.title}</option>)}
          </select>
          {tabFiltered.length > 0 && (
            <button
              className="btn btn-secondary"
              style={{ fontSize: 12, padding: '6px 12px', whiteSpace: 'nowrap' }}
              onClick={() => {
                const jobTitle = jobFilter === 'all' ? '' : jobs.find(j => j.id === jobFilter)?.title ?? ''
                downloadCsv(`candidates-${jobTitle || 'all'}.csv`, candidateRows(tabFiltered, jobTitle))
              }}
            >↓ CSV</button>
          )}
          {compareIds.length === 0 ? (
            <button
              className="btn btn-secondary"
              style={{ fontSize: 12, padding: '6px 12px', whiteSpace: 'nowrap' }}
              title="Tick checkboxes to select candidates for comparison"
              onClick={() => {}}
            >⊞ Compare</button>
          ) : compareIds.length === 1 ? (
            <button
              className="btn btn-secondary"
              style={{ fontSize: 12, padding: '6px 12px', whiteSpace: 'nowrap', color: 'var(--accent)', borderColor: 'var(--accent)' }}
              onClick={() => setCompareIds([])}
            >1 selected — pick 1 more (×)</button>
          ) : (
            <button
              className="btn btn-primary"
              style={{ fontSize: 12, padding: '6px 12px', whiteSpace: 'nowrap' }}
              onClick={() => setShowCompare(true)}
            >⊞ Compare {compareIds.length}</button>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 2, marginBottom: 20, borderBottom: '1px solid var(--border)' }}>
        {TABS.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: '8px 16px', border: 'none', background: 'none', cursor: 'pointer',
              fontFamily: 'var(--font-mono)', fontSize: 11, textTransform: 'uppercase',
              letterSpacing: '0.08em', color: tab === t ? 'var(--accent)' : 'var(--text-3)',
              borderBottom: tab === t ? '2px solid var(--accent)' : '2px solid transparent',
              marginBottom: -1, transition: 'color 0.12s',
            }}
          >
            {t}
            {counts[t] != null && (
              <span style={{ marginLeft: 6, fontFamily: 'var(--font-mono)', fontSize: 10, color: tab === t ? 'var(--accent)' : 'var(--text-3)' }}>
                {counts[t]}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="section-card">
        {tabFiltered.length === 0 ? (
          <div className="empty-state">No candidates in this category</div>
        ) : (
          tabFiltered.map(c => {
            const s = c.scores
            const rec = s?.recommendation
            const status = getStatus(c)
            const hasVideo = c.video_urls?.length > 0
            const hasCV = !!(c.raw_text ?? '').trim()
            return (
              <div key={c.id} className="table-row clickable" onClick={() => setSelectedId(c.id)}>
                <div className="col-main">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <input
                      type="checkbox"
                      checked={compareIds.includes(c.id)}
                      onChange={e => {
                        e.stopPropagation()
                        setCompareIds(prev =>
                          prev.includes(c.id)
                            ? prev.filter(id => id !== c.id)
                            : prev.length < 4 ? [...prev, c.id] : prev
                        )
                      }}
                      onClick={e => e.stopPropagation()}
                      style={{ flexShrink: 0, width: 14, height: 14, accentColor: 'var(--accent)', cursor: 'pointer' }}
                      title="Select for comparison"
                    />
                    <div className="profile-avatar" style={{ width: 34, height: 34, fontSize: 14, borderRadius: 'var(--r)', flexShrink: 0 }}>
                      {(c.full_name ?? '?')[0].toUpperCase()}
                    </div>
                    <div>
                      <div className="col-name">{c.full_name}</div>
                      <div className="col-sub">{c.candidate_role} · {c.total_years}y exp</div>
                    </div>
                  </div>
                </div>
                <div className="col-right">
                  {c.match_score != null && (
                    <span className="mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>
                      Screen {c.match_score}
                    </span>
                  )}
                  {s?.overallScore != null && (
                    <span className="mono" style={{ fontSize: 13, fontWeight: 700, color: dimColor(s.overallScore) }}>
                      {s.overallScore}
                    </span>
                  )}
                  {rec && (
                    <span style={{ fontSize: 11, fontWeight: 600, color: REC_COLOR[rec], fontFamily: 'var(--font-mono)' }}>
                      {rec}
                    </span>
                  )}
                  {hasCV && (
                    <button
                      className="btn btn-secondary"
                      style={{ fontSize: 11, padding: '4px 10px' }}
                      onClick={e => { e.stopPropagation(); setCvId(c.id) }}
                    >
                      CV
                    </button>
                  )}
                  {hasVideo && (
                    <button
                      className="btn btn-secondary"
                      style={{ fontSize: 11, padding: '4px 10px', color: '#B8924A', borderColor: '#B8924A' }}
                      onClick={e => { e.stopPropagation(); setWatchId(c.id) }}
                    >
                      ▶ Watch
                    </button>
                  )}
                  {(() => { const d = slaDays(c); return d != null && d >= 1 ? (
                    <span title={`Awaiting your decision for ${d} day${d !== 1 ? 's' : ''}`}
                      style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: d >= 3 ? 'var(--red)' : 'var(--amber)', border: `1px solid ${d >= 3 ? 'var(--red)' : 'var(--amber)'}`, padding: '1px 5px' }}>
                      ⏱ {d}d
                    </span>
                  ) : null })()}
                  {c.match_pass === true && c.client_approved === null && !isStakeholder && (
                    approvePrompt?.id === c.id
                      ? (
                        <div onClick={e => e.stopPropagation()} style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                          <input
                            type="text"
                            placeholder="Reason (optional)…"
                            value={approvePrompt.reason}
                            autoFocus
                            onChange={e => setApprovePrompt(p => ({ ...p, reason: e.target.value }))}
                            onKeyDown={e => {
                              if (e.key === 'Enter') approvePrompt.action === 'approve' ? approveCandidate(c.id, approvePrompt.reason) : rejectCandidate(c.id, approvePrompt.reason)
                              if (e.key === 'Escape') setApprovePrompt(null)
                            }}
                            style={{ fontSize: 11, padding: '3px 7px', border: '1px solid var(--border)', fontFamily: 'var(--font-body)', width: 150 }}
                          />
                          <button className="btn btn-secondary"
                            style={{ fontSize: 11, padding: '3px 8px', color: approvePrompt.action === 'approve' ? 'var(--green)' : 'var(--red)', borderColor: approvePrompt.action === 'approve' ? 'var(--green)' : 'var(--red)' }}
                            onClick={e => { e.stopPropagation(); approvePrompt.action === 'approve' ? approveCandidate(c.id, approvePrompt.reason) : rejectCandidate(c.id, approvePrompt.reason) }}>
                            {approvePrompt.action === 'approve' ? '✓' : '✕'}
                          </button>
                          <button className="btn btn-secondary" style={{ fontSize: 11, padding: '3px 8px' }}
                            onClick={e => { e.stopPropagation(); setApprovePrompt(null) }}>×</button>
                        </div>
                      ) : (
                        <>
                          <button className="btn btn-secondary" style={{ fontSize: 11, padding: '4px 10px', color: 'var(--green)', borderColor: 'var(--green)' }}
                            onClick={e => { e.stopPropagation(); setApprovePrompt({ id: c.id, action: 'approve', reason: '' }) }}>✓ Approve</button>
                          <button className="btn btn-secondary" style={{ fontSize: 11, padding: '4px 10px', color: 'var(--red)', borderColor: 'var(--red)' }}
                            onClick={e => { e.stopPropagation(); setApprovePrompt({ id: c.id, action: 'reject', reason: '' }) }}>✕ Reject</button>
                        </>
                      )
                  )}
                  {c.client_approved === true  && <span className="badge badge-green" style={{ fontSize: 10 }}>Approved</span>}
                  {c.client_approved === false && <span className="badge badge-red"   style={{ fontSize: 10 }}>Rejected</span>}
                  {status === 'Interview Pending'  && !hasVideo && <span className="badge badge-amber">Interview Pending</span>}
                  {status === 'Screened Out'       && !s && <span className="badge badge-red">Screened Out</span>}
                  {status === 'Pending'            && <span className="badge" style={{ color: 'var(--text-3)', background: 'var(--surface2)' }}>Pending</span>}
                  {c.offer_status === 'rejected'
                    ? <span className="badge badge-red" style={{ fontSize: 11 }}>Offer Declined</span>
                    : c.offer_status === 'sent' || c.final_decision === 'hired'
                    ? <span className="badge badge-green" style={{ fontSize: 11 }}>Offer Sent</span>
                    : c.match_pass === true && (
                      <button className="btn btn-secondary" style={{ fontSize: 11, padding: '4px 10px', color: 'var(--green)', borderColor: 'var(--green)' }}
                        onClick={e => { e.stopPropagation(); setOfferModal({ candidate: c, note: '', sending: false, error: null }) }}>
                        Make Offer
                      </button>
                    )
                  }
                  {confirmRemoveId === c.id ? (
                    <>
                      <button className="btn btn-secondary" style={{ fontSize: 11, padding: '4px 10px', color: 'var(--red)', borderColor: 'var(--red)' }}
                        onClick={e => { e.stopPropagation(); dismissCandidate(c.id) }}>Confirm</button>
                      <button className="btn btn-secondary" style={{ fontSize: 11, padding: '4px 10px' }}
                        onClick={e => { e.stopPropagation(); setConfirmRemoveId(null) }}>Cancel</button>
                    </>
                  ) : (
                    <button className="btn btn-secondary" style={{ fontSize: 11, padding: '4px 10px', color: 'var(--text-3)' }}
                      onClick={e => { e.stopPropagation(); setConfirmRemoveId(c.id) }}>✕ Remove</button>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>

      {dismissed.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <button
            onClick={() => setShowDismissed(v => !v)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', padding: 0 }}
          >
            {showDismissed ? '▲' : '▼'} {dismissed.length} removed candidate{dismissed.length !== 1 ? 's' : ''}
          </button>
          {showDismissed && (
            <div className="section-card" style={{ marginTop: 8, opacity: 0.65 }}>
              {dismissed.map(c => (
                <div key={c.id} className="table-row" style={{ cursor: 'default' }}>
                  <div className="col-main">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div className="profile-avatar" style={{ width: 34, height: 34, fontSize: 14, borderRadius: 'var(--r)', flexShrink: 0 }}>
                        {(c.full_name ?? '?')[0].toUpperCase()}
                      </div>
                      <div>
                        <div className="col-name" style={{ textDecoration: 'line-through', color: 'var(--text-3)' }}>{c.full_name}</div>
                        <div className="col-sub">{c.candidate_role} · {c.total_years}y exp</div>
                      </div>
                    </div>
                  </div>
                  <div className="col-right">
                    <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-3)' }}>Removed</span>
                    <button className="btn btn-secondary" style={{ fontSize: 11, padding: '4px 10px' }}
                      onClick={() => restoreCandidate(c.id)}>Restore</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {watching && <VideoModal candidate={watching} onClose={() => setWatchId(null)} />}
      {cvCandidate && <CVModal candidate={cvCandidate} onClose={() => setCvId(null)} />}

      {showCompare && compareIds.length >= 2 && (() => {
        const compared = compareIds.map(id => candidates.find(c => c.id === id)).filter(Boolean)
        return (
          <div
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 2100, padding: '40px 20px', overflowY: 'auto' }}
            onClick={e => { if (e.target === e.currentTarget) setShowCompare(false) }}
          >
            <div style={{ background: '#F8F7F4', width: '100%', maxWidth: 960, border: '1px solid #E8E4DC', display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 24px', borderBottom: '1px solid #E8E4DC' }}>
                <div>
                  <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.12em', color: '#9CA3AF', marginBottom: 3 }}>Side-by-Side</div>
                  <div style={{ fontSize: 17, fontFamily: 'Georgia, serif', color: '#2D3748' }}>Candidate Comparison</div>
                </div>
                <button onClick={() => setShowCompare(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: '#9CA3AF', lineHeight: 1 }}>×</button>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr>
                      <th style={{ padding: '12px 20px', textAlign: 'left', fontFamily: 'var(--font-mono)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#9CA3AF', background: '#F8F7F4', width: 140, borderBottom: '1px solid #E8E4DC' }}>Metric</th>
                      {compared.map(c => (
                        <th key={c.id} style={{ padding: '12px 16px', textAlign: 'center', fontFamily: 'Georgia, serif', fontWeight: 400, color: '#2D3748', background: compareIds[0] === c.id ? 'rgba(184,146,74,0.06)' : '#F8F7F4', borderBottom: '1px solid #E8E4DC', borderLeft: '1px solid #E8E4DC' }}>
                          <div style={{ fontWeight: 500 }}>{c.full_name}</div>
                          <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: '#9CA3AF', fontWeight: 400, marginTop: 2 }}>{c.candidate_role}</div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { label: 'Screen Score', render: c => c.match_score != null ? <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: dimColor(c.match_score) }}>{c.match_score}</span> : <span style={{ color: '#9CA3AF' }}>—</span> },
                      { label: 'Interview Score', render: c => c.scores?.overallScore != null ? <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: dimColor(c.scores.overallScore) }}>{c.scores.overallScore}</span> : <span style={{ color: '#9CA3AF' }}>—</span> },
                      { label: 'Recommendation', render: c => c.scores?.recommendation ? <span style={{ fontWeight: 600, color: REC_COLOR[c.scores.recommendation], fontFamily: 'var(--font-mono)', fontSize: 11 }}>{c.scores.recommendation}</span> : <span style={{ color: '#9CA3AF' }}>—</span> },
                      { label: 'Experience', render: c => c.total_years != null ? `${c.total_years}y` : '—' },
                      ...DIMS.map(([key, label]) => ({
                        label,
                        render: c => {
                          const v = c.scores?.[key]
                          return v != null ? <span style={{ fontFamily: 'var(--font-mono)', color: dimColor(v) }}>{v}</span> : <span style={{ color: '#9CA3AF' }}>—</span>
                        },
                      })),
                      { label: 'Skills', render: c => (c.skills ?? []).length > 0 ? (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, justifyContent: 'center' }}>
                          {(c.skills ?? []).slice(0, 6).map(sk => <span key={sk} style={{ fontSize: 10, fontFamily: 'var(--font-mono)', padding: '2px 6px', background: 'rgba(0,0,0,0.05)', borderRadius: 3 }}>{sk}</span>)}
                          {(c.skills ?? []).length > 6 && <span style={{ fontSize: 10, color: '#9CA3AF' }}>+{(c.skills ?? []).length - 6}</span>}
                        </div>
                      ) : <span style={{ color: '#9CA3AF' }}>—</span> },
                      { label: 'Status', render: c => <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)' }}>{getStatus(c)}</span> },
                    ].map(({ label, render }) => (
                      <tr key={label} style={{ borderBottom: '1px solid #E8E4DC' }}>
                        <td style={{ padding: '11px 20px', fontFamily: 'var(--font-mono)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#9CA3AF', background: '#F8F7F4' }}>{label}</td>
                        {compared.map(c => (
                          <td key={c.id} style={{ padding: '11px 16px', textAlign: 'center', borderLeft: '1px solid #E8E4DC', background: compareIds[0] === c.id ? 'rgba(184,146,74,0.04)' : 'white' }}>{render(c)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ padding: '14px 24px', borderTop: '1px solid #E8E4DC', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button className="btn btn-secondary" onClick={() => { setShowCompare(false); setCompareIds([]) }} style={{ fontSize: 12 }}>Clear & Close</button>
                <button className="btn btn-secondary" onClick={() => setShowCompare(false)} style={{ fontSize: 12 }}>Close</button>
              </div>
            </div>
          </div>
        )
      })()}

      {offerModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2200, padding: 20 }}
          onClick={e => { if (e.target === e.currentTarget) setOfferModal(null) }}>
          <div style={{ background: '#F8F7F4', width: '100%', maxWidth: 460, padding: 28, border: '1px solid #E8E4DC', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.12em', color: '#9CA3AF', marginBottom: 4 }}>Make Offer</div>
              <div style={{ fontSize: 17, fontFamily: 'Georgia, serif', color: '#2D3748' }}>{offerModal.candidate.full_name}</div>
              <div style={{ fontSize: 13, color: '#9CA3AF', marginTop: 2 }}>{offerModal.candidate.candidate_role}</div>
            </div>
            <div>
              <label style={{ fontSize: 11, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#9CA3AF', display: 'block', marginBottom: 6 }}>Note (optional)</label>
              <textarea rows={3} value={offerModal.note} onChange={e => setOfferModal(m => ({ ...m, note: e.target.value }))}
                placeholder="Any message or next steps for the recruiter…"
                style={{ width: '100%', padding: '9px 12px', border: '1px solid #E8E4DC', background: 'white', fontSize: 13, resize: 'vertical', boxSizing: 'border-box', fontFamily: 'var(--font-body)' }} />
            </div>
            {offerModal.error && <div style={{ fontSize: 12, color: 'var(--red)' }}>{offerModal.error}</div>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setOfferModal(null)}>Cancel</button>
              <button className="btn btn-primary" style={{ background: 'var(--green)', borderColor: 'var(--green)' }}
                disabled={offerModal.sending} onClick={sendOffer}>
                {offerModal.sending ? 'Sending…' : 'Confirm Offer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
