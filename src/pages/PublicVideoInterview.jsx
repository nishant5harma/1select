import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import VideoInterview from '../components/VideoInterview'

export default function PublicVideoInterview() {
  const { token } = useParams()
  const [data, setData] = useState(null)      // { candidate, job, table }
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [showInterview, setShowInterview] = useState(false)
  const [resendState, setResendState] = useState('idle') // 'idle' | 'sending' | 'sent' | 'error'
  const [withdrawState, setWithdrawState] = useState('idle') // 'idle' | 'confirm' | 'withdrawing' | 'withdrawn'

  useEffect(() => { load() }, [token])

  function applySession(json) {
    const vUrls = json.video_urls ?? []
    const allDone = vUrls.length > 0 && vUrls.every(v => v?.url != null)
    if (allDone) { setDone(true); return true }

    if (json.interview_token_expires_at && new Date(json.interview_token_expires_at) < new Date()) {
      setError(`expired:${new Date(json.interview_token_expires_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`)
      return true
    }

    const payload = { candidate: json.candidate, job: json.job, table: json.table }
    if (vUrls.length > 0) {
      payload.partialCount = vUrls.filter(v => v?.url != null).length
      payload.totalCount = vUrls.length
    }
    setData(payload)
    return true
  }

  async function loadFromEdge() {
    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-interview-session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ token }),
    })
    const json = await res.json().catch(() => ({}))
    if (res.status === 404) {
      if (json?.error) { setError(json.error); return true }
      return false // edge function not deployed — fall back to direct query
    }
    if (!res.ok) {
      setError(json.error ?? 'Invalid or expired interview link.')
      return true
    }
    return applySession(json)
  }

  async function loadFromDirect() {
    const { data: cRow } = await supabase
      .from('candidates')
      .select('*, jobs(*)')
      .eq('interview_invite_token', token)
      .maybeSingle()

    if (cRow) {
      return applySession({
        candidate: cRow,
        job: cRow.jobs,
        table: 'candidates',
        video_urls: cRow.video_urls ?? [],
        interview_token_expires_at: cRow.interview_token_expires_at,
      })
    }

    const { data: mRow } = await supabase
      .from('job_matches')
      .select('*, talent_pool(*), jobs(*)')
      .eq('interview_invite_token', token)
      .maybeSingle()

    if (mRow) {
      return applySession({
        candidate: {
          id: mRow.id,
          full_name: mRow.talent_pool?.full_name ?? '',
          candidate_role: mRow.talent_pool?.candidate_role ?? '',
          email: mRow.talent_pool?.email ?? '',
        },
        job: mRow.jobs,
        table: 'job_matches',
        video_urls: mRow.video_urls ?? [],
        interview_token_expires_at: mRow.interview_token_expires_at,
      })
    }

    setError('Invalid or expired interview link.')
    return true
  }

  async function load() {
    setLoading(true)
    setError('')

    try {
      const handled = await loadFromEdge()
      if (!handled) await loadFromDirect()
    } catch {
      try {
        await loadFromDirect()
      } catch {
        setError('Could not load interview. Please check your connection and try again.')
      }
    }
    setLoading(false)
  }

  async function handleSave(update) {
    const { error } = await supabase.functions.invoke('save-interview-recording', {
      body: { token, table: data.table, ...update },
    })
    if (error) throw new Error(error.message ?? 'Failed to save recording') // fix: propagate save errors so VideoInterview can surface them
  }

  function handleComplete() {
    setShowInterview(false)
    setDone(true)
  }

  if (loading) {
    return (
      <div style={pageStyle}>
        <span className="spinner" style={{ width: 36, height: 36 }} />
      </div>
    )
  }

  async function requestNewLink() {
    setResendState('sending')
    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/resend-interview-invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY },
        body: JSON.stringify({ token }),
      })
      const json = await res.json()
      setResendState(json.success ? 'sent' : 'error')
    } catch {
      setResendState('error')
    }
  }

  async function handleWithdraw() {
    setWithdrawState('withdrawing')
    const now = new Date().toISOString()
    const update = { withdrawn_at: now, interview_invite_token: null }
    if (data?.table === 'candidates') {
      await supabase.from('candidates').update(update).eq('id', data.candidate.id)
    } else if (data?.table === 'job_matches') {
      await supabase.from('job_matches').update(update).eq('id', data.candidate.id)
    }
    setWithdrawState('withdrawn')
  }

  if (withdrawState === 'withdrawn') {
    return (
      <div style={pageStyle}>
        <div style={{ textAlign: 'center', maxWidth: 440, padding: '0 24px' }}>
          <div style={{ fontSize: 36, marginBottom: 16, opacity: 0.3 }}>✓</div>
          <h2 style={{ fontFamily: 'var(--font-head)', fontWeight: 300, marginBottom: 8 }}>Application withdrawn</h2>
          <p style={{ color: 'var(--text-3)', fontSize: 14, lineHeight: 1.7 }}>
            Your application has been withdrawn. Your personal data will be processed in accordance with our data retention policy.
          </p>
          <p style={{ color: 'var(--text-3)', fontSize: 13, marginTop: 20 }}>You may close this window.</p>
        </div>
      </div>
    )
  }

  if (error) {
    const isExpired = error.startsWith('expired:')
    const expiryDate = isExpired ? error.replace('expired:', '') : null
    return (
      <div style={pageStyle}>
        <div style={{ textAlign: 'center', maxWidth: 440, padding: '0 24px' }}>
          <div style={{ fontSize: 36, marginBottom: 16, opacity: 0.3 }}>{isExpired ? '⏱' : '◈'}</div>
          <h2 style={{ fontFamily: 'var(--font-head)', fontWeight: 300, marginBottom: 8 }}>
            {isExpired ? 'This link has expired' : 'Link not found'}
          </h2>
          <p style={{ color: 'var(--text-3)', fontSize: 14, lineHeight: 1.7 }}>
            {isExpired
              ? <>This interview link expired on <strong>{expiryDate}</strong>.</>
              : 'This interview link is invalid. Please check the link in your email or contact your recruiter.'}
          </p>
          {isExpired && resendState === 'idle' && (
            <button
              onClick={requestNewLink}
              style={{ marginTop: 20, padding: '10px 28px', background: '#B8924A', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontFamily: 'var(--font-mono)', letterSpacing: '0.06em', textTransform: 'uppercase' }}
            >
              Request New Link
            </button>
          )}
          {isExpired && resendState === 'sending' && (
            <div style={{ marginTop: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: 'var(--text-3)', fontSize: 13 }}>
              <span className="spinner" style={{ width: 14, height: 14 }} /> Sending…
            </div>
          )}
          {isExpired && resendState === 'sent' && (
            <p style={{ marginTop: 20, color: 'var(--green)', fontSize: 13, lineHeight: 1.6 }}>
              A new link has been sent to your email address. Check your inbox (and spam folder).
            </p>
          )}
          {isExpired && resendState === 'error' && (
            <div style={{ marginTop: 20 }}>
              <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>
                Something went wrong. Please contact your recruiter directly.
              </p>
              <button
                onClick={() => setResendState('idle')}
                style={{ padding: '8px 20px', background: 'transparent', color: 'var(--text-3)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer', fontSize: 12 }}
              >
                Try again
              </button>
            </div>
          )}
        </div>
      </div>
    )
  }

  if (done) {
    return (
      <div style={pageStyle}>
        <div style={{ maxWidth: 480, width: '100%', padding: '0 24px', textAlign: 'center' }}>
          <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'rgba(34,197,94,0.1)', border: '2px solid rgba(34,197,94,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px', fontSize: 26, color: 'var(--green)' }}>✓</div>
          <h2 style={{ fontFamily: 'var(--font-head)', fontWeight: 300, marginBottom: 8 }}>Interview submitted</h2>
          <p style={{ color: 'var(--text-3)', fontSize: 14, lineHeight: 1.7, marginBottom: 24 }}>
            Your responses have been recorded and sent to the recruitment team.
          </p>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '18px 20px', textAlign: 'left', marginBottom: 20 }}>
            <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-3)', marginBottom: 12 }}>What happens next</div>
            {[
              'A recruiter reviews your responses within 2 business days',
              "You'll receive an email update regardless of the outcome",
              'If progressed, the recruiter will be in touch to discuss next steps',
            ].map((s, i) => (
              <div key={i} style={{ display: 'flex', gap: 10, marginBottom: i < 2 ? 10 : 0 }}>
                <div style={{ width: 18, height: 18, borderRadius: '50%', background: 'rgba(184,146,74,0.15)', border: '1px solid rgba(184,146,74,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 10, fontFamily: 'var(--font-mono)', color: '#B8924A' }}>{i + 1}</div>
                <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.6 }}>{s}</div>
              </div>
            ))}
          </div>
          <p style={{ color: 'var(--text-3)', fontSize: 12 }}>
            Questions? Email <a href="mailto:candidates@oneselect.co.uk" style={{ color: 'var(--accent)', textDecoration: 'none' }}>candidates@oneselect.co.uk</a>
          </p>
          <p style={{ color: 'var(--text-3)', fontSize: 11, marginTop: 16 }}>You may close this window.</p>
        </div>
      </div>
    )
  }

  if (showInterview) {
    return (
      <VideoInterview
        job={data.job}
        candidate={data.candidate}
        matchId={data.candidate.id}
        isFromPool={data.table === 'job_matches'}
        onSave={handleSave}
        onClose={() => setShowInterview(false)}
        onComplete={handleComplete}
      />
    )
  }

  return (
    <div style={pageStyle}>
      <div style={{ maxWidth: 520, width: '100%', padding: '0 24px' }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <h1 style={{ fontFamily: 'var(--font-head)', fontWeight: 300, letterSpacing: '0.15em', color: '#B8924A', marginBottom: 6, fontSize: 22 }}>ONE SELECT</h1>
          <p style={{ color: 'var(--text-3)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.15em' }}>AI Video Interview</p>
        </div>

        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '32px 28px' }}>
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-3)', marginBottom: 6 }}>You're invited to interview for</div>
            <h2 style={{ fontSize: 20, fontWeight: 500, margin: '0 0 4px' }}>{data.job?.title}</h2>
            <p style={{ color: 'var(--text-3)', fontSize: 14, margin: 0 }}>Hi {data.candidate.full_name} — your video interview is ready.</p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 28 }}>
            {[
              ['5 questions', 'Mix of technical and behavioural — generated for this role'],
              ['90–120 seconds', 'Per question, with a visible countdown timer'],
              ['One take', 'No pausing or re-recording'],
              ['Stay in window', 'Tab switches and focus loss are flagged'],
            ].map(([title, desc]) => (
              <div key={title} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#B8924A', marginTop: 6, flexShrink: 0 }} />
                <div>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{title}</span>
                  <span style={{ fontSize: 13, color: 'var(--text-3)' }}> — {desc}</span>
                </div>
              </div>
            ))}
          </div>

          {data.partialCount != null && (
            <div style={{ marginBottom: 16, padding: '10px 14px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 6, fontSize: 12, color: '#fca5a5', lineHeight: 1.6 }}>
              <strong>Your last session had upload errors</strong> ({data.partialCount} of {data.totalCount} answers saved).
              Starting again will replace your previous responses.
            </div>
          )}

          <button
            onClick={() => setShowInterview(true)}
            style={{ width: '100%', padding: '14px 0', background: '#B8924A', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 14, fontFamily: 'var(--font-mono)', letterSpacing: '0.06em', textTransform: 'uppercase' }}
          >
            {data.partialCount != null ? 'Retry Interview →' : 'Start Interview →'}
          </button>

          {withdrawState === 'idle' && (
            <button
              onClick={() => setWithdrawState('confirm')}
              style={{ width: '100%', marginTop: 10, padding: '8px 0', background: 'transparent', color: 'var(--text-3)', border: 'none', cursor: 'pointer', fontSize: 12, textDecoration: 'underline' }}
            >
              Withdraw my application
            </button>
          )}
          {withdrawState === 'confirm' && (
            <div style={{ marginTop: 12, padding: '14px 16px', background: 'var(--surface2)', borderRadius: 8, textAlign: 'center' }}>
              <p style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 12 }}>Are you sure you want to withdraw your application? This cannot be undone.</p>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                <button onClick={() => setWithdrawState('idle')} style={{ padding: '7px 16px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>Cancel</button>
                <button onClick={handleWithdraw} style={{ padding: '7px 16px', background: 'var(--red)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>Withdraw</button>
              </div>
            </div>
          )}
          {withdrawState === 'withdrawing' && (
            <div style={{ marginTop: 10, textAlign: 'center', fontSize: 12, color: 'var(--text-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <span className="spinner" style={{ width: 12, height: 12 }} /> Withdrawing…
            </div>
          )}
        </div>

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
