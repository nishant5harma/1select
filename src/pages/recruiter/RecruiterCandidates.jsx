import { useState, useEffect, useRef, useCallback } from 'react'
import { useLocation } from 'react-router-dom'
import mammoth from 'mammoth'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'
import { callClaude, analyzeCandidate, generateReengagementEmail, generateReferenceQuestions } from '../../utils/api'
import { mapMatchToCandidate } from '../../utils/talentPool'
import { extractContent, isSupported, fileExt, ACCEPT_ATTR } from '../../utils/fileExtract'
import { parseExperience } from '../../utils/parseExperience'
import { downloadCsv, candidateRows } from '../../utils/exportCsv'
import AIScoreFeedback from '../../components/AIScoreFeedback'

const REC_COLOR = { 'Strong Hire': 'var(--green)', 'Hire': 'var(--accent)', 'Borderline': 'var(--amber)', 'Reject': 'var(--red)' }
const DIMS = [
  ['technicalAbility','Technical Ability'],
  ['communication','Communication'],
  ['roleFit','Role Fit'],
  ['problemSolving','Problem Solving'],
  ['experienceRelevance','Experience Relevance'],
]
const INTERVIEW_COMPLETE = 'INTERVIEW_COMPLETE'
const TABS = ['All', 'Interview Pending', 'Interview Done', 'Screened Out']
const EMPTY_MANUAL = { full_name: '', email: '', phone: '', candidate_role: '', total_years: '', skills: '', education: '', summary: '', jobId: '', addToPool: false }

const SOURCING_MSGS = [
  'Searching LinkedIn for matching profiles…',
  'Analysing candidate experience…',
  'Scoring profiles against job requirements…',
  'Adding top matches to your pipeline…',
]

function ProfileLinks({ c }) {
  const links = [
    c.linkedin_url  && { href: c.linkedin_url,  label: 'LinkedIn' },
    c.github_url    && { href: c.github_url,     label: 'GitHub' },
    c.portfolio_url && { href: c.portfolio_url,  label: 'Portfolio' },
  ].filter(Boolean)
  if (!links.length) return null
  return (
    <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
      {links.map(({ href, label }) => (
        <a key={label} href={href} target="_blank" rel="noopener noreferrer"
          style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--accent)', textDecoration: 'none', padding: '2px 8px', border: '1px solid var(--accent)', opacity: 0.8 }}>
          ↗ {label}
        </a>
      ))}
    </div>
  )
}

const CV_PARSE_SYSTEM = `You are a CV parser. Return ONLY valid JSON — no markdown:
{"name":"string","email":"string","currentRole":"string","totalYears":number,"skills":["..."],"education":"string","summary":"string","highlights":["..."],"linkedinUrl":"string or null","githubUrl":"string or null","portfolioUrl":"string or null"}`

const FORMAT_ICON = { pdf: '📕', docx: '📝', txt: '📄', jpg: '🖼️', jpeg: '🖼️', png: '🖼️' }

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
      <div className="ring-inner"><span className="ring-val-lg">{(score / 10).toFixed(1)}</span></div>
    </div>
  )
}

function LinkedInProfileSection({ data, linkedinUrl }) {
  const [open, setOpen] = useState(false)
  const d = data ?? {}
  const experience = Array.isArray(d.experience ?? d.positions) ? (d.experience ?? d.positions) : []
  const education  = Array.isArray(d.education)  ? d.education  : []
  const skills     = Array.isArray(d.skills)      ? d.skills     : []

  return (
    <div style={{ marginBottom: 16, border: '1px solid var(--border)', borderRadius: 'var(--r)' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ width: '100%', background: 'var(--surface2)', border: 'none', cursor: 'pointer', padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderRadius: open ? 'var(--r) var(--r) 0 0' : 'var(--r)', fontFamily: 'var(--font-body)' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="badge badge-blue" style={{ fontSize: 9 }}>LinkedIn</span>
          <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>LinkedIn Profile</span>
          {d.headline && <span style={{ fontSize: 12, color: 'var(--text-3)' }}>· {d.headline}</span>}
        </div>
        <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div style={{ padding: '14px 16px', borderTop: '1px solid var(--border)' }}>
          {/* Headline + summary */}
          {d.headline && (
            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', marginBottom: 4 }}>{d.headline}</div>
          )}
          {(d.summary ?? d.about) && (
            <p style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.7, margin: '0 0 12px' }}>{d.summary ?? d.about}</p>
          )}

          {/* Current role */}
          {experience.length > 0 && (() => {
            const cur = experience.find(e => !e.end_date) ?? experience[0]
            return cur ? (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-3)', marginBottom: 4 }}>Current Role</div>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{cur.title}</div>
                <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{cur.company}{cur.start_date ? ` · ${cur.start_date.slice(0, 7)}` : ''}{!cur.end_date ? ' – Present' : ''}</div>
              </div>
            ) : null
          })()}

          {/* Skills */}
          {skills.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-3)', marginBottom: 6 }}>Skills</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {skills.map((sk, i) => (
                  <span key={i} style={{ fontSize: 11, padding: '2px 7px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r)', color: 'var(--text-2)' }}>{String(sk?.name ?? sk)}</span>
                ))}
              </div>
            </div>
          )}

          {/* Education */}
          {education.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-3)', marginBottom: 6 }}>Education</div>
              {education.map((e, i) => (
                <div key={i} style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 3 }}>
                  <span style={{ fontWeight: 500 }}>{e.school}</span>
                  {e.degree && <span> · {e.degree}{e.field ? `, ${e.field}` : ''}</span>}
                  {(e.start_year ?? e.end_year) && (
                    <span style={{ color: 'var(--text-3)' }}> ({e.start_year ?? ''}–{e.end_year ?? 'Present'})</span>
                  )}
                </div>
              ))}
            </div>
          )}

          {linkedinUrl && (
            <a href={linkedinUrl} target="_blank" rel="noopener noreferrer"
              style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--accent)', textDecoration: 'none', padding: '3px 10px', border: '1px solid var(--accent)', borderRadius: 'var(--r)', display: 'inline-block' }}
            >↗ View on LinkedIn</a>
          )}
        </div>
      )}
    </div>
  )
}

function CandidateProfile({ candidate, job, onBack, onShareToggle }) {
  const s = candidate.scores ?? {}
  const transcript = candidate.interview_transcript ?? []
  const rec = s.recommendation

  const [aiAnalysis,        setAiAnalysis]        = useState(null)
  const [aiLoading,         setAiLoading]          = useState(false)
  const [aiError,           setAiError]            = useState('')
  const [reengageEmail,     setReengageEmail]      = useState(null)
  const [reengageLoading,   setReengageLoading]    = useState(false)
  const [refQuestions,      setRefQuestions]       = useState(null)
  const [refQLoading,       setRefQLoading]        = useState(false)
  const [emailCopied,       setEmailCopied]        = useState(false)
  const [notes,             setNotes]              = useState(candidate.recruiter_notes ?? '')
  const [notesSaving,       setNotesSaving]        = useState(false)
  const [notesSaved,        setNotesSaved]         = useState(false)

  const requiredSkills = job?.required_skills ?? []
  const candSkillsLow  = (candidate.skills ?? []).map(s => s.toLowerCase())
  const matchedSkills  = requiredSkills.filter(sk => candSkillsLow.includes(sk.toLowerCase()))
  const missingSkills  = requiredSkills.filter(sk => !candSkillsLow.includes(sk.toLowerCase()))
  const showSkillsGap  = requiredSkills.length > 0

  async function handleAiAnalysis() {
    setAiLoading(true); setAiError('')
    try {
      const result = await analyzeCandidate(candidate, job)
      setAiAnalysis(result)
    } catch (e) {
      setAiError(e.message)
    }
    setAiLoading(false)
  }

  async function handleReeengage() {
    setReengageLoading(true); setAiError('')
    try {
      const result = await generateReengagementEmail(candidate, job)
      setReengageEmail(result)
    } catch (e) {
      setAiError('Re-engagement draft failed: ' + e.message)
    }
    setReengageLoading(false)
  }

  async function handleRefQuestions() {
    setRefQLoading(true); setAiError('')
    try {
      const result = await generateReferenceQuestions(candidate)
      setRefQuestions(result)
    } catch (e) {
      setAiError('Reference questions failed: ' + e.message)
    }
    setRefQLoading(false)
  }

  function copyEmail() {
    if (!reengageEmail) return
    navigator.clipboard.writeText(`Subject: ${reengageEmail.subject}\n\n${reengageEmail.body}`)
    setEmailCopied(true)
    setTimeout(() => setEmailCopied(false), 2000)
  }

  return (
    <div>
      <button className="btn btn-secondary no-print" style={{ marginBottom: 20 }} onClick={onBack}>
        ← Back to list
      </button>

      <div className="profile-hero">
        <div className="profile-avatar">{(candidate.full_name ?? '?')[0].toUpperCase()}</div>
        <div className="profile-id" style={{ flex: 1 }}>
          <h3>{candidate.full_name}</h3>
          <p>{candidate.candidate_role} · {candidate.total_years}y exp</p>
          {candidate.email && <p className="email">{candidate.email}</p>}
          <ProfileLinks c={candidate} />
          {candidate.match_score != null && (
            <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <span className={`badge ${candidate.match_pass ? 'badge-green' : 'badge-red'}`}>
                Screen {(candidate.match_score / 10).toFixed(1)}/10
              </span>
              {candidate.match_rank && (
                <span className={`badge ${candidate.match_rank === 'top10' ? 'badge-blue' : candidate.match_rank === 'strong' ? 'badge-green' : 'badge-amber'}`}>
                  {candidate.match_rank}
                </span>
              )}
              <AIScoreFeedback candidateId={candidate.id} jobId={job?.id} score={candidate.match_score} />
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

      {/* ── Candidate summary ── */}
      {(candidate.summary || (candidate.skills ?? []).length > 0 || candidate.education || (candidate.highlights ?? []).length > 0) && (
        <div className="profile-grid" style={{ marginBottom: 16 }}>
          {candidate.summary && (
            <div className="profile-section full">
              <h4>Summary</h4>
              <p style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.7, margin: 0 }}>{candidate.summary}</p>
            </div>
          )}
          {(candidate.skills ?? []).length > 0 && (
            <div className="profile-section">
              <h4>Skills</h4>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                {candidate.skills.map(sk => (
                  <span key={sk} style={{ fontSize: 11, padding: '3px 8px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r)', color: 'var(--text-2)' }}>{sk}</span>
                ))}
              </div>
            </div>
          )}
          {candidate.education && (
            <div className="profile-section">
              <h4>Education</h4>
              <p style={{ fontSize: 13, color: 'var(--text-2)', margin: 0 }}>{candidate.education}</p>
            </div>
          )}
          {(candidate.highlights ?? []).length > 0 && (
            <div className="profile-section full">
              <h4>Career Highlights</h4>
              <ul style={{ margin: 0, paddingLeft: 16, fontSize: 13, color: 'var(--text-2)', lineHeight: 1.8 }}>
                {candidate.highlights.map((h, i) => <li key={i}>{h}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* ── LinkedIn Profile ── */}
      {candidate.linkedin_data && (
        <LinkedInProfileSection data={candidate.linkedin_data} linkedinUrl={candidate.linkedin_url} />
      )}

      {/* ── Skills Gap ── */}
      {showSkillsGap && (
        <div className="profile-section" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <h4 style={{ margin: 0 }}>Skills Match vs. Job Requirements</h4>
            <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-3)' }}>
              {matchedSkills.length}/{requiredSkills.length} matched
            </span>
          </div>
          {matchedSkills.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
              {matchedSkills.map(sk => (
                <span key={sk} style={{ fontSize: 11, padding: '3px 8px', background: 'rgba(16,185,129,0.1)', border: '1px solid var(--green)', borderRadius: 'var(--r)', color: 'var(--green)' }}>✓ {sk}</span>
              ))}
            </div>
          )}
          {missingSkills.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {missingSkills.map(sk => (
                <span key={sk} style={{ fontSize: 11, padding: '3px 8px', background: 'rgba(239,68,68,0.08)', border: '1px solid var(--red)', borderRadius: 'var(--r)', color: 'var(--red)' }}>✗ {sk}</span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── AI CV Analysis ── */}
      <div style={{ marginBottom: 16 }}>
        {!aiAnalysis && (
          <button
            className="btn btn-secondary"
            style={{ fontSize: 11, padding: '6px 14px' }}
            disabled={aiLoading}
            onClick={handleAiAnalysis}
          >
            {aiLoading ? <><span className="spinner" style={{ width: 11, height: 11 }} /> Analysing…</> : '✦ Analyse with AI'}
          </button>
        )}
        {aiError && <div style={{ fontSize: 12, color: 'var(--red)', marginTop: 6 }}>⚠ {aiError}</div>}
        {aiAnalysis && (
          <div style={{ padding: '14px 16px', background: 'var(--surface)', border: '1px solid var(--border)', borderLeft: '2px solid var(--accent)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--accent)' }}>AI Analysis</span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {aiAnalysis.persona && (
                  <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', padding: '2px 8px', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text-2)' }}>
                    {aiAnalysis.persona}
                  </span>
                )}
                {aiAnalysis.hiringRisk && (
                  <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', padding: '2px 8px', background: aiAnalysis.hiringRisk === 'Low' ? 'rgba(16,185,129,0.1)' : aiAnalysis.hiringRisk === 'High' ? 'rgba(239,68,68,0.1)' : 'rgba(245,158,11,0.1)', border: `1px solid ${aiAnalysis.hiringRisk === 'Low' ? 'var(--green)' : aiAnalysis.hiringRisk === 'High' ? 'var(--red)' : 'var(--amber)'}`, color: aiAnalysis.hiringRisk === 'Low' ? 'var(--green)' : aiAnalysis.hiringRisk === 'High' ? 'var(--red)' : 'var(--amber)' }}>
                    {aiAnalysis.hiringRisk} Risk
                  </span>
                )}
                <button className="btn btn-ghost" style={{ fontSize: 11, padding: '1px 6px' }} onClick={() => setAiAnalysis(null)}>×</button>
              </div>
            </div>
            {aiAnalysis.careerTrajectory && (
              <p style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.7, margin: '0 0 10px' }}>{aiAnalysis.careerTrajectory}</p>
            )}
            {aiAnalysis.skillsGapNarrative && (
              <p style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.7, margin: '0 0 10px', fontStyle: 'italic' }}>{aiAnalysis.skillsGapNarrative}</p>
            )}
            {aiAnalysis.hiringRiskReason && (
              <p style={{ fontSize: 12, color: 'var(--text-3)', margin: 0 }}>Risk note: {aiAnalysis.hiringRiskReason}</p>
            )}
          </div>
        )}
      </div>

      {/* ── Interview Pending: re-engagement ── */}
      {s.overallScore == null && candidate.match_pass && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ padding: '24px', background: 'var(--surface)', border: '1px solid var(--border)', marginBottom: 12 }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--text-3)', marginBottom: 8 }}>Interview Status</div>
            <div style={{ fontSize: 15, color: 'var(--amber)', fontFamily: 'var(--font-mono)', marginBottom: 6 }}>Awaiting Interview</div>
            <div style={{ fontSize: 13, color: 'var(--text-3)', fontWeight: 300 }}>This candidate passed screening and is scheduled for an AI interview.</div>
          </div>
          {!reengageEmail && (
            <button
              className="btn btn-secondary"
              style={{ fontSize: 11, padding: '6px 14px' }}
              disabled={reengageLoading}
              onClick={handleReeengage}
            >
              {reengageLoading ? <><span className="spinner" style={{ width: 11, height: 11 }} /> Drafting…</> : '✉ Draft Re-engagement Email'}
            </button>
          )}
          {reengageEmail && (
            <div style={{ padding: '14px 16px', background: 'var(--surface)', border: '1px solid var(--border)', borderLeft: '2px solid var(--amber)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--amber)' }}>Re-engagement Draft</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="btn btn-secondary" style={{ fontSize: 10, padding: '3px 10px' }} onClick={copyEmail}>
                    {emailCopied ? '✓ Copied' : 'Copy'}
                  </button>
                  <button className="btn btn-ghost" style={{ fontSize: 11, padding: '1px 6px' }} onClick={() => setReengageEmail(null)}>×</button>
                </div>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 6 }}>Subject: <strong style={{ color: 'var(--text-2)' }}>{reengageEmail.subject}</strong></div>
              <p style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.7, margin: 0, whiteSpace: 'pre-wrap' }}>{reengageEmail.body}</p>
            </div>
          )}
        </div>
      )}

      {/* ── Interview scores + reference questions ── */}
      {s.overallScore != null && (
        <>
          <div className="profile-grid">
            <div className="profile-section">
              <h4>Dimension Scores</h4>
              {DIMS.map(([key, label]) => (
                <div key={key} className="score-dim">
                  <span className="dim-label">{label}</span>
                  <div className="dim-track"><div className="dim-fill" style={{ width: `${s[key] ?? 0}%`, background: dimColor(s[key] ?? 0) }} /></div>
                  <span className="dim-val">{s[key] != null ? (s[key] / 10).toFixed(1) : '—'}</span>
                </div>
              ))}
              {s.confidence != null && (
                <div style={{ marginTop: 12, fontSize: 11, color: 'var(--text-3)' }}>
                  Confidence: <span className="mono" style={{ color: 'var(--text-2)' }}>{s.confidence}%</span>
                </div>
              )}
              {s.offerProbability != null && (
                <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-3)' }}>
                  Offer Probability: <span className="mono" style={{ color: dimColor(s.offerProbability) }}>{s.offerProbability}%</span>
                </div>
              )}
            </div>

            <div className="profile-section">
              {s.insight && (
                <>
                  <h4>AI Insight</h4>
                  <p className="insight-text">{s.insight}</p>
                </>
              )}
              {(s.highlights ?? s.strengths ?? []).length > 0 && (
                <>
                  <h4 style={{ marginTop: 16 }}>Strengths</h4>
                  <ul className="strength-list">
                    {(s.highlights ?? s.strengths).map((str, i) => <li key={i}><span className="dot-green" />{str}</li>)}
                  </ul>
                </>
              )}
              {(s.redFlags ?? s.flags ?? []).length > 0 && (
                <>
                  <h4 style={{ marginTop: 16 }}>Red Flags</h4>
                  <ul className="flag-list">
                    {(s.redFlags ?? s.flags).map((f, i) => <li key={i}><span className="dot-red" />{f}</li>)}
                  </ul>
                </>
              )}
            </div>

            {s.skillsVerification && (
              <div className="profile-section full">
                <h4>Skills Verification</h4>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginTop: 8 }}>
                  {[
                    { label: 'Verified', items: s.skillsVerification.verified ?? [], color: 'var(--green)' },
                    { label: 'Questionable', items: s.skillsVerification.questionable ?? [], color: 'var(--amber)' },
                    { label: 'Not Demonstrated', items: s.skillsVerification.notDemonstrated ?? [], color: 'var(--red)' },
                  ].map(({ label, items, color }) => (
                    <div key={label}>
                      <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.08em', color, marginBottom: 6 }}>{label}</div>
                      {items.length === 0
                        ? <div style={{ fontSize: 12, color: 'var(--text-3)' }}>—</div>
                        : items.map((sk, i) => <div key={i} style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.8 }}>· {sk}</div>)
                      }
                    </div>
                  ))}
                </div>
              </div>
            )}

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

          {/* Reference Check Questions */}
          <div style={{ marginTop: 16 }}>
            {!refQuestions && (
              <button
                className="btn btn-secondary"
                style={{ fontSize: 11, padding: '6px 14px' }}
                disabled={refQLoading}
                onClick={handleRefQuestions}
              >
                {refQLoading ? <><span className="spinner" style={{ width: 11, height: 11 }} /> Generating…</> : '✦ Reference Check Questions'}
              </button>
            )}
            {refQuestions?.questions?.length > 0 && (
              <div style={{ padding: '14px 16px', background: 'var(--surface)', border: '1px solid var(--border)', borderLeft: '2px solid var(--accent)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--accent)' }}>Reference Check Questions</span>
                  <button className="btn btn-ghost" style={{ fontSize: 11, padding: '1px 6px' }} onClick={() => setRefQuestions(null)}>×</button>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {refQuestions.questions.map((q, i) => (
                    <div key={i} style={{ borderBottom: i < refQuestions.questions.length - 1 ? '1px solid var(--border)' : 'none', paddingBottom: i < refQuestions.questions.length - 1 ? 12 : 0 }}>
                      <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.6, marginBottom: 4 }}>
                        <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)', marginRight: 8 }}>{i + 1}.</span>
                        {q.question}
                      </div>
                      {q.rationale && (
                        <div style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.5, paddingLeft: 20 }}>↳ {q.rationale}</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Share with Client ── */}
      {!candidate._fromPool && candidate.match_pass !== null && onShareToggle && (
        <div style={{ marginTop: 24, padding: '14px 16px', background: 'var(--surface)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
          <div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-3)', marginBottom: 4 }}>Client Visibility</div>
            <div style={{ fontSize: 13, color: 'var(--text-2)' }}>
              {candidate.shared_with_client
                ? 'This candidate is visible in the client portal.'
                : 'This candidate is not yet visible to the client.'}
            </div>
          </div>
          <button
            className="btn btn-secondary"
            style={{ whiteSpace: 'nowrap', flexShrink: 0, ...(candidate.shared_with_client ? { color: 'var(--green)', borderColor: 'rgba(42,110,58,0.5)', background: 'var(--green-d)' } : { color: 'var(--accent)', borderColor: 'rgba(205,127,69,0.5)' }) }}
            onClick={() => onShareToggle(candidate)}
          >
            {candidate.shared_with_client ? '✓ Shared with Client' : 'Share with Client →'}
          </button>
        </div>
      )}

      {/* ── Recruiter Notes ── */}
      <div style={{ marginTop: 24, padding: '14px 16px', background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-3)', marginBottom: 8 }}>Recruiter Notes</div>
        <textarea
          value={notes}
          onChange={e => { setNotes(e.target.value); setNotesSaved(false) }}
          placeholder="Internal notes visible only to recruiters and admins…"
          rows={4}
          style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13, fontFamily: 'var(--font-body)', lineHeight: 1.6, resize: 'vertical', boxSizing: 'border-box' }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
          <button
            className="btn btn-secondary"
            style={{ fontSize: 11, padding: '5px 14px' }}
            disabled={notesSaving}
            onClick={async () => {
              setNotesSaving(true)
              const table = candidate._fromPool ? 'job_matches' : 'candidates'
              await supabase.from(table).update({ recruiter_notes: notes.trim() || null }).eq('id', candidate.id)
              setNotesSaving(false)
              setNotesSaved(true)
              setTimeout(() => setNotesSaved(false), 2000)
            }}
          >
            {notesSaving ? <><span className="spinner" style={{ width: 10, height: 10 }} /> Saving…</> : 'Save Notes'}
          </button>
          {notesSaved && <span style={{ fontSize: 11, color: 'var(--green)', fontFamily: 'var(--font-mono)' }}>✓ Saved</span>}
        </div>
      </div>
    </div>
  )
}

const MO = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000 }
const MB = { background: 'var(--surface)', borderRadius: 12, padding: 28, width: 460, display: 'flex', flexDirection: 'column', gap: 16, maxHeight: '90vh', overflowY: 'auto' }
const ML = { fontSize: 11, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-3)', display: 'block', marginBottom: 6 }
const MI = { width: '100%', padding: '9px 12px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13, boxSizing: 'border-box' }

export default function RecruiterCandidates() {
  const { user } = useAuth()
  const location = useLocation()
  const [jobs, setJobs]                         = useState([])
  const [candidates, setCandidates]             = useState([])
  const [poolCandidates, setPoolCandidates]     = useState([])
  const [loading, setLoading]                   = useState(true)
  const [source, setSource]                     = useState('uploaded')
  const [jobFilter, setJobFilter]               = useState('all')
  const [tab, setTab]                           = useState('All')
  const [selectedId, setSelectedId]             = useState(null)
  const [deleteModal, setDeleteModal]           = useState(null)
  const [addManuallyModal, setAddManuallyModal] = useState(null)
  const [allotJobModal, setAllotJobModal]       = useState(null)
  const [selectedIds, setSelectedIds]           = useState(new Set())
  const [bulkDeleteModal, setBulkDeleteModal]   = useState(false)
  const [bulkDeleteing, setBulkDeleting]        = useState(false)
  const [bulkAllotModal, setBulkAllotModal]     = useState(false)
  const [bulkAllotJobId, setBulkAllotJobId]     = useState('')
  const [bulkAlloting, setBulkAlloting]         = useState(false)
  const [searchQuery, setSearchQuery]           = useState('')
  const [sourcingJob,       setSourcingJob]       = useState(false)
  const [sourcingForJobId,  setSourcingForJobId]  = useState(null)
  const [sourcedJob,        setSourcedJob]        = useState(null)
  const [sourcingMsgIdx,    setSourcingMsgIdx]    = useState(0)
  const [sourcingNoResults, setSourcingNoResults] = useState(false)
  const sourcingIntervalRef = useRef(null)
  const sourcingPollRef     = useRef(null)
  const [interviewModes, setInterviewModes]     = useState(() => {
    try { return JSON.parse(localStorage.getItem('interview_modes') || '{}') } catch { return {} }
  })

  // CV upload
  const [showUpload, setShowUpload]   = useState(false)
  const [files, setFiles]             = useState([])
  const [dragging, setDragging]       = useState(false)
  const [parsing, setParsing]         = useState(false)
  const [uploadJobId, setUploadJobId] = useState('')
  const fileInputRef = useRef()

  useEffect(() => { if (user) load() }, [user])

  useEffect(() => {
    if (!addManuallyModal) return
    const { saving, error, ...formData } = addManuallyModal
    try { localStorage.setItem('form_candidate_add', JSON.stringify(formData)) } catch {}
  }, [addManuallyModal])

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const t = params.get('tab')
    if (t && TABS.includes(t)) setTab(t)
    const j = params.get('job')
    if (j) setJobFilter(j)
  }, [location.search])

  useEffect(() => {
    if (sourcingJob) {
      setSourcingMsgIdx(0)
      sourcingIntervalRef.current = setInterval(() => {
        setSourcingMsgIdx(i => (i + 1) % SOURCING_MSGS.length)
      }, 2500)
    } else {
      clearInterval(sourcingIntervalRef.current)
      sourcingIntervalRef.current = null
    }
    return () => clearInterval(sourcingIntervalRef.current)
  }, [sourcingJob])

  async function load() {
    try { // fix: wrap in try/finally so setLoading(false) always fires on query error
    const { data: rcData } = await supabase
      .from('recruiter_clients')
      .select('client_id')
      .eq('recruiter_id', user.id)
    const clientIds = (rcData ?? []).map(r => r.client_id)
    if (!clientIds.length) { return }

    const { data: jobData } = await supabase.from('jobs').select('id, title, description, required_skills').in('recruiter_id', clientIds)
    const ids = (jobData ?? []).map(j => j.id)
    setJobs(jobData ?? [])
    if (!ids.length) { return }

    const [{ data: cData }, { data: mData }] = await Promise.all([
      supabase.from('candidates').select('*').in('job_id', ids).order('match_score', { ascending: false, nullsFirst: false }).limit(1000),
      supabase.from('job_matches').select('*, talent_pool(*)').in('job_id', ids).order('match_score', { ascending: false, nullsFirst: false }).limit(1000),
    ])
    setCandidates(cData ?? [])
    setPoolCandidates((mData ?? []).map(mapMatchToCandidate))
    } finally {
      setLoading(false) // fix: always clear loading even when queries fail
    }
  }

  function stopPoll() {
    if (sourcingPollRef.current) {
      clearInterval(sourcingPollRef.current)
      sourcingPollRef.current = null
    }
    try { sessionStorage.removeItem('sourcing_pending') } catch {}
  }

  function startPoll(jobId, startedAt) {
    if (sourcingPollRef.current) clearInterval(sourcingPollRef.current)
    const deadline = Date.now() + 360_000  // 6-minute hard timeout
    sourcingPollRef.current = setInterval(async () => {
      if (Date.now() > deadline) {
        stopPoll()
        setSourcingJob(false)
        setSourcingForJobId(null)
        return
      }
      const { data } = await supabase
        .rpc('get_sourcing_status', { p_job_id: jobId, p_after: startedAt })
        .catch(() => ({ data: null }))
      if (!data?.done) return
      stopPoll()
      setSourcingJob(false)
      setSourcingForJobId(null)
      const totalAdded = (data.candidates_added_to_pipeline ?? 0) + (data.candidates_added_to_pool ?? 0)
      if (totalAdded === 0) {
        setSourcingNoResults(true)
        setTimeout(() => setSourcingNoResults(false), 8000)
      } else {
        setSourcedJob(jobId)
        setTimeout(() => setSourcedJob(null), 3000)
        load()
      }
    }, 10_000)
  }

  // Resume sourcing loading state if the user navigated away mid-sourcing
  useEffect(() => {
    if (!user) return
    try {
      const pending = JSON.parse(sessionStorage.getItem('sourcing_pending') ?? 'null')
      if (pending?.jobId && pending?.startedAt) {
        setSourcingJob(true)
        setSourcingForJobId(pending.jobId)
        startPoll(pending.jobId, pending.startedAt)
      }
    } catch {}
    return () => stopPoll()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  function setInterviewMode(jobId, mode) {
    setInterviewModes(prev => {
      const next = { ...prev, [jobId]: mode }
      try { localStorage.setItem('interview_modes', JSON.stringify(next)) } catch {}
      return next
    })
  }

  async function sourceLinkedIn() {
    const job = jobs.find(j => j.id === jobFilter)
    if (!job) return
    const startedAt = new Date().toISOString()
    setSourcingJob(true)
    setSourcingForJobId(job.id)
    setSourcingNoResults(false)
    // Persist so we can resume the loading UI if the user navigates away and back
    try { sessionStorage.setItem('sourcing_pending', JSON.stringify({ jobId: job.id, startedAt })) } catch {}
    // Fire the edge function with keepalive:true so the request completes even if
    // the user switches tabs or navigates away before it finishes.
    const { data: sessionData } = await supabase.auth.getSession() // fix: guard against null session destructure
    const session = sessionData?.session
    fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/source-linkedin-candidates`, {
      method:    'POST',
      keepalive: true,
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${session?.access_token}`,
        'apikey':        import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({
        job_id:          job.id,
        job_title:       job.title,
        job_description: job.description ?? '',
        skills:          job.required_skills ?? [],
      }),
    }).catch(() => {})
    // Poll the sourcing log every 10 s to detect completion
    startPoll(job.id, startedAt)
  }

  async function toggleShareWithClient(candidate) {
    const newVal = !candidate.shared_with_client
    await supabase.from('candidates').update({ shared_with_client: newVal }).eq('id', candidate.id)
    setCandidates(p => p.map(c => c.id === candidate.id ? { ...c, shared_with_client: newVal } : c))
  }

  async function handleDelete() {
    const { candidate } = deleteModal
    setDeleteModal(m => ({ ...m, deleting: true }))
    const table = candidate._fromPool ? 'job_matches' : 'candidates'
    const { error } = await supabase.from(table).delete().eq('id', candidate.id)
    if (!error) {
      if (candidate._fromPool) setPoolCandidates(p => p.filter(c => c.id !== candidate.id))
      else setCandidates(p => p.filter(c => c.id !== candidate.id))
    }
    setDeleteModal(null)
  }

  async function handleAddManually() {
    const f = addManuallyModal
    if (!f.full_name.trim() || !f.jobId) return
    setAddManuallyModal(m => ({ ...m, saving: true, error: null }))
    try {
      const skillsArr = f.skills.split(',').map(s => s.trim()).filter(Boolean)
      const { data: saved, error } = await supabase.from('candidates').insert({
        job_id:         f.jobId,
        full_name:      f.full_name.trim(),
        email:          f.email.trim(),
        phone:          f.phone.trim(),
        candidate_role: f.candidate_role.trim(),
        total_years:    parseInt(f.total_years) || 0,
        skills:         skillsArr,
        education:      f.education.trim(),
        summary:        f.summary.trim(),
        source:         'manually_added',
      }).select().single()
      if (error) throw new Error(error.message)
      if (f.addToPool) {
        await supabase.from('talent_pool').insert({
          full_name:      f.full_name.trim(),
          email:          f.email.trim(),
          candidate_role: f.candidate_role.trim(),
          total_years:    parseInt(f.total_years) || 0,
          skills:         skillsArr,
          education:      f.education.trim(),
          summary:        f.summary.trim(),
          availability:   'available',
        })
      }
      setCandidates(p => [saved, ...p])
      localStorage.removeItem('form_candidate_add')
      setAddManuallyModal(null)
    } catch (err) {
      setAddManuallyModal(m => ({ ...m, saving: false, error: err.message }))
    }
  }

  async function handleAllotToJob() {
    const { candidate, jobId } = allotJobModal
    if (!jobId) return
    setAllotJobModal(m => ({ ...m, alloting: true, error: null }))
    try {
      const { data: saved, error } = await supabase.from('candidates').insert({
        job_id:         jobId,
        full_name:      candidate.full_name,
        email:          candidate.email ?? '',
        candidate_role: candidate.candidate_role ?? '',
        total_years:    candidate.total_years ?? 0,
        skills:         Array.isArray(candidate.skills) ? candidate.skills : [],
        education:      candidate.education ?? '',
        summary:        candidate.summary ?? '',
        source:         'manually_added',
      }).select().single()
      if (error) throw new Error(error.message)
      setCandidates(p => [saved, ...p])
      setAllotJobModal(null)
    } catch (err) {
      setAllotJobModal(m => ({ ...m, alloting: false, error: err.message }))
    }
  }

  function toggleSelect(id) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    if (tabPage.every(c => selectedIds.has(c.id))) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(tabPage.map(c => c.id)))
    }
  }

  async function handleBulkDelete() {
    setBulkDeleting(true)
    const poolIds     = [...selectedIds].filter(id => [...poolCandidates].some(c => c.id === id))
    const regularIds  = [...selectedIds].filter(id => !poolIds.includes(id))
    if (regularIds.length)  await supabase.from('candidates').delete().in('id', regularIds)
    if (poolIds.length)     await supabase.from('job_matches').delete().in('id', poolIds)
    setCandidates(p => p.filter(c => !regularIds.includes(c.id)))
    setPoolCandidates(p => p.filter(c => !poolIds.includes(c.id)))
    setSelectedIds(new Set())
    setBulkDeleting(false)
    setBulkDeleteModal(false)
  }

  async function handleBulkAllot() {
    if (!bulkAllotJobId) return
    setBulkAlloting(true)
    const toAllot = [...candidates, ...poolCandidates].filter(c => selectedIds.has(c.id) && !c._fromPool)
    const inserts = toAllot.map(c => ({
      job_id:         bulkAllotJobId,
      full_name:      c.full_name,
      email:          c.email ?? '',
      candidate_role: c.candidate_role ?? '',
      total_years:    c.total_years ?? 0,
      skills:         Array.isArray(c.skills) ? c.skills : [],
      education:      c.education ?? '',
      summary:        c.summary ?? '',
      source:         'manually_added',
    }))
    if (inserts.length) {
      const { data: saved } = await supabase.from('candidates').insert(inserts).select()
      if (saved) setCandidates(p => [...saved, ...p])
    }
    setSelectedIds(new Set())
    setBulkAllotJobId('')
    setBulkAlloting(false)
    setBulkAllotModal(false)
  }

  const addFiles = useCallback((incoming) => {
    const valid = Array.from(incoming).filter(isSupported)
    if (!valid.length) return
    const tooBig = valid.filter(f => f.size > 5 * 1024 * 1024)
    if (tooBig.length) {
      setFiles(p => [...p, ...tooBig.map(f => ({ id: crypto.randomUUID(), file: f, ext: fileExt(f), status: 'error', parsed: null, error: 'CV must be under 5 MB. Please compress your file and try again.' }))])
    }
    setFiles(p => [...p, ...valid
      .filter(f => f.size <= 5 * 1024 * 1024)
      .filter(f => !p.some(e => e.file.name === f.name))
      .map(f => ({ id: crypto.randomUUID(), file: f, ext: fileExt(f), status: 'pending', parsed: null, error: '' }))])
  }, [])

  const onDrop = useCallback((e) => {
    e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files)
  }, [addFiles])

  function patchFile(id, updates) {
    setFiles(p => p.map(f => f.id === id ? { ...f, ...updates } : f))
  }

  async function parseAll() {
    setParsing(true)
    for (const entry of files.filter(f => f.status === 'pending')) {
      patchFile(entry.id, { status: 'parsing' })
      try {
        let content
        if (entry.ext === 'docx') {
          const arrayBuffer = await entry.file.arrayBuffer()
          const result = await mammoth.extractRawText({ arrayBuffer })
          if (!result.value?.trim()) throw new Error('No text extracted from DOCX')
          content = { kind: 'text', text: result.value }
        } else {
          content = await extractContent(entry.file)
        }
        const msgs = content.kind === 'image'
          ? [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: content.mediaType, data: content.base64 } }, { type: 'text', text: 'Parse this CV image.' }] }]
          : [{ role: 'user', content: `Parse this CV:\n\n${content.text}` }]
        const reply = await callClaude(msgs, CV_PARSE_SYSTEM, 1024)
        const parsed = JSON.parse(reply.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''))
        // Duplicate check
        if (parsed.email && uploadJobId) {
          const { data: existing } = await supabase.from('candidates').select('id, full_name').eq('job_id', uploadJobId).ilike('email', parsed.email).maybeSingle()
          if (existing) { patchFile(entry.id, { status: 'error', error: `Duplicate — ${existing.full_name} already exists for this job` }); continue }
        }

        const { data: saved, error } = await supabase.from('candidates').insert({
          job_id:         uploadJobId || null,
          full_name:      parsed.name,
          email:          parsed.email ?? '',
          candidate_role: parsed.currentRole ?? '',
          total_years:    parseExperience(parsed.totalYears) ?? 0,
          skills:         parsed.skills ?? [],
          education:      parsed.education ?? '',
          summary:        parsed.summary ?? '',
          highlights:     parsed.highlights ?? [],
          raw_text:       content.kind === 'text' ? content.text : '',
          linkedin_url:   parsed.linkedinUrl ?? null,
          github_url:     parsed.githubUrl ?? null,
          portfolio_url:  parsed.portfolioUrl ?? null,
        }).select().single()
        if (error) throw new Error(error.message)
        patchFile(entry.id, { status: 'done', parsed })
        setCandidates(p => [saved, ...p])
      } catch (err) {
        patchFile(entry.id, { status: 'error', error: err.message })
      }
    }
    setParsing(false)
  }

  function getStatus(c) {
    if (c.scores?.overallScore != null) return 'Interview Done'
    if (c.match_pass === true) return 'Interview Pending'
    if (c.match_pass === false) return 'Screened Out'
    return 'Pending'
  }

  const jobName = (id) => jobs.find(j => j.id === id)?.title ?? '—'

  const [candPage, setCandPage] = useState(0)
  const CAND_PAGE_SIZE = 50

  useEffect(() => { setSelectedIds(new Set()); setCandPage(0) }, [source, jobFilter, tab])
  useEffect(() => { setCandPage(0) }, [searchQuery])

  const activeList = source === 'pool' ? poolCandidates : candidates
  const byJob = jobFilter === 'all' ? activeList : activeList.filter(c => c.job_id === jobFilter)
  const searchFiltered = byJob.filter(c => {
    if (!searchQuery.trim()) return true
    const words = searchQuery.toLowerCase().split(/\s+/)
    const hay = [c.full_name, c.candidate_role, c.email, c.summary, ...(c.skills ?? [])].join(' ').toLowerCase()
    return words.every(w => hay.includes(w))
  })
  const tabFiltered     = searchFiltered.filter(c => tab === 'All' || getStatus(c) === tab)
  const tabTotal        = tabFiltered.length
  const tabPage         = tabFiltered.slice(candPage * CAND_PAGE_SIZE, (candPage + 1) * CAND_PAGE_SIZE)
  const allVisibleSelected = tabPage.length > 0 && tabPage.every(c => selectedIds.has(c.id))

  const counts = {
    'All': searchFiltered.length,
    'Interview Pending': searchFiltered.filter(c => getStatus(c) === 'Interview Pending').length,
    'Interview Done': searchFiltered.filter(c => getStatus(c) === 'Interview Done').length,
    'Screened Out': searchFiltered.filter(c => getStatus(c) === 'Screened Out').length,
  }

  const selected    = [...candidates, ...poolCandidates].find(c => c.id === selectedId)
  const selectedJob = jobs.find(j => j.id === selected?.job_id)

  if (loading) return <div className="page"><span className="spinner" /></div>

  if (selected) {
    return (
      <div className="page">
        <CandidateProfile candidate={selected} job={selectedJob} onBack={() => setSelectedId(null)} onShareToggle={toggleShareWithClient} />
      </div>
    )
  }

  return (
    <div className="page">
      <style>{`@keyframes sourcing-pulse { 0%, 60%, 100% { transform: scale(1); opacity: 0.35; } 30% { transform: scale(1.5); opacity: 1; } }`}</style>
      <div className="page-head">
        <div>
          <h2>Candidates</h2>
          <p>{byJob.length} candidate{byJob.length !== 1 ? 's' : ''} across all jobs</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
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
          <button
            className="btn btn-secondary"
            style={{ whiteSpace: 'nowrap' }}
            disabled={jobs.length === 0 || jobFilter === 'all' || sourcingJob}
            title={jobFilter === 'all' ? 'Select a specific job to source LinkedIn candidates' : 'Source LinkedIn candidates for this job'}
            onClick={sourceLinkedIn}
          >
            {sourcingJob
              ? <><span className="spinner" style={{ width: 11, height: 11 }} /> Sourcing…</>
              : sourcedJob === jobFilter
                ? '✓ Sourcing started'
                : '⟳ Source LinkedIn'}
          </button>
          <button
            className="btn btn-secondary"
            style={{ whiteSpace: 'nowrap' }}
            disabled={jobs.length === 0}
            onClick={() => { setShowUpload(v => !v); setFiles([]) }}
          >
            {showUpload ? '✕ Close Upload' : '⬆ Upload CVs'}
          </button>
          <button
            className="btn btn-primary"
            style={{ whiteSpace: 'nowrap' }}
            disabled={jobs.length === 0}
            onClick={() => { const saved = (() => { try { return JSON.parse(localStorage.getItem('form_candidate_add') || 'null') } catch { return null } })(); setAddManuallyModal({ ...EMPTY_MANUAL, ...(saved ?? {}), saving: false, error: null }) }}
          >
            + Add Manually
          </button>
          {activeList.length > 0 && (
            <button
              className="btn btn-secondary"
              style={{ whiteSpace: 'nowrap' }}
              onClick={() => {
                const jTitle = jobFilter !== 'all' ? (jobs.find(j => j.id === jobFilter)?.title ?? '') : ''
                downloadCsv(`candidates-${Date.now()}.csv`, candidateRows(activeList, jTitle))
              }}
            >↓ CSV</button>
          )}
        </div>
      </div>

      {/* ── CV Upload Panel ── */}
      {showUpload && (
        <div className="section-card" style={{ marginBottom: 20 }}>
          <div className="section-card-head">
            <h3>Upload CVs</h3>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <select
                value={uploadJobId}
                onChange={e => setUploadJobId(e.target.value)}
                style={{ fontSize: 12, padding: '5px 10px', minWidth: 200 }}
              >
                <option value="">— assign to job —</option>
                {jobs.map(j => <option key={j.id} value={j.id}>{j.title}</option>)}
              </select>
              {files.filter(f => f.status === 'pending').length > 0 && (
                <button
                  className="btn btn-primary"
                  style={{ fontSize: 12, padding: '5px 12px', whiteSpace: 'nowrap' }}
                  disabled={parsing}
                  onClick={parseAll}
                >
                  {parsing
                    ? <><span className="spinner" style={{ width: 11, height: 11 }} /> Parsing…</>
                    : 'Parse with AI'}
                </button>
              )}
            </div>
          </div>
          <div className="section-card-body">
            <div
              className={`drop-zone${dragging ? ' drag-over' : ''}`}
              onDrop={onDrop}
              onDragOver={e => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onClick={() => fileInputRef.current.click()}
            >
              <div className="drop-icon">⬆</div>
              <p>Drop CVs here or <span className="link">browse files</span></p>
              <div className="format-pills">
                {['PDF', 'DOCX', 'TXT', 'JPG', 'PNG'].map(f => <span key={f} className="format-pill">{f}</span>)}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPT_ATTR}
                multiple
                style={{ display: 'none' }}
                onChange={e => { addFiles(e.target.files); e.target.value = '' }}
              />
            </div>

            {files.length > 0 && (
              <div className="file-list" style={{ marginTop: 12 }}>
                {files.map(f => (
                  <div key={f.id} className="file-row">
                    <div className="file-info">
                      <span className="file-icon">{FORMAT_ICON[f.ext] ?? '📄'}</span>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <span className="file-name">{f.file.name}</span>
                          <span className={`badge ${f.ext === 'pdf' ? 'badge-red' : f.ext === 'docx' ? 'badge-blue' : 'badge-amber'}`} style={{ fontSize: 9 }}>{f.ext?.toUpperCase()}</span>
                        </div>
                        {f.parsed && <div className="file-parsed"><strong>{f.parsed.name}</strong> · {f.parsed.currentRole}</div>}
                        {f.status === 'error' && <div className="error-text">⚠ {f.error}</div>}
                      </div>
                    </div>
                    <div className="file-status">
                      {f.status === 'pending' && <span className="badge badge-amber">Pending</span>}
                      {f.status === 'parsing' && <span className="spinner" />}
                      {f.status === 'done'    && <span className="badge badge-green">Added</span>}
                      {f.status === 'error'   && <span className="badge badge-red">Error</span>}
                      <button
                        className="btn btn-ghost"
                        style={{ padding: '3px 7px', fontSize: 15 }}
                        onClick={() => setFiles(p => p.filter(x => x.id !== f.id))}
                      >×</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Source tabs */}
      <div style={{ display: 'flex', gap: 2, borderBottom: '1px solid var(--border)' }}>
        {[
          { key: 'uploaded', label: 'Uploaded CVs', count: (jobFilter === 'all' ? candidates : candidates.filter(c => c.job_id === jobFilter)).length },
          { key: 'pool',     label: 'Talent Pool',  count: (jobFilter === 'all' ? poolCandidates : poolCandidates.filter(c => c.job_id === jobFilter)).length },
        ].map(s => (
          <button
            key={s.key}
            onClick={() => { setSource(s.key); setSelectedId(null) }}
            style={{
              padding: '10px 18px', border: 'none', background: 'none', cursor: 'pointer',
              fontFamily: 'var(--font-mono)', fontSize: 11, textTransform: 'uppercase',
              letterSpacing: '0.08em', color: source === s.key ? 'var(--text)' : 'var(--text-3)',
              borderBottom: source === s.key ? '2px solid var(--text)' : '2px solid transparent',
              marginBottom: -1, transition: 'color 0.12s',
            }}
          >
            {s.label}
            <span style={{ marginLeft: 6, color: source === s.key ? 'var(--accent)' : 'var(--text-3)' }}>{s.count}</span>
          </button>
        ))}
      </div>

      {/* Status tabs */}
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
            <span style={{ marginLeft: 6, fontSize: 10, color: tab === t ? 'var(--accent)' : 'var(--text-3)' }}>{counts[t]}</span>
          </button>
        ))}
      </div>

      {/* ── Interview Mode toggle (visible only when a specific job is selected) ── */}
      {jobFilter !== 'all' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, padding: '8px 14px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r)', fontSize: 12 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-3)', flexShrink: 0 }}>AI Interview</span>
          {['manual', 'auto'].map(mode => {
            const active = (interviewModes[jobFilter] ?? 'manual') === mode
            return (
              <button
                key={mode}
                onClick={() => setInterviewMode(jobFilter, mode)}
                style={{
                  padding: '4px 12px', border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                  background: active ? 'var(--accent)' : 'var(--surface)',
                  color: active ? '#fff' : 'var(--text-3)',
                  borderRadius: 'var(--r)', fontSize: 11, cursor: 'pointer',
                  fontFamily: 'var(--font-mono)', letterSpacing: '0.04em',
                }}
              >{mode === 'manual' ? 'Manual Review' : 'Automated'}</button>
            )
          })}
          <span style={{ fontSize: 11, color: 'var(--text-3)', marginLeft: 4 }}>
            {(interviewModes[jobFilter] ?? 'manual') === 'auto'
              ? 'Invites sent automatically when candidates pass screening'
              : 'You send invites manually for each candidate'}
          </span>
        </div>
      )}

      {/* ── Bulk action bar ── */}
      {selectedIds.size > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', marginBottom: 8, background: 'var(--accent)', borderRadius: 'var(--r)', color: '#fff' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600 }}>{selectedIds.size} selected</span>
          <div style={{ flex: 1 }} />
          <button
            className="btn btn-secondary"
            style={{ fontSize: 11, padding: '4px 12px', background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.3)', color: '#fff' }}
            onClick={() => setBulkAllotModal(true)}
          >
            Allot to Job
          </button>
          <button
            className="btn btn-secondary"
            style={{ fontSize: 11, padding: '4px 12px', background: 'rgba(239,68,68,0.25)', border: '1px solid rgba(239,68,68,0.5)', color: '#fff' }}
            onClick={() => setBulkDeleteModal(true)}
          >
            Delete Selected
          </button>
          <button
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.7)', fontSize: 18, lineHeight: 1, padding: '0 4px' }}
            onClick={() => setSelectedIds(new Set())}
            title="Clear selection"
          >×</button>
        </div>
      )}

      {sourcingJob && sourcingForJobId === jobFilter && (
        <div className="section-card" style={{ padding: '48px 24px', textAlign: 'center' }}>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginBottom: 28 }}>
            {[0, 1, 2].map(i => (
              <div key={i} style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--accent)', animation: `sourcing-pulse 1.5s ease-in-out ${i * 0.18}s infinite` }} />
            ))}
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--accent)', marginBottom: 12 }}>AI Sourcing in Progress</div>
          <div style={{ fontSize: 14, color: 'var(--text-2)', minHeight: 22 }}>{SOURCING_MSGS[sourcingMsgIdx]}</div>
          <div style={{ marginTop: 20, fontSize: 11, color: 'var(--text-3)', lineHeight: 1.7 }}>This usually takes 1–3 minutes. You can navigate away — sourcing continues in the background.</div>
        </div>
      )}
      {sourcingNoResults && sourcingForJobId === jobFilter && (
        <div className="section-card" style={{ padding: '48px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-3)', marginBottom: 12 }}>LinkedIn Sourcing Complete</div>
          <div style={{ fontSize: 14, color: 'var(--text-2)', marginBottom: 6 }}>No matching profiles found on LinkedIn for this role.</div>
          <div style={{ fontSize: 12, color: 'var(--text-3)' }}>Try adjusting the job requirements or skills list.</div>
        </div>
      )}
      {!(sourcingJob && sourcingForJobId === jobFilter) && !(sourcingNoResults && sourcingForJobId === jobFilter) && (
      <div className="section-card">
        {tabFiltered.length === 0 ? (
          <div className="empty-state">
            <div style={{ fontSize: 28, marginBottom: 10, opacity: 0.3 }}>◌</div>
            <div style={{ fontWeight: 400, color: 'var(--text-2)', marginBottom: 6 }}>
              {searchQuery.trim() || jobFilter !== 'all' ? 'No candidates match this filter' : 'No candidates yet'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
              {searchQuery.trim() || jobFilter !== 'all'
                ? 'Try clearing the search or selecting a different job.'
                : 'Upload CVs, source from LinkedIn, or add candidates manually to get started.'}
            </div>
          </div>
        ) : (
          <>
            {/* Select-all row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 16px', borderBottom: '1px solid var(--border)', background: 'var(--surface2)' }}>
              <input
                type="checkbox"
                checked={allVisibleSelected}
                onChange={toggleSelectAll}
                style={{ width: 15, height: 15, cursor: 'pointer', accentColor: 'var(--accent)' }}
              />
              <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                {allVisibleSelected ? 'Deselect all' : `Select page (${tabPage.length})`}
              </span>
            </div>

            {tabPage.map(c => {
              const s = c.scores
              const rec = s?.recommendation
              const status = getStatus(c)
              const isChecked = selectedIds.has(c.id)
              return (
                <div key={c.id} className="table-row" style={{ cursor: 'default', background: isChecked ? 'var(--accent-d)' : undefined }}>
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggleSelect(c.id)}
                    onClick={e => e.stopPropagation()}
                    style={{ width: 15, height: 15, flexShrink: 0, cursor: 'pointer', accentColor: 'var(--accent)' }}
                  />
                  <div className="col-main" style={{ cursor: 'pointer' }} onClick={() => setSelectedId(c.id)}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div className="profile-avatar" style={{ width: 34, height: 34, fontSize: 14, borderRadius: 'var(--r)', flexShrink: 0 }}>
                        {(c.full_name ?? '?')[0].toUpperCase()}
                      </div>
                      <div>
                        <div className="col-name">
                          {c.full_name}
                          {c.source === 'manually_added' && <span className="badge badge-blue" style={{ fontSize: 9, marginLeft: 6 }}>Manual</span>}
                        </div>
                        <div className="col-sub">{c.candidate_role} · {c.total_years}y exp · {jobName(c.job_id)}</div>
                      </div>
                    </div>
                  </div>
                  <div className="col-right">
                    {c.match_score != null && (
                      <span className="mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>Screen {(c.match_score / 10).toFixed(1)}/10</span>
                    )}
                    {s?.overallScore != null && (
                      <span className="mono" style={{ fontSize: 13, fontWeight: 700, color: dimColor(s.overallScore) }}>{(s.overallScore / 10).toFixed(1)}/10</span>
                    )}
                    {rec && (
                      <span style={{ fontSize: 11, fontWeight: 600, color: REC_COLOR[rec], fontFamily: 'var(--font-mono)' }}>{rec}</span>
                    )}
                    {status === 'Screened Out'      && !s && <span className="badge badge-red">Screened Out</span>}
                    {status === 'Interview Pending' && <span className="badge badge-amber">Interview Pending</span>}
                    {status === 'Pending'           && <span className="badge" style={{ color: 'var(--text-3)', background: 'var(--surface2)' }}>Pending</span>}
                    {c._fromPool && <span className="badge badge-green" style={{ fontSize: 9 }}>Pool</span>}
                    {!c._fromPool && c.match_pass !== null && (
                      <button
                        className="btn btn-secondary"
                        style={{ fontSize: 10, padding: '2px 8px', whiteSpace: 'nowrap', ...(c.shared_with_client ? { color: 'var(--green)', borderColor: 'rgba(42,110,58,0.5)', background: 'var(--green-d)' } : {}) }}
                        onClick={e => { e.stopPropagation(); toggleShareWithClient(c) }}
                        title={c.shared_with_client ? 'Remove from client portal' : 'Share with client'}
                      >
                        {c.shared_with_client ? '✓ Shared' : 'Share'}
                      </button>
                    )}
                    {!c._fromPool && (
                      <button
                        className="btn btn-secondary"
                        style={{ fontSize: 10, padding: '2px 8px', whiteSpace: 'nowrap' }}
                        onClick={e => { e.stopPropagation(); setAllotJobModal({ candidate: c, jobId: '', alloting: false, error: null }) }}
                      >
                        Allot to Job
                      </button>
                    )}
                    <button
                      className="btn btn-ghost"
                      title="Delete candidate"
                      style={{ padding: '2px 6px', fontSize: 14, color: 'var(--red)', opacity: 0.5 }}
                      onClick={e => { e.stopPropagation(); setDeleteModal({ candidate: c }) }}
                    >🗑</button>
                  </div>
                </div>
              )
            })}

            {/* Pagination */}
            {tabTotal > CAND_PAGE_SIZE && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderTop: '1px solid var(--border)' }}>
                <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-3)' }}>
                  {candPage * CAND_PAGE_SIZE + 1}–{Math.min((candPage + 1) * CAND_PAGE_SIZE, tabTotal)} of {tabTotal}
                </span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="btn btn-secondary" style={{ fontSize: 10, padding: '3px 10px' }} disabled={candPage === 0} onClick={() => setCandPage(p => p - 1)}>← Prev</button>
                  <button className="btn btn-secondary" style={{ fontSize: 10, padding: '3px 10px' }} disabled={(candPage + 1) * CAND_PAGE_SIZE >= tabTotal} onClick={() => setCandPage(p => p + 1)}>Next →</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
      )}

      {/* ── Delete Modal ── */}
      {deleteModal && (
        <div style={MO}>
          <div style={MB}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Remove Candidate</div>
              <div style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.6 }}>
                Are you sure you want to remove <strong>{deleteModal.candidate.full_name}</strong>? This cannot be undone.
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setDeleteModal(null)}>Cancel</button>
              <button
                className="btn btn-primary"
                style={{ background: 'var(--red)', borderColor: 'var(--red)' }}
                disabled={deleteModal.deleting}
                onClick={handleDelete}
              >
                {deleteModal.deleting ? <><span className="spinner" style={{ width: 11, height: 11 }} /> Removing…</> : 'Remove'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Add Manually Modal ── */}
      {addManuallyModal && (
        <div style={MO}>
          <div style={{ ...MB, width: 500 }}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>Add Candidate Manually</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div><label style={ML}>Full Name *</label><input autoFocus style={MI} value={addManuallyModal.full_name} onChange={e => setAddManuallyModal(m => ({ ...m, full_name: e.target.value }))} placeholder="Jane Smith" /></div>
              <div><label style={ML}>Email</label><input style={MI} value={addManuallyModal.email} onChange={e => setAddManuallyModal(m => ({ ...m, email: e.target.value }))} placeholder="jane@example.com" /></div>
              <div><label style={ML}>Phone (optional)</label><input style={MI} value={addManuallyModal.phone} onChange={e => setAddManuallyModal(m => ({ ...m, phone: e.target.value }))} placeholder="+91 9876543210" /></div>
              <div><label style={ML}>Current Role</label><input style={MI} value={addManuallyModal.candidate_role} onChange={e => setAddManuallyModal(m => ({ ...m, candidate_role: e.target.value }))} placeholder="Senior Engineer" /></div>
              <div><label style={ML}>Years of Experience</label><input type="number" min={0} style={MI} value={addManuallyModal.total_years} onChange={e => setAddManuallyModal(m => ({ ...m, total_years: e.target.value }))} placeholder="5" /></div>
              <div><label style={ML}>Education (optional)</label><input style={MI} value={addManuallyModal.education} onChange={e => setAddManuallyModal(m => ({ ...m, education: e.target.value }))} placeholder="B.Tech Computer Science" /></div>
              <div style={{ gridColumn: 'span 2' }}><label style={ML}>Skills (comma separated)</label><input style={MI} value={addManuallyModal.skills} onChange={e => setAddManuallyModal(m => ({ ...m, skills: e.target.value }))} placeholder="React, Node.js, TypeScript" /></div>
              <div style={{ gridColumn: 'span 2' }}><label style={ML}>Summary (optional)</label><textarea style={{ ...MI, height: 70, resize: 'vertical' }} value={addManuallyModal.summary} onChange={e => setAddManuallyModal(m => ({ ...m, summary: e.target.value }))} placeholder="Brief professional summary…" /></div>
              <div style={{ gridColumn: 'span 2' }}>
                <label style={ML}>Assign to Job *</label>
                <select style={MI} value={addManuallyModal.jobId} onChange={e => setAddManuallyModal(m => ({ ...m, jobId: e.target.value }))}>
                  <option value="">— select a job —</option>
                  {jobs.map(j => <option key={j.id} value={j.id}>{j.title}</option>)}
                </select>
              </div>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-2)', cursor: 'pointer' }}>
              <input type="checkbox" checked={addManuallyModal.addToPool} onChange={e => setAddManuallyModal(m => ({ ...m, addToPool: e.target.checked }))} />
              Also add to master talent pool
            </label>
            {addManuallyModal.error && <div style={{ fontSize: 12, color: 'var(--red)' }}>⚠ {addManuallyModal.error}</div>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setAddManuallyModal(null)}>Cancel</button>
              <button
                className="btn btn-primary"
                disabled={!addManuallyModal.full_name.trim() || !addManuallyModal.jobId || addManuallyModal.saving}
                onClick={handleAddManually}
              >
                {addManuallyModal.saving ? <><span className="spinner" style={{ width: 11, height: 11 }} /> Saving…</> : 'Add Candidate'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Bulk Delete Modal ── */}
      {bulkDeleteModal && (
        <div style={MO}>
          <div style={MB}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Delete {selectedIds.size} Candidate{selectedIds.size !== 1 ? 's' : ''}?</div>
              <div style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.6 }}>
                This will permanently remove all {selectedIds.size} selected candidate{selectedIds.size !== 1 ? 's' : ''}. This cannot be undone.
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" disabled={bulkDeleteing} onClick={() => setBulkDeleteModal(false)}>Cancel</button>
              <button
                className="btn btn-primary"
                style={{ background: 'var(--red)', borderColor: 'var(--red)' }}
                disabled={bulkDeleteing}
                onClick={handleBulkDelete}
              >
                {bulkDeleteing ? <><span className="spinner" style={{ width: 11, height: 11 }} /> Deleting…</> : `Delete ${selectedIds.size}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Bulk Allot Modal ── */}
      {bulkAllotModal && (
        <div style={MO}>
          <div style={MB}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Allot {selectedIds.size} Candidate{selectedIds.size !== 1 ? 's' : ''} to Job</div>
              <div style={{ fontSize: 13, color: 'var(--text-3)', lineHeight: 1.6 }}>
                A copy of each selected candidate will be added to the chosen job.
              </div>
            </div>
            <div>
              <label style={ML}>Select Job</label>
              <select style={MI} value={bulkAllotJobId} onChange={e => setBulkAllotJobId(e.target.value)}>
                <option value="">— select a job —</option>
                {jobs.map(j => <option key={j.id} value={j.id}>{j.title}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" disabled={bulkAlloting} onClick={() => { setBulkAllotModal(false); setBulkAllotJobId('') }}>Cancel</button>
              <button
                className="btn btn-primary"
                disabled={!bulkAllotJobId || bulkAlloting}
                onClick={handleBulkAllot}
              >
                {bulkAlloting ? <><span className="spinner" style={{ width: 11, height: 11 }} /> Allotting…</> : `Allot ${selectedIds.size}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Allot to Job Modal ── */}
      {allotJobModal && (
        <div style={MO}>
          <div style={MB}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Allot to Job</div>
              <div style={{ fontSize: 13, color: 'var(--text-3)' }}>
                {allotJobModal.candidate.full_name} · currently in: <em>{jobName(allotJobModal.candidate.job_id)}</em>
              </div>
            </div>
            <div>
              <label style={ML}>Select Job</label>
              <select
                style={MI}
                value={allotJobModal.jobId}
                onChange={e => setAllotJobModal(m => ({ ...m, jobId: e.target.value }))}
              >
                <option value="">— select a job —</option>
                {jobs.filter(j => j.id !== allotJobModal.candidate.job_id).map(j => (
                  <option key={j.id} value={j.id}>{j.title}</option>
                ))}
              </select>
            </div>
            {allotJobModal.error && <div style={{ fontSize: 12, color: 'var(--red)' }}>⚠ {allotJobModal.error}</div>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setAllotJobModal(null)}>Cancel</button>
              <button
                className="btn btn-primary"
                disabled={!allotJobModal.jobId || allotJobModal.alloting}
                onClick={handleAllotToJob}
              >
                {allotJobModal.alloting ? <><span className="spinner" style={{ width: 11, height: 11 }} /> Allotting…</> : 'Allot to Job'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
