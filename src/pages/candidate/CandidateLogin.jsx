import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

export default function CandidateLogin() {
  const [mode, setMode]         = useState('login') // fix: add forgot-password mode
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [info, setInfo]         = useState('')
  const [loading, setLoading]   = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    supabase.auth.signOut({ scope: 'local' }).catch(() => {})
  }, [])

  async function handleSignIn(e) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const { data, error: authErr } = await supabase.auth.signInWithPassword({ email, password })
    if (authErr) {
      setError('Invalid email or password.')
      setLoading(false)
      return
    }

    const { data: profile, error: profileErr } = await supabase.from('profiles').select('user_role').eq('id', data.user.id).single()
    if (profileErr || !profile) {
      await supabase.auth.signOut()
      setError('Could not load your account. Please try again.')
      setLoading(false)
      return
    }
    if (profile.user_role !== 'candidate') {
      await supabase.auth.signOut()
      setError('This account is not a candidate account. Use the main login page instead.')
      setLoading(false)
      return
    }

    navigate('/candidate/dashboard', { replace: true })
    setLoading(false)
  }

  // fix: forgot password — sends Supabase reset email; reset form lives on /login (handles all roles)
  async function handleForgot(e) {
    e.preventDefault()
    if (!email.trim()) { setError('Please enter your email address'); return }
    setError(''); setLoading(true)
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: window.location.origin + '/login',
    })
    setLoading(false)
    if (resetError) { setError('Could not send reset email. Please try again.'); return }
    setInfo(`Reset link sent to ${email.trim()}. Check your inbox and click the link to set a new password.`)
  }

  return (
    <div className="login-screen">
      <div className="login-panel-left">
        <p className="login-tagline-label">Talent Network</p>
        <div className="login-divider" />
        <p className="login-quote">Find your next role. We match you to the right opportunities.</p>
      </div>

      <div className="login-panel-right">
        <div className="login-form-wrap">
          <img src="/oneselect-logo.png" alt="One Select" style={{ width: 200, height: 'auto', objectFit: 'contain', marginBottom: 36, display: 'block' }} />

          <h2 className="login-welcome">Welcome back</h2>
          <p className="login-sub">Sign in to see your matches and interview status</p>

          {/* ── Sign in ── */}
          {mode === 'login' && (
            <>
              {error && <div className="error-banner">{error}</div>}

              <form className="login-form" onSubmit={handleSignIn}>
                <div className="field">
                  <label>Email</label>
                  <input type="email" required autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" />
                </div>
                <div className="field">
                  <label>Password</label>
                  <input type="password" required autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" />
                </div>
                <button type="submit" className="btn btn-primary" disabled={loading}>
                  {loading ? <><span className="spinner" style={{ width: 13, height: 13 }} /> Signing in…</> : 'Sign in'}
                </button>
              </form>

              <button
                onClick={() => { setMode('forgot'); setError(''); setInfo('') }}
                style={{ marginTop: 16, background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--text-3)', textDecoration: 'underline', padding: 0 }}
              >
                Forgot password?
              </button>
              <p style={{ marginTop: 20, fontSize: 13, color: 'var(--text-3)', textAlign: 'center' }}>
                New here?{' '}
                <Link to="/candidate/register" style={{ color: 'var(--accent)', textDecoration: 'none' }}>Create your profile →</Link>
              </p>
              <p style={{ marginTop: 10, fontSize: 12, color: 'var(--text-3)', textAlign: 'center' }}>
                Recruiter or admin?{' '}
                <Link to="/login" style={{ color: 'var(--text-3)' }}>Sign in here</Link>
              </p>
            </>
          )}

          {/* ── Forgot password ── */}
          {mode === 'forgot' && (
            <>
              <h2 className="login-welcome">Reset Password</h2>
              <p className="login-sub">Enter your email and we'll send a reset link</p>

              {error && <div className="error-banner">{error}</div>}
              {info  && <div className="error-banner" style={{ background: 'var(--green-d)', borderColor: 'var(--green)', color: 'var(--green)' }}>{info}</div>}

              {!info && (
                <form className="login-form" onSubmit={handleForgot}>
                  <div className="field">
                    <label>Email</label>
                    <input type="email" required autoFocus autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" />
                  </div>
                  <button type="submit" className="btn btn-primary" disabled={loading}>
                    {loading ? <><span className="spinner" style={{ width: 13, height: 13 }} /> Sending…</> : 'Send Reset Link'}
                  </button>
                </form>
              )}

              <button
                onClick={() => { setMode('login'); setError(''); setInfo('') }}
                style={{ marginTop: 16, background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--text-3)', textDecoration: 'underline', padding: 0 }}
              >
                ← Back to sign in
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
