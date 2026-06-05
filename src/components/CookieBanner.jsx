import { useState, useEffect } from 'react'

export default function CookieBanner() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!localStorage.getItem('cookie_consent')) setVisible(true)
  }, [])

  function accept() {
    localStorage.setItem('cookie_consent', 'accepted')
    setVisible(false)
  }

  function decline() {
    localStorage.setItem('cookie_consent', 'declined')
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div style={{
      position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 9999,
      background: 'var(--navy-surface)', borderTop: '1px solid var(--navy-border)',
      display: 'flex', alignItems: 'center', gap: 16,
      padding: '12px 32px',
      fontFamily: 'var(--font-body)', fontSize: 13, color: '#E8E4DC',
    }}>
      <span style={{ flex: 1, lineHeight: 1.6 }}>
        We use essential cookies to keep you signed in. No tracking or analytics cookies are used without your consent.{' '}
        <a href="/privacy" style={{ color: 'var(--accent)', textDecoration: 'none' }}>Privacy policy</a>
      </span>
      <button className="btn btn-secondary" style={{ fontSize: 11, padding: '5px 14px', whiteSpace: 'nowrap', color: '#9AA8C8', background: 'transparent', border: '1px solid #2A3050' }} onClick={decline}>
        Decline
      </button>
      <button className="btn btn-primary" style={{ fontSize: 11, padding: '5px 14px', whiteSpace: 'nowrap' }} onClick={accept}>
        Accept
      </button>
    </div>
  )
}
