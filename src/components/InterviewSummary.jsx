import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { scoreVideoInterview } from '../utils/api'
import { getVideoInterviewTranscript } from '../utils/interviewTranscript'
import { fetchDevInterviewTranscript } from '../utils/interviewMarkdown'

function scoreColor(n) {
  if (n >= 7) return 'var(--green)'
  if (n >= 5) return 'var(--amber)'
  return 'var(--red)'
}

export default function InterviewSummary({ candidate, job, isFromPool, onClose, onScored }) {
  const [messages, setMessages] = useState([])
  const [devSource, setDevSource] = useState(null)
  const [interviewRole, setInterviewRole] = useState(null)
  const [loadingTranscript, setLoadingTranscript] = useState(true)
  const [videoScore, setVideoScore] = useState(candidate?.scores?.videoInterview ?? null)
  const [scoring, setScoring] = useState(false)
  const [scoreError, setScoreError] = useState(null)
  const mono = { fontFamily: 'var(--font-mono)' }

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoadingTranscript(true)
      let msgs = getVideoInterviewTranscript(candidate)
      let source = null
      let role = job?.title ?? null
      if (!msgs.length && import.meta.env.DEV && job?.title) {
        const dev = await fetchDevInterviewTranscript(candidate.full_name, job.title)
        if (dev?.messages?.length) {
          msgs = dev.messages
          source = dev.path
          role = dev.role ?? job.title
        }
      }
      if (!cancelled) {
        setMessages(msgs)
        setDevSource(source)
        setInterviewRole(role)
        setLoadingTranscript(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [candidate, job?.title, job?.id])

  const runScore = useCallback(async () => {
    if (!job || !messages.length) return
    setScoring(true)
    setScoreError(null)
    try {
      const result = await scoreVideoInterview(candidate, job, messages)
      const videoInterview = { ...result, scoredAt: new Date().toISOString() }
      const mergedScores = { ...(candidate.scores ?? {}), videoInterview }
      const table = isFromPool ? 'job_matches' : 'candidates'
      const { error } = await supabase.from(table).update({ scores: mergedScores }).eq('id', candidate.id)
      if (error) throw new Error(error.message)
      setVideoScore(videoInterview)
      onScored?.({ ...candidate, scores: mergedScores })
    } catch (e) {
      setScoreError(e.message)
    } finally {
      setScoring(false)
    }
  }, [candidate, job, messages, isFromPool, onScored])

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2100, padding: 20 }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{ background: 'var(--surface)', borderRadius: 14, width: '100%', maxWidth: 680, maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '18px 24px', borderBottom: '1px solid var(--border2)', gap: 16 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, ...mono, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-3)', marginBottom: 4 }}>Interview Transcript</div>
            <div style={{ fontSize: 17, fontWeight: 500 }}>{candidate.full_name}</div>
            {interviewRole && (
              <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 4 }}>
                Interview for: <strong>{interviewRole}</strong>
              </div>
            )}
            {candidate.candidate_role && candidate.candidate_role !== interviewRole && (
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>CV role: {candidate.candidate_role}</div>
            )}
            {devSource && (
              <div style={{ fontSize: 10, ...mono, color: 'var(--accent)', marginTop: 6 }}>Loaded from {devSource}</div>
            )}
          </div>
          {videoScore?.overallScore != null && (
            <div style={{ textAlign: 'center', padding: '8px 16px', background: 'var(--bg)', borderRadius: 10, border: `1px solid ${scoreColor(videoScore.overallScore)}44` }}>
              <div style={{ fontSize: 28, fontWeight: 700, color: scoreColor(videoScore.overallScore), lineHeight: 1 }}>
                {Number(videoScore.overallScore).toFixed(1)}
              </div>
              <div style={{ fontSize: 10, ...mono, color: 'var(--text-3)' }}>/ 10</div>
              {videoScore.recommendation && (
                <div style={{ fontSize: 10, ...mono, color: scoreColor(videoScore.overallScore), marginTop: 4 }}>{videoScore.recommendation}</div>
              )}
            </div>
          )}
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 22, color: 'var(--text-3)' }}>✕</button>
        </div>

        {videoScore?.summary && (
          <div style={{ padding: '14px 24px', background: 'var(--bg)', borderBottom: '1px solid var(--border2)', fontSize: 13, color: 'var(--text-2)', lineHeight: 1.65 }}>
            <strong style={{ ...mono, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-3)' }}>AI analysis — </strong>
            {videoScore.summary}
          </div>
        )}

        {loadingTranscript ? (
          <div style={{ padding: 48, textAlign: 'center' }}><span className="spinner" style={{ width: 28, height: 28 }} /></div>
        ) : messages.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>
            No transcript found{job?.title ? ` for ${job.title}` : ''}. Complete a video interview for this role first.
          </div>
        ) : (
          <div className="transcript-wrap" style={{ margin: 20, flex: 1, maxHeight: '50vh' }}>
            {messages.map((msg, i) => (
              <div key={i} className={`bubble ${msg.role === 'assistant' || msg.role === 'interviewer' ? 'assistant' : 'user'}`}>
                <div className="bubble-who">
                  {msg.role === 'assistant' || msg.role === 'interviewer' ? 'Question' : 'Candidate'}
                </div>
                <div className="bubble-body">{msg.content}</div>
              </div>
            ))}
          </div>
        )}

        <div style={{ padding: '14px 24px 20px', borderTop: '1px solid var(--border2)', display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 11, ...mono, color: 'var(--text-3)' }}>
            Speech-to-text transcript · scored by AI (Claude)
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {!videoScore?.overallScore && messages.length > 0 && job && (
              <button type="button" className="btn btn-primary" disabled={scoring} onClick={runScore} style={{ fontSize: 12 }}>
                {scoring ? <><span className="spinner" style={{ width: 11, height: 11 }} /> Scoring…</> : '✦ AI Score Interview'}
              </button>
            )}
            {videoScore?.overallScore && (
              <button type="button" className="btn btn-secondary" disabled={scoring} onClick={runScore} style={{ fontSize: 12 }}>
                {scoring ? 'Re-scoring…' : '↻ Re-score'}
              </button>
            )}
            <button type="button" className="btn btn-secondary" onClick={onClose} style={{ fontSize: 12 }}>Close</button>
          </div>
        </div>
        {scoreError && (
          <div style={{ padding: '0 24px 16px', fontSize: 12, color: 'var(--red)', lineHeight: 1.6 }}>
            <div>⚠ {scoreError}</div>
            {scoreError.includes('AI service error') || scoreError.includes('not configured') ? (
              <div style={{ marginTop: 8, color: 'var(--text-3)', fontSize: 11 }}>
                Fix: Supabase Dashboard → Edge Functions → Secrets → set <code>ANTHROPIC_API_KEY</code>, then run{' '}
                <code>npx supabase functions deploy call-claude</code>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}
