import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function PublicAssessment() {
  const { token } = useParams()
  const [row, setRow]         = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [answers, setAnswers] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone]       = useState(false)

  useEffect(() => { load() }, [token])

  async function load() {
    setLoading(true)
    const { data, error: err } = await supabase
      .from('assessment_tokens')
      .select('*, candidates(full_name, email), jobs(title)')
      .eq('token', token)
      .maybeSingle()

    if (err || !data) {
      setError('This assessment link is invalid.')
      setLoading(false)
      return
    }
    if (data.submitted_at) {
      setDone(true)
      setLoading(false)
      return
    }
    if (data.expires_at && new Date(data.expires_at) < new Date()) {
      setError('expired')
      setLoading(false)
      return
    }
    setRow(data)
    const initial = {}
    ;(data.questions ?? []).forEach(q => { initial[q.id] = '' })
    setAnswers(initial)
    setLoading(false)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const questions = row.questions ?? []
    const allAnswered = questions.every(q => (answers[q.id] ?? '').trim().length > 0)
    if (!allAnswered) return

    setSubmitting(true)
    const { error: err } = await supabase
      .from('assessment_tokens')
      .update({ answers, submitted_at: new Date().toISOString() })
      .eq('token', token)

    if (err) {
      setSubmitting(false)
      setError('Submission failed — please try again.')
      return
    }
    setSubmitting(false) // fix: reset submitting state on success path so button re-enables
    setDone(true)
  }

  if (loading) {
    return (
      <div style={pageStyle}>
        <span className="spinner" style={{ width: 36, height: 36 }} />
      </div>
    )
  }

  if (error === 'expired') {
    return (
      <div style={pageStyle}>
        <div style={{ textAlign: 'center', maxWidth: 440, padding: '0 24px' }}>
          <div style={{ fontSize: 36, marginBottom: 16, opacity: 0.3 }}>⏱</div>
          <h2 style={{ fontFamily: 'var(--font-head)', fontWeight: 300, marginBottom: 8 }}>Assessment link expired</h2>
          <p style={{ color: 'var(--text-3)', fontSize: 14, lineHeight: 1.7 }}>
            This assessment link has expired. Please contact your recruiter to request a new link.
          </p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div style={pageStyle}>
        <div style={{ textAlign: 'center', maxWidth: 440, padding: '0 24px' }}>
          <div style={{ fontSize: 36, marginBottom: 16, opacity: 0.3 }}>◈</div>
          <h2 style={{ fontFamily: 'var(--font-head)', fontWeight: 300, marginBottom: 8 }}>Link not found</h2>
          <p style={{ color: 'var(--text-3)', fontSize: 14, lineHeight: 1.7 }}>{error}</p>
        </div>
      </div>
    )
  }

  if (done) {
    return (
      <div style={pageStyle}>
        <div style={{ textAlign: 'center', maxWidth: 480, padding: '0 24px' }}>
          <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'rgba(34,197,94,0.1)', border: '2px solid rgba(34,197,94,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px', fontSize: 26, color: 'var(--green)' }}>✓</div>
          <h2 style={{ fontFamily: 'var(--font-head)', fontWeight: 300, marginBottom: 8 }}>Assessment submitted</h2>
          <p style={{ color: 'var(--text-3)', fontSize: 14, lineHeight: 1.7 }}>
            Your answers have been received. Our team will review them and be in touch soon.
          </p>
          <p style={{ color: 'var(--text-3)', fontSize: 13, marginTop: 24 }}>You may close this window.</p>
        </div>
      </div>
    )
  }

  const questions = row?.questions ?? []
  const candidateName = row?.candidates?.full_name ?? ''
  const jobTitle      = row?.jobs?.title ?? ''

  return (
    <div style={{ ...pageStyle, alignItems: 'flex-start', overflowY: 'auto', paddingTop: 40, paddingBottom: 40 }}>
      <div style={{ maxWidth: 640, width: '100%', padding: '0 24px', margin: '0 auto' }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <h1 style={{ fontFamily: 'var(--font-head)', fontWeight: 300, letterSpacing: '0.15em', color: '#B8924A', marginBottom: 6, fontSize: 22 }}>ONE SELECT</h1>
          <p style={{ color: 'var(--text-3)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.15em' }}>Written Assessment</p>
        </div>

        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '28px', marginBottom: 24 }}>
          <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-3)', marginBottom: 4 }}>
            Assessment for
          </div>
          <h2 style={{ fontSize: 18, fontWeight: 500, margin: '0 0 4px' }}>{jobTitle}</h2>
          <p style={{ color: 'var(--text-3)', fontSize: 14, margin: 0 }}>Hi {candidateName} — please answer all questions below.</p>
        </div>

        <form onSubmit={handleSubmit}>
          {questions.map((q, idx) => (
            <div key={q.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '24px', marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', marginBottom: 8 }}>
                Question {idx + 1} of {questions.length}
                {q.type && <span style={{ marginLeft: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>· {q.type}</span>}
              </div>
              <p style={{ fontSize: 15, fontWeight: 500, margin: '0 0 16px', lineHeight: 1.6 }}>{q.question}</p>
              <textarea
                rows={5}
                required
                value={answers[q.id] ?? ''}
                onChange={e => setAnswers(prev => ({ ...prev, [q.id]: e.target.value }))}
                placeholder="Type your answer here…"
                style={{
                  width: '100%', padding: '12px 14px',
                  border: '1px solid var(--border)', background: 'var(--bg)',
                  color: 'var(--text)', fontSize: 14, lineHeight: 1.7,
                  resize: 'vertical', boxSizing: 'border-box',
                  fontFamily: 'var(--font-body)', borderRadius: 4,
                }}
              />
            </div>
          ))}

          {error && <div style={{ fontSize: 13, color: 'var(--red)', marginBottom: 16 }}>{error}</div>}

          <button
            type="submit"
            disabled={submitting || questions.some(q => !(answers[q.id] ?? '').trim())}
            style={{
              width: '100%', padding: '14px 0',
              background: '#B8924A', color: '#fff',
              border: 'none', borderRadius: 8,
              cursor: submitting ? 'default' : 'pointer',
              fontSize: 14, fontFamily: 'var(--font-mono)',
              letterSpacing: '0.06em', textTransform: 'uppercase',
              opacity: submitting ? 0.7 : 1,
            }}
          >
            {submitting ? 'Submitting…' : 'Submit Assessment →'}
          </button>
        </form>

        <p style={{ textAlign: 'center', color: 'var(--text-3)', fontSize: 11, marginTop: 20, letterSpacing: '0.06em' }}>
          ONE SELECT — STRATEGIC TALENT SOLUTIONS
        </p>
      </div>
    </div>
  )
}

const pageStyle = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'var(--bg)',
  color: 'var(--text)',
  fontFamily: 'var(--font-body)',
}
