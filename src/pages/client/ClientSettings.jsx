import { useState, useEffect } from 'react'
import { useAuth } from '../../lib/AuthContext'
import { supabase } from '../../lib/supabase'
import { usePlan } from '../../hooks/usePlan'
import PaidFeature from '../../components/PaidFeature'

function subLabel(st) {
  if (st === 'active')    return { label: 'Active',    cls: 'badge-green' }
  if (st === 'suspended') return { label: 'Suspended', cls: 'badge-red'   }
  return                         { label: 'Trial',     cls: 'badge-amber' }
}

const DEFAULT_NOTIF = { shortlisted: true, interview_complete: true, approval_reminder: true, weekly_digest: true }

export default function ClientSettings() {
  const { user, profile, isStakeholder } = useAuth()
  const { canAccess } = usePlan()
  const [plan, setPlan] = useState(null)

  // Stakeholder invite state (only rendered for non-stakeholders)
  const [stakeholders,     setStakeholders]     = useState([])
  const [inviteEmail,      setInviteEmail]      = useState('')
  const [inviteName,       setInviteName]       = useState('')
  const [inviting,         setInviting]         = useState(false)
  const [inviteMsg,        setInviteMsg]        = useState('')

  useEffect(() => {
    if (!isStakeholder && user?.id) loadStakeholders()
  }, [user?.id, isStakeholder])

  async function loadStakeholders() {
    const { data } = await supabase
      .from('profiles')
      .select('id, full_name, email, created_at')
      .eq('stakeholder_of', user.id)
      .order('created_at', { ascending: false })
    setStakeholders(data ?? [])
  }

  async function inviteStakeholder(e) {
    e.preventDefault()
    if (!inviteEmail.trim()) return
    setInviting(true); setInviteMsg('')
    const { data: sessionData } = await supabase.auth.getSession()
    const session = sessionData?.session
    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/invite-stakeholder`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${session?.access_token ?? import.meta.env.VITE_SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({
        email:          inviteEmail.trim(),
        name:           inviteName.trim() || inviteEmail.split('@')[0],
        stakeholder_of: user.id,
      }),
    })
    const result = await res.json()
    if (!res.ok || result.error) {
      setInviteMsg(`Error: ${result.error ?? 'Invite failed'}`)
    } else {
      setInviteMsg(`Invite sent to ${inviteEmail.trim()}`)
      setInviteEmail(''); setInviteName('')
      loadStakeholders()
    }
    setInviting(false)
  }

  async function removeStakeholder(id) {
    await supabase.from('profiles').delete().eq('id', id)
    setStakeholders(prev => prev.filter(s => s.id !== id))
  }

  useEffect(() => {
    if (profile?.plan_id) {
      supabase.from('plans').select('*').eq('id', profile.plan_id).single()
        .then(({ data }) => setPlan(data ?? null))
    }
  }, [profile?.plan_id])
  const [saving,      setSaving]      = useState(false)
  const [saved,       setSaved]       = useState(false)
  const [notifPrefs,  setNotifPrefs]  = useState({ ...DEFAULT_NOTIF, ...(profile?.notification_prefs ?? {}) })
  const [notifSaving, setNotifSaving] = useState(false)
  const [notifSaved,  setNotifSaved]  = useState(false)
  const [fullName,    setFullName]    = useState(profile?.full_name    ?? '')
  const [jobTitle,    setJobTitle]    = useState(profile?.job_title    ?? '')
  const [phone,       setPhone]       = useState(profile?.phone        ?? '')
  const [companyName, setCompanyName] = useState(profile?.company_name ?? '')
  const [webhookUrl,  setWebhookUrl]  = useState(profile?.webhook_url ?? '')
  const [webhookSaving,  setWebhookSaving]  = useState(false)
  const [webhookSaved,   setWebhookSaved]   = useState(false)
  const [webhookTesting, setWebhookTesting] = useState(false)
  const [webhookTestMsg, setWebhookTestMsg] = useState('')

  async function saveNotifPrefs() {
    setNotifSaving(true); setNotifSaved(false)
    await supabase.from('profiles').update({ notification_prefs: notifPrefs }).eq('id', user.id)
    setNotifSaving(false); setNotifSaved(true)
    setTimeout(() => setNotifSaved(false), 3000)
  }

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true); setSaved(false)
    await supabase.from('profiles').update({
      full_name:    fullName.trim()    || null,
      job_title:    jobTitle.trim()    || null,
      phone:        phone.trim()       || null,
      company_name: companyName.trim() || null,
    }).eq('id', user.id)
    setSaving(false); setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  async function saveWebhook(e) {
    e.preventDefault()
    setWebhookSaving(true); setWebhookSaved(false); setWebhookTestMsg('')
    await supabase.from('profiles').update({ webhook_url: webhookUrl.trim() || null }).eq('id', user.id)
    setWebhookSaving(false); setWebhookSaved(true)
    setTimeout(() => setWebhookSaved(false), 3000)
  }

  async function testWebhook() {
    if (!webhookUrl.trim()) return
    setWebhookTesting(true); setWebhookTestMsg('')
    try {
      const res = await fetch(webhookUrl.trim(), {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'X-OneSelect-Event': 'test' },
        body:    JSON.stringify({ event: 'test', timestamp: new Date().toISOString(), source: 'oneselect' }),
      })
      setWebhookTestMsg(res.ok ? '✓ Webhook reachable — test delivered.' : `✗ Endpoint returned ${res.status}.`)
    } catch {
      setWebhookTestMsg('✗ Could not reach endpoint — check the URL and CORS settings.')
    }
    setWebhookTesting(false)
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>Settings</h2>
          <p>Manage your account details</p>
        </div>
      </div>

      <div className="section-card" style={{ marginBottom: 16 }}>
        <div className="section-card-head"><h3>Profile</h3></div>
        <div className="section-card-body">
          <form onSubmit={handleSave}>
            <div className="form-grid">
              <div className="field">
                <label>Email</label>
                <input type="email" value={user?.email ?? ''} readOnly style={{ opacity: 0.5, cursor: 'not-allowed' }} />
              </div>
              <div className="field">
                <label>Full Name</label>
                <input type="text" value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Your full name" />
              </div>
              <div className="field">
                <label>Job Title</label>
                <input type="text" value={jobTitle} onChange={e => setJobTitle(e.target.value)} placeholder="e.g. HR Manager" />
              </div>
              <div className="field">
                <label>Phone</label>
                <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+44 7700 000000" />
              </div>
              <div className="field">
                <label>Company Name</label>
                <input type="text" value={companyName} onChange={e => setCompanyName(e.target.value)} placeholder="Your company name" />
              </div>
            </div>
            <div className="form-actions" style={{ marginTop: 20 }}>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? <><span className="spinner" style={{ width: 12, height: 12 }} /> Saving…</> : 'Save Changes'}
              </button>
              {saved && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--green)', letterSpacing: '0.06em' }}>✓ Saved</span>}
            </div>
          </form>
        </div>
      </div>

      <div className="section-card" style={{ marginBottom: 16 }}>
        <div className="section-card-head"><h3>Role &amp; Access</h3></div>
        <div className="section-card-body">
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>Client</div>
              <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>Access to your jobs, candidates, and reports. CVs are uploaded and screened by your One Select recruiter.</div>
            </div>
            <span className="badge badge-blue">Client</span>
          </div>
        </div>
      </div>

      <div className="section-card" style={{ marginBottom: 16 }}>
        <div className="section-card-head">
          <h3>Integrations</h3>
          <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-3)' }}>Webhook · HRIS</span>
        </div>
        <div className="section-card-body">
          {!canAccess('can_access_hris_webhook') ? (
            <PaidFeature feature="can_access_hris_webhook" inline>
              HRIS webhook integration
            </PaidFeature>
          ) : (
            <>
              <p style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.7, marginBottom: 16 }}>
                When a candidate is marked as <strong>hired</strong>, One Select will send a POST request to this URL with the candidate details — for syncing with Workday, BambooHR, Darwinbox, or any custom system.
              </p>
              <form onSubmit={saveWebhook}>
                <div className="field" style={{ marginBottom: 14 }}>
                  <label>Webhook URL</label>
                  <input
                    type="url"
                    value={webhookUrl}
                    onChange={e => setWebhookUrl(e.target.value)}
                    placeholder="https://your-hris.com/webhooks/oneselect"
                  />
                </div>
                {webhookTestMsg && (
                  <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: webhookTestMsg.startsWith('✓') ? 'var(--green)' : 'var(--red)', marginBottom: 12 }}>
                    {webhookTestMsg}
                  </div>
                )}
                <div className="form-actions">
                  <button type="submit" className="btn btn-primary" disabled={webhookSaving}>
                    {webhookSaving ? <><span className="spinner" style={{ width: 12, height: 12 }} /> Saving…</> : 'Save Webhook'}
                  </button>
                  {webhookUrl.trim() && (
                    <button type="button" className="btn btn-secondary" disabled={webhookTesting} onClick={testWebhook}>
                      {webhookTesting ? <><span className="spinner" style={{ width: 12, height: 12 }} /> Testing…</> : 'Send Test'}
                    </button>
                  )}
                  {webhookSaved && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--green)' }}>✓ Saved</span>}
                </div>
              </form>
              <div style={{ marginTop: 16, padding: '14px 16px', background: 'var(--surface2)', borderRadius: 'var(--r)', fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', lineHeight: 1.9, whiteSpace: 'pre' }}>{`{
  "event": "candidate.hired",
  "timestamp": "2026-05-07T17:30:00Z",
  "candidate": {
    "name": "Alex Rivera",
    "email": "alex@email.com",
    "phone": "+44 7700 000000",
    "linkedin_url": "https://linkedin.com/in/..."
  },
  "job": {
    "id": "uuid",
    "title": "Senior Software Engineer",
    "required_skills": ["Python", "PostgreSQL", "AWS"],
    "experience_years": 5
  },
  "assessment": {
    "match_score": 91,
    "interview_score": 89,
    "recommendation": "Strong Hire"
  },
  "client": { "company_name": "TechVentures Ltd" },
  "meta": { "platform": "oneselect", "version": "1.0" }
}`}</div>
            </>
          )}
        </div>
      </div>

      <div className="section-card" style={{ marginBottom: 16 }}>
        <div className="section-card-head"><h3>Email Notifications</h3></div>
        <div className="section-card-body">
          <p style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.7, marginBottom: 16 }}>
            Choose which emails you receive from One Select.
          </p>
          {[
            { key: 'shortlisted',        label: 'New candidate shortlisted',    desc: 'When a candidate passes AI screening for your role' },
            { key: 'interview_complete',  label: 'Interview completed',          desc: 'When a candidate finishes their video interview' },
            { key: 'approval_reminder',   label: 'Approval reminder',            desc: 'Nudges when candidates are awaiting your decision for 48h+' },
            { key: 'weekly_digest',       label: 'Weekly digest',                desc: 'A summary of pipeline activity every Monday morning' },
          ].map(({ key, label, desc }) => (
            <label key={key} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 16, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={notifPrefs[key] ?? true}
                onChange={e => setNotifPrefs(p => ({ ...p, [key]: e.target.checked }))}
                style={{ marginTop: 2, accentColor: 'var(--accent)', width: 15, height: 15, flexShrink: 0 }}
              />
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{label}</div>
                <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>{desc}</div>
              </div>
            </label>
          ))}
          <div className="form-actions">
            <button className="btn btn-primary" disabled={notifSaving} onClick={saveNotifPrefs}>
              {notifSaving ? <><span className="spinner" style={{ width: 12, height: 12 }} /> Saving…</> : 'Save Preferences'}
            </button>
            {notifSaved && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--green)', letterSpacing: '0.06em' }}>✓ Saved</span>}
          </div>
        </div>
      </div>

      <div className="section-card">
        <div className="section-card-head"><h3>Subscription</h3></div>
        <div className="section-card-body">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>
                {plan ? plan.name : 'No plan assigned'}
              </div>
              {plan?.description && <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>{plan.description}</div>}
              {plan?.price_monthly != null && (
                <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--accent)', marginTop: 4 }}>
                  ₹{Number(plan.price_monthly).toFixed(0)} / month
                </div>
              )}
              {profile?.subscription_started_at && (
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>
                  Active since {new Date(profile.subscription_started_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
                </div>
              )}
            </div>
            <span className={`badge ${subLabel(profile?.subscription_status).cls}`}>
              {subLabel(profile?.subscription_status).label}
            </span>
          </div>
        </div>
      </div>

      {/* Stakeholders — only shown to the account owner, not to stakeholders themselves */}
      {!isStakeholder && (
        <div className="section-card" style={{ marginTop: 16 }}>
          <div className="section-card-head">
            <h3>Team Access</h3>
            <p style={{ fontSize: 12, color: 'var(--text-3)', margin: 0 }}>
              Invite colleagues to a read-only view of your pipeline
            </p>
          </div>
          <div className="section-card-body">
            <form onSubmit={inviteStakeholder} style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
              <input
                className="input"
                type="email"
                placeholder="colleague@company.com"
                value={inviteEmail}
                onChange={e => setInviteEmail(e.target.value)}
                style={{ flex: '1 1 200px' }}
                required
              />
              <input
                className="input"
                type="text"
                placeholder="Name (optional)"
                value={inviteName}
                onChange={e => setInviteName(e.target.value)}
                style={{ flex: '1 1 160px' }}
              />
              <button className="btn btn-primary" type="submit" disabled={inviting || !inviteEmail.trim()}>
                {inviting ? <><span className="spinner" style={{ width: 12, height: 12 }} /> Sending…</> : 'Send Invite'}
              </button>
            </form>
            {inviteMsg && (
              <div style={{ fontSize: 12, color: inviteMsg.startsWith('Error') ? 'var(--red)' : 'var(--green)', marginBottom: 12 }}>
                {inviteMsg}
              </div>
            )}
            {stakeholders.length > 0 ? (
              <table className="table" style={{ fontSize: 13 }}>
                <thead>
                  <tr><th>Name</th><th>Email</th><th>Added</th><th style={{ width: 60 }}></th></tr>
                </thead>
                <tbody>
                  {stakeholders.map(s => (
                    <tr key={s.id}>
                      <td>{s.full_name || '—'}</td>
                      <td style={{ color: 'var(--text-2)' }}>{s.email}</td>
                      <td style={{ color: 'var(--text-3)', fontSize: 11 }}>{new Date(s.created_at).toLocaleDateString()}</td>
                      <td>
                        <button
                          className="btn btn-ghost"
                          style={{ fontSize: 11, color: 'var(--red)', padding: '2px 6px' }}
                          onClick={() => removeStakeholder(s.id)}
                        >Remove</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div style={{ fontSize: 13, color: 'var(--text-3)' }}>
                No team members added yet. Invited colleagues get read-only access — they can view jobs and candidates but cannot approve, reject, or post new roles.
              </div>
            )}
          </div>
        </div>
      )}

      {isStakeholder && (
        <div className="section-card" style={{ marginTop: 16 }}>
          <div className="section-card-body">
            <div style={{ fontSize: 13, color: 'var(--text-2)' }}>
              You have <strong>read-only access</strong> to this account's pipeline. Contact the account owner to change your permissions.
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
