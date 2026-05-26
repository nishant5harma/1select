import { useState, useEffect } from 'react'
import { useAuth } from '../../lib/AuthContext'
import { supabase } from '../../lib/supabase'
import TwoFactorSection from '../../components/TwoFactorSection'
import DemoLoader from '../../components/DemoLoader'

const EMPTY_PLAN = { name: '', description: '', price_monthly: '', max_jobs: '', max_candidates: '', max_recruiters: '' }

export default function AdminSettings() {
  const { user, profile } = useAuth()
  const [saving,      setSaving]      = useState(false)
  const [saved,       setSaved]       = useState(false)
  const [fullName,    setFullName]    = useState(profile?.full_name    ?? '')
  const [jobTitle,    setJobTitle]    = useState(profile?.job_title    ?? '')
  const [phone,       setPhone]       = useState(profile?.phone        ?? '')
  const [companyName, setCompanyName] = useState(profile?.company_name ?? '')

  // ── Integrations ──────────────────────────────────────────────────────────
  const [linkedinEnabled,      setLinkedinEnabled]     = useState(true)
  const [linkedinMaxProfiles,  setLinkedinMaxProfiles] = useState(20)
  const [integrationsSaving,   setIntegrationsSaving]  = useState(false)
  const [integrationsSaved,    setIntegrationsSaved]   = useState(false)
  const [sourcingStats,        setSourcingStats]       = useState({ total: 0, inPipeline: 0, talentPool: 0, runsThisMonth: 0 })
  const [sourcingLog,          setSourcingLog]         = useState([])
  const [sourcingLogLoading,   setSourcingLogLoading]  = useState(true)

  useEffect(() => { loadIntegrationSettings() }, [])

  async function loadIntegrationSettings() {
    setSourcingLogLoading(true)
    try { // fix: wrap in try/finally so setSourcingLogLoading(false) always fires on query error
      const ms = (() => { const d = new Date(); d.setDate(1); d.setHours(0,0,0,0); return d.toISOString() })()
      const [
        { data: settings },
        { count: totalSourced },
        { count: inPipeline },
        { count: talentPool },
        { count: runsThisMonth },
        { data: logRows },
      ] = await Promise.all([
        supabase.from('platform_settings').select('key, value').in('key', ['linkedin_sourcing_enabled', 'linkedin_max_profiles']),
        supabase.from('candidates').select('*', { count: 'exact', head: true }).eq('source', 'linkedin'),
        supabase.from('candidates').select('*', { count: 'exact', head: true }).eq('source', 'linkedin').not('job_id', 'is', null),
        supabase.from('candidates').select('*', { count: 'exact', head: true }).eq('source', 'linkedin').is('job_id', null),
        supabase.from('linkedin_sourcing_log').select('*', { count: 'exact', head: true }).gte('triggered_at', ms),
        supabase.from('linkedin_sourcing_log').select('*, jobs(title)').order('triggered_at', { ascending: false }).limit(50),
      ])
      if (settings) {
        const enabled = settings.find(s => s.key === 'linkedin_sourcing_enabled')
        const max     = settings.find(s => s.key === 'linkedin_max_profiles')
        if (enabled) setLinkedinEnabled(enabled.value === 'true')
        if (max)     setLinkedinMaxProfiles(Number(max.value) || 20)
      }
      setSourcingStats({ total: totalSourced ?? 0, inPipeline: inPipeline ?? 0, talentPool: talentPool ?? 0, runsThisMonth: runsThisMonth ?? 0 })
      setSourcingLog(logRows ?? [])
    } finally {
      setSourcingLogLoading(false) // fix: always clear loading even when Promise.all fails
    }
  }

  async function saveIntegrationSettings() {
    setIntegrationsSaving(true)
    await Promise.all([
      supabase.from('platform_settings').upsert({ key: 'linkedin_sourcing_enabled', value: String(linkedinEnabled), updated_at: new Date().toISOString() }, { onConflict: 'key' }),
      supabase.from('platform_settings').upsert({ key: 'linkedin_max_profiles', value: String(linkedinMaxProfiles), updated_at: new Date().toISOString() }, { onConflict: 'key' }),
    ])
    setIntegrationsSaving(false)
    setIntegrationsSaved(true)
    setTimeout(() => setIntegrationsSaved(false), 3000)
  }

  // ── Plans ─────────────────────────────────────────────────────────────────
  const [plans,       setPlans]       = useState([])
  const [plansLoading, setPlansLoading] = useState(true)
  const [planModal,   setPlanModal]   = useState(null)  // null | 'new' | plan object
  const [planForm,    setPlanForm]    = useState(EMPTY_PLAN)
  const [planSaving,  setPlanSaving]  = useState(false)
  const [planError,   setPlanError]   = useState('')
  const [deleteModal, setDeleteModal] = useState(null)
  const [deleting,    setDeleting]    = useState(false)

  useEffect(() => { loadPlans() }, [])

  async function loadPlans() {
    setPlansLoading(true)
    const { data } = await supabase.from('plans').select('*').order('price_monthly', { ascending: true, nullsFirst: true })
    setPlans(data ?? [])
    setPlansLoading(false)
  }

  function openNewPlan() {
    setPlanForm(EMPTY_PLAN)
    setPlanError('')
    setPlanModal('new')
  }

  function openEditPlan(plan) {
    setPlanForm({
      name:           plan.name,
      description:    plan.description ?? '',
      price_monthly:  plan.price_monthly ?? '',
      max_jobs:       plan.max_jobs ?? '',
      max_candidates: plan.max_candidates ?? '',
      max_recruiters: plan.max_recruiters ?? '',
    })
    setPlanError('')
    setPlanModal(plan)
  }

  async function handleSavePlan() {
    if (!planForm.name.trim()) { setPlanError('Plan name is required'); return }
    setPlanSaving(true); setPlanError('')
    const payload = {
      name:           planForm.name.trim(),
      description:    planForm.description.trim() || null,
      price_monthly:  planForm.price_monthly !== '' ? Number(planForm.price_monthly) : null,
      max_jobs:       planForm.max_jobs !== '' ? Number(planForm.max_jobs) : null,
      max_candidates: planForm.max_candidates !== '' ? Number(planForm.max_candidates) : null,
      max_recruiters: planForm.max_recruiters !== '' ? Number(planForm.max_recruiters) : null,
    }
    const { error } = planModal === 'new'
      ? await supabase.from('plans').insert(payload)
      : await supabase.from('plans').update(payload).eq('id', planModal.id)
    setPlanSaving(false)
    if (error) { setPlanError(error.message); return }
    setPlanModal(null)
    await loadPlans()
  }

  async function handleDeletePlan() {
    if (!deleteModal) return
    setDeleting(true)
    await supabase.from('plans').delete().eq('id', deleteModal.id)
    setDeleting(false)
    setDeleteModal(null)
    await loadPlans()
  }

  // ── Account save ──────────────────────────────────────────────────────────
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

  const limitLabel = v => v == null ? '∞' : v

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>Settings</h2>
          <p>Manage your account and platform configuration</p>
        </div>
      </div>

      {/* Account */}
      <div className="section-card" style={{ marginBottom: 16 }}>
        <div className="section-card-head"><h3>Account</h3></div>
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
                <input type="text" value={jobTitle} onChange={e => setJobTitle(e.target.value)} placeholder="e.g. Managing Director" />
              </div>
              <div className="field">
                <label>Phone</label>
                <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+44 7700 000000" />
              </div>
              <div className="field">
                <label>Company / Platform Name</label>
                <input type="text" value={companyName} onChange={e => setCompanyName(e.target.value)} placeholder="e.g. One Select" />
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

      {/* Plans */}
      <div className="section-card" style={{ marginBottom: 16 }}>
        <div className="section-card-head">
          <h3>Subscription Plans</h3>
          <button className="btn btn-primary" style={{ fontSize: 11, padding: '5px 12px' }} onClick={openNewPlan}>+ Add Plan</button>
        </div>

        {plansLoading ? (
          <div style={{ padding: '24px', display: 'flex', justifyContent: 'center' }}><span className="spinner" /></div>
        ) : plans.length === 0 ? (
          <div className="empty-state">No plans yet. Create your first plan above.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['Plan', 'Price / mo', 'Max Jobs', 'Max Candidates', 'Max Recruiters', ''].map(h => (
                    <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: 10, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-3)', fontWeight: 400 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {plans.map(p => (
                  <tr key={p.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ fontWeight: 500, color: 'var(--text)' }}>{p.name}</div>
                      {p.description && <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{p.description}</div>}
                    </td>
                    <td style={{ padding: '12px 16px', fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>
                      {p.price_monthly != null ? `₹${Number(p.price_monthly).toFixed(0)}` : '—'}
                    </td>
                    <td style={{ padding: '12px 16px', fontFamily: 'var(--font-mono)', color: 'var(--text-2)' }}>{limitLabel(p.max_jobs)}</td>
                    <td style={{ padding: '12px 16px', fontFamily: 'var(--font-mono)', color: 'var(--text-2)' }}>{limitLabel(p.max_candidates)}</td>
                    <td style={{ padding: '12px 16px', fontFamily: 'var(--font-mono)', color: 'var(--text-2)' }}>{limitLabel(p.max_recruiters)}</td>
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        <button className="btn btn-secondary" style={{ fontSize: 10, padding: '3px 8px' }} onClick={() => openEditPlan(p)}>Edit</button>
                        <button className="btn btn-secondary" style={{ fontSize: 10, padding: '3px 8px', color: 'var(--red)' }} onClick={() => setDeleteModal(p)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Integrations ── */}
      <div className="section-card" style={{ marginBottom: 16 }}>
        <div className="section-card-head"><h3>Integrations</h3></div>
        <div className="section-card-body">

          {/* LinkedIn Sourcing */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', marginBottom: 4 }}>LinkedIn Sourcing</div>
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 16 }}>
              Automatically search LinkedIn for matching candidates when a job is created, powered by Apify.
              The API token is configured in Supabase Edge Function secrets — no key entry needed here.
            </div>

            <div className="form-grid">
              <div className="field">
                <label>Max Profiles per Job</label>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={linkedinMaxProfiles}
                  onChange={e => setLinkedinMaxProfiles(Math.min(50, Math.max(1, Number(e.target.value))))}
                />
              </div>
              <div className="field" style={{ display: 'flex', alignItems: 'center', gap: 10, paddingTop: 24 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', margin: 0 }}>
                  <input
                    type="checkbox"
                    checked={linkedinEnabled}
                    onChange={e => setLinkedinEnabled(e.target.checked)}
                  />
                  <span style={{ fontSize: 13 }}>Enable LinkedIn sourcing globally</span>
                </label>
              </div>
            </div>

            <div className="form-actions" style={{ marginTop: 16 }}>
              <button className="btn btn-primary" disabled={integrationsSaving} onClick={saveIntegrationSettings}>
                {integrationsSaving ? <><span className="spinner" style={{ width: 12, height: 12 }} /> Saving…</> : 'Save Settings'}
              </button>
              {integrationsSaved && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--green)', letterSpacing: '0.06em' }}>✓ Saved</span>}
            </div>
          </div>

          {/* Live stats */}
          <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 140px', padding: '12px 16px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r)' }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 700, color: 'var(--accent)' }}>{sourcingStats.total}</div>
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>Total sourced</div>
            </div>
            <div style={{ flex: '1 1 140px', padding: '12px 16px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r)' }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 700, color: 'var(--text)' }}>{sourcingStats.inPipeline}</div>
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>In job pipelines</div>
            </div>
            <div style={{ flex: '1 1 140px', padding: '12px 16px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r)' }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 700, color: 'var(--text)' }}>{sourcingStats.talentPool}</div>
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>LinkedIn Pool</div>
            </div>
            <div style={{ flex: '1 1 140px', padding: '12px 16px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r)' }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 700, color: 'var(--text)' }}>{sourcingStats.runsThisMonth}</div>
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>Runs this month</div>
            </div>
          </div>

          {/* Sourcing log */}
          <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-3)', marginBottom: 8 }}>
            Recent Sourcing Runs
          </div>
          {sourcingLogLoading ? (
            <div style={{ padding: '16px 0' }}><span className="spinner" /></div>
          ) : sourcingLog.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--text-3)', padding: '12px 0' }}>No sourcing runs yet.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    {['Job', 'Date', 'Found', 'Added', 'Status'].map(h => (
                      <th key={h} style={{ padding: '6px 10px', textAlign: 'left', fontSize: 10, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-3)', fontWeight: 400 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sourcingLog.map(row => (
                    <tr key={row.id} style={{ borderBottom: '1px solid var(--border2)' }}>
                      <td style={{ padding: '7px 10px', color: 'var(--text-2)' }}>{row.jobs?.title ?? '—'}</td>
                      <td style={{ padding: '7px 10px', fontFamily: 'var(--font-mono)', color: 'var(--text-3)', whiteSpace: 'nowrap' }}>
                        {new Date(row.triggered_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td style={{ padding: '7px 10px', fontFamily: 'var(--font-mono)', textAlign: 'center' }}>{row.candidates_found}</td>
                      <td style={{ padding: '7px 10px', fontFamily: 'var(--font-mono)', textAlign: 'center', color: row.candidates_added > 0 ? 'var(--green)' : 'var(--text-3)' }}>{row.candidates_added}</td>
                      <td style={{ padding: '7px 10px' }}>
                        <span className={`badge ${row.status === 'success' ? 'badge-green' : 'badge-red'}`} style={{ fontSize: 9 }}>
                          {row.status}
                        </span>
                        {row.error_message && (
                          <span style={{ fontSize: 10, color: 'var(--red)', marginLeft: 6 }} title={row.error_message}>⚠</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Demo Mode */}
      {import.meta.env.VITE_DEMO_MODE === 'true' && (
        <div className="section-card" style={{ marginBottom: 16, border: '1px solid var(--amber, #f59e0b)', background: 'rgba(245,158,11,0.04)' }}>
          <div className="section-card-head">
            <h3 style={{ color: 'var(--amber, #f59e0b)' }}>Demo Mode</h3>
            <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--amber, #f59e0b)', letterSpacing: '0.08em', padding: '2px 8px', border: '1px solid var(--amber, #f59e0b)', borderRadius: 2 }}>DEMO ENV</span>
          </div>
          <DemoLoader />
        </div>
      )}

      <TwoFactorSection />

      {/* Role */}
      <div className="section-card" style={{ marginBottom: 16 }}>
        <div className="section-card-head"><h3>Role &amp; Access</h3></div>
        <div className="section-card-body">
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>Administrator</div>
              <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>Full access to all clients, jobs, pipeline and platform settings</div>
            </div>
            <span className="badge badge-blue">Admin</span>
          </div>
        </div>
      </div>

      {/* AI Model */}
      <div className="section-card">
        <div className="section-card-head"><h3>AI Configuration</h3></div>
        <div className="section-card-body">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[
              { step: 'CV Parsing',    desc: 'Extracts name, role, skills and experience from uploaded CVs' },
              { step: 'Screening',     desc: 'Scores candidates against job requirements, returns match /100' },
              { step: 'Interviews',    desc: 'Conducts personalised multi-turn AI interviews per CV' },
              { step: 'Scoring',       desc: 'Evaluates interviews across 5 dimensions and gives a recommendation' },
            ].map(({ step, desc }) => (
              <div key={step} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '11px 16px', background: 'var(--surface2)', borderRadius: 'var(--r)' }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{step}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{desc}</div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--accent)', letterSpacing: '0.04em' }}>{import.meta.env.VITE_CLAUDE_MODEL || 'claude-sonnet-4-6'}</div>
                  <span className="badge badge-green" style={{ marginTop: 4 }}>Active</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Plan modal (new / edit) ── */}
      {planModal && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget && !planSaving) setPlanModal(null) }}>
          <div className="modal" style={{ maxWidth: 480 }}>
            <div className="modal-head">
              <h3>{planModal === 'new' ? 'New Plan' : `Edit — ${planModal.name}`}</h3>
              <button className="modal-close" disabled={planSaving} onClick={() => setPlanModal(null)}>×</button>
            </div>
            <div className="modal-body">
              <div className="form-grid">
                <div className="field span-2">
                  <label>Plan Name *</label>
                  <input type="text" placeholder="e.g. Starter" value={planForm.name} onChange={e => setPlanForm(f => ({ ...f, name: e.target.value }))} autoFocus />
                </div>
                <div className="field span-2">
                  <label>Description</label>
                  <input type="text" placeholder="Brief description shown to clients" value={planForm.description} onChange={e => setPlanForm(f => ({ ...f, description: e.target.value }))} />
                </div>
                <div className="field">
                  <label>Monthly Price (₹)</label>
                  <input type="number" min="0" step="0.01" placeholder="e.g. 299" value={planForm.price_monthly} onChange={e => setPlanForm(f => ({ ...f, price_monthly: e.target.value }))} />
                </div>
                <div className="field">
                  <label>Max Active Jobs <span style={{ color: 'var(--text-3)', fontWeight: 300 }}>(blank = unlimited)</span></label>
                  <input type="number" min="1" placeholder="∞" value={planForm.max_jobs} onChange={e => setPlanForm(f => ({ ...f, max_jobs: e.target.value }))} />
                </div>
                <div className="field">
                  <label>Max Candidates <span style={{ color: 'var(--text-3)', fontWeight: 300 }}>(blank = unlimited)</span></label>
                  <input type="number" min="1" placeholder="∞" value={planForm.max_candidates} onChange={e => setPlanForm(f => ({ ...f, max_candidates: e.target.value }))} />
                </div>
                <div className="field">
                  <label>Max Recruiters <span style={{ color: 'var(--text-3)', fontWeight: 300 }}>(blank = unlimited)</span></label>
                  <input type="number" min="1" placeholder="∞" value={planForm.max_recruiters} onChange={e => setPlanForm(f => ({ ...f, max_recruiters: e.target.value }))} />
                </div>
              </div>
              {planError && <div className="error-banner" style={{ marginTop: 14 }}>{planError}</div>}
              <div className="form-actions" style={{ marginTop: 20 }}>
                <button className="btn btn-primary" disabled={planSaving} onClick={handleSavePlan}>
                  {planSaving ? <><span className="spinner" style={{ width: 12, height: 12 }} /> Saving…</> : planModal === 'new' ? 'Create Plan' : 'Save Changes'}
                </button>
                <button className="btn btn-secondary" disabled={planSaving} onClick={() => setPlanModal(null)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete plan confirmation ── */}
      {deleteModal && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget && !deleting) setDeleteModal(null) }}>
          <div className="modal" style={{ maxWidth: 400 }}>
            <div className="modal-head">
              <h3>Delete Plan</h3>
              <button className="modal-close" disabled={deleting} onClick={() => setDeleteModal(null)}>×</button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.7, marginBottom: 20 }}>
                Delete <strong>{deleteModal.name}</strong>? Clients currently on this plan will have their plan unset but their accounts will remain active.
              </p>
              <div className="form-actions">
                <button className="btn btn-primary" style={{ background: 'var(--red)', borderColor: 'var(--red)' }} disabled={deleting} onClick={handleDeletePlan}>
                  {deleting ? <><span className="spinner" style={{ width: 12, height: 12 }} /> Deleting…</> : 'Delete Plan'}
                </button>
                <button className="btn btn-secondary" disabled={deleting} onClick={() => setDeleteModal(null)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
