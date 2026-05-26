import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'
import { triggerTalentPoolMatch } from '../../utils/talentPool'
import TagInput from '../../components/TagInput'
import JDWizard from '../../components/JDWizard'
import InstantPost from '../../components/InstantPost'

// ── Requirements-met logic ────────────────────────────────────────────────────
function reqStatus(cands) {
  if (!cands.length) return 'awaiting'
  const hasStrong = cands.some(c =>
    c.match_pass && ['Strong Hire', 'Hire'].includes(c.scores?.recommendation)
  )
  if (hasStrong) return 'met'
  if (cands.some(c => c.match_pass && !c.scores)) return 'progress'
  return 'attention'
}

const REQ_CFG = {
  met:       { label: 'Requirements Met', cls: 'badge-green' },
  progress:  { label: 'In Progress',      cls: 'badge-blue'  },
  attention: { label: 'Needs Attention',  cls: 'badge-red'   },
  awaiting:  { label: 'Awaiting CVs',     cls: 'badge-amber' },
}

const DEFAULT = { title: '', experience_years: 3, required_skills: [], preferred_skills: [], description: '', tech_weight: 60, comm_weight: 40 }

export default function RecruiterJobs() {
  const { user }   = useAuth()
  const navigate   = useNavigate()

  const [clientIds, setClientIds]       = useState(null)
  const [clients, setClients]           = useState([])
  const [selectedClientId, setSelectedClientId] = useState('')
  const [jobs, setJobs]                 = useState([])
  const [candMap, setCandMap]           = useState({})
  const [webhookFails, setWebhookFails] = useState(new Set())
  const [loading, setLoading]         = useState(true)
  const [filter, setFilter]           = useState('all')
  const [closing, setClosing]         = useState(null)
  const [showForm, setShowForm]       = useState(false)
  const [showWizard, setShowWizard]   = useState(false)
  const [showInstant, setShowInstant] = useState(false)
  const [wizardPrefill, setWizardPrefill] = useState(null)
  const [form, setForm]               = useState(DEFAULT)
  const [saving, setSaving]           = useState(false)
  const [error, setError]             = useState('')
  const [poolStatus, setPoolStatus]   = useState({})

  useEffect(() => { if (user) init() }, [user])

  async function init() {
    const { data: rcData } = await supabase
      .from('recruiter_clients')
      .select('client_id, profiles!recruiter_clients_client_id_fkey(id, company_name, email, full_name)')
      .eq('recruiter_id', user.id)

    const assignedClients = (rcData ?? []).map(r => r.profiles).filter(Boolean)
    const ids = assignedClients.map(c => c.id)

    setClients(assignedClients)
    setClientIds(ids)
    if (assignedClients.length === 1) setSelectedClientId(assignedClients[0].id)

    if (!ids.length) { setLoading(false); return }
    await loadJobs(ids)
  }

  async function loadJobs(ids) {
    const effectiveIds = ids ?? clientIds
    if (!effectiveIds?.length) { setLoading(false); return }

    try { // fix: wrap in try/finally so setLoading(false) always fires on query error
    const { data: jobData } = await supabase
      .from('jobs')
      .select('*, profiles(company_name, email)')
      .in('recruiter_id', effectiveIds)
      .order('created_at', { ascending: false })

    const jobIds = (jobData ?? []).map(j => j.id)
    let candData = []
    if (jobIds.length) {
      const { data } = await supabase
        .from('candidates')
        .select('job_id, match_pass, match_score, scores')
        .in('job_id', jobIds)
      candData = data ?? []
    }

    const cm = {}
    candData.forEach(c => {
      if (!cm[c.job_id]) cm[c.job_id] = []
      cm[c.job_id].push(c)
    })

    let failSet = new Set()
    if (jobIds.length) {
      const { data: failures } = await supabase.from('webhook_failures').select('job_id').in('job_id', jobIds).eq('resolved', false)
      ;(failures ?? []).forEach(f => failSet.add(f.job_id))
    }

    setJobs(jobData ?? [])
    setCandMap(cm)
    setWebhookFails(failSet)
    } finally {
      setLoading(false) // fix: always clear loading even when queries fail
    }
  }

  const setF = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const setTech = (v) => { setF('tech_weight', v); setF('comm_weight', 100 - v) }

  function triggerLinkedInSourcing(job) {
    if (!job) return
    supabase.functions.invoke('source-linkedin-candidates', {
      body: {
        job_id:          job.id,
        job_title:       job.title,
        job_description: job.description ?? '',
        skills:          job.required_skills ?? [],
        location:        job.location ?? '',
      },
    }).catch(() => {})
  }

  // ── Quick Add ─────────────────────────────────────────────────────────────
  async function handleCreate(e) {
    e.preventDefault()
    setError('')
    if (!selectedClientId) { setError('Select a client for this job'); return }
    setSaving(true)
    const { data, error: err } = await supabase.from('jobs').insert({
      recruiter_id:     selectedClientId,
      title:            form.title,
      experience_years: form.experience_years,
      required_skills:  form.required_skills,
      preferred_skills: form.preferred_skills,
      description:      form.description,
      tech_weight:      form.tech_weight,
      comm_weight:      form.comm_weight,
      status:           'active',
    }).select().single()
    setSaving(false)
    if (err) { setError(err.message); return }
    setJobs(p => [data, ...p])
    setShowForm(false)
    setForm(DEFAULT)
    triggerLinkedInSourcing(data)
    setPoolStatus(p => ({ ...p, [data.id]: 'scanning' }))
    triggerTalentPoolMatch(data.id)
      .then(passed => setPoolStatus(p => ({ ...p, [data.id]: `done:${passed}` })))
      .catch(() => setPoolStatus(p => ({ ...p, [data.id]: 'error' })))
  }

  // ── Instant Post ──────────────────────────────────────────────────────────
  async function handleInstantSave(jobData) {
    setShowInstant(false)
    setError('')
    if (!selectedClientId) { setError('Select a client before posting a job'); return }
    const { data, error: err } = await supabase.from('jobs').insert({
      recruiter_id:     selectedClientId,
      status:           'active',
      title:            jobData.title,
      description:      jobData.description,
      required_skills:  jobData.required_skills,
      preferred_skills: jobData.preferred_skills,
      experience_years: jobData.experience_years,
      tech_weight:      jobData.tech_weight,
      comm_weight:      jobData.comm_weight,
    }).select().single()
    if (err) { setError(err.message); return }
    await loadJobs(clientIds)
    if (data) {
      triggerLinkedInSourcing(data)
      setPoolStatus(p => ({ ...p, [data.id]: 'scanning' }))
      triggerTalentPoolMatch(data.id)
        .then(passed => setPoolStatus(p => ({ ...p, [data.id]: `done:${passed}` })))
        .catch(() => setPoolStatus(p => ({ ...p, [data.id]: 'error' })))
    }
  }

  // ── AI Wizard ─────────────────────────────────────────────────────────────
  async function handleWizardSave(jobData) {
    setShowWizard(false)
    setWizardPrefill(null)
    const { assigned_to, work_mode, ...rest } = jobData
    const clientId = assigned_to ?? null
    if (!clientId) { setError('No client selected — job not saved'); return }
    const { data, error: err } = await supabase.from('jobs').insert({
      recruiter_id: clientId,
      status:       'active',
      work_mode,
      ...rest,
    }).select().single()
    if (err) { setError(err.message); return }
    await loadJobs(clientIds)
    if (data) {
      triggerLinkedInSourcing(data)
      setPoolStatus(p => ({ ...p, [data.id]: 'scanning' }))
      triggerTalentPoolMatch(data.id)
        .then(passed => setPoolStatus(p => ({ ...p, [data.id]: `done:${passed}` })))
        .catch(() => setPoolStatus(p => ({ ...p, [data.id]: 'error' })))
    }
  }

  async function toggleStatus(job) {
    setClosing(job.id)
    const next = job.status === 'active' ? 'closed' : 'active'
    await supabase.from('jobs').update({ status: next }).eq('id', job.id)
    setJobs(p => p.map(j => j.id === job.id ? { ...j, status: next } : j))
    setClosing(null)
  }

  const clientFiltered = selectedClientId ? jobs.filter(j => j.recruiter_id === selectedClientId) : jobs
  const filtered = filter === 'all' ? clientFiltered : clientFiltered.filter(j => j.status === filter)

  if (loading || clientIds === null) return <div className="page"><span className="spinner" /></div>

  if (!clientIds.length) return (
    <div className="page">
      <div className="page-head"><div><h2>Jobs</h2></div></div>
      <div className="section-card">
        <div className="empty-state">
          <div style={{ fontSize: 28, marginBottom: 10, opacity: 0.3 }}>◫</div>
          <div style={{ fontWeight: 400, color: 'var(--text-2)', marginBottom: 6 }}>No clients assigned yet</div>
          <div style={{ fontSize: 12 }}>Jobs will appear once your admin assigns you clients.</div>
        </div>
      </div>
    </div>
  )

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>Jobs</h2>
          <p>{jobs.length} job{jobs.length !== 1 ? 's' : ''} across your {clients.length} client{clients.length !== 1 ? 's' : ''}</p>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          {['all', 'active', 'closed'].map(s => (
            <button
              key={s}
              className={`btn ${filter === s ? 'btn-primary' : 'btn-secondary'}`}
              style={{ padding: '6px 12px', fontSize: 12, textTransform: 'capitalize' }}
              onClick={() => setFilter(s)}
            >{s}</button>
          ))}
          <button className="btn btn-secondary" style={{ marginLeft: 4 }} onClick={() => { setShowForm(p => !p); setError('') }}>
            {showForm ? 'Cancel' : '+ Quick Add'}
          </button>
          <button className="btn btn-secondary" onClick={() => { setShowInstant(true); setShowForm(false) }}>
            ✨ Post a Job
          </button>
          <button className="btn btn-primary" onClick={() => { setShowWizard(true); setShowForm(false) }}>
            ✨ Create with AI
          </button>
        </div>
      </div>

      {/* Client selector banner — used by Quick Add and Instant Post */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, padding: '10px 16px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r)', fontSize: 13 }}>
        <span style={{ color: 'var(--text-3)', flexShrink: 0, fontSize: 12, fontFamily: 'var(--font-mono)' }}>Filter & create for:</span>
        <select
          value={selectedClientId}
          onChange={e => setSelectedClientId(e.target.value)}
          style={{ fontSize: 12, padding: '5px 10px', flex: 1, maxWidth: 260 }}
        >
          <option value="">— select client —</option>
          {clients.map(c => (
            <option key={c.id} value={c.id}>{c.company_name || c.full_name || c.email}</option>
          ))}
        </select>
        <span style={{ fontSize: 11, color: 'var(--text-3)' }}>Filters job list · used for Quick Add and Post a Job</span>
      </div>

      {error && <div className="error-banner" style={{ marginBottom: 16 }}>{error}</div>}

      {/* ── Quick Add form ── */}
      {showForm && (
        <div className="section-card" style={{ marginBottom: 20 }}>
          <div className="section-card-head"><h3>New Job Posting</h3></div>
          <div className="section-card-body">
            <form onSubmit={handleCreate}>
              <div className="form-grid">
                <div className="field span-2">
                  <label>Client *</label>
                  <select value={selectedClientId} onChange={e => setSelectedClientId(e.target.value)} required>
                    <option value="">— select client —</option>
                    {clients.map(c => (
                      <option key={c.id} value={c.id}>{c.company_name || c.full_name || c.email}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Job Title</label>
                  <input type="text" required value={form.title} placeholder="e.g. Senior Backend Engineer" onChange={e => setF('title', e.target.value)} />
                </div>
                <div className="field">
                  <label>Years of Experience</label>
                  <input type="number" min={0} value={form.experience_years} onChange={e => setF('experience_years', +e.target.value)} />
                </div>
                <div className="field span-2">
                  <label>Required Skills</label>
                  <TagInput value={form.required_skills} onChange={v => setF('required_skills', v)} placeholder="Type and press Enter…" />
                </div>
                <div className="field span-2">
                  <label>Preferred Skills</label>
                  <TagInput value={form.preferred_skills} onChange={v => setF('preferred_skills', v)} placeholder="Nice-to-have…" />
                </div>
                <div className="field span-2">
                  <label>Description</label>
                  <textarea rows={4} value={form.description} onChange={e => setF('description', e.target.value)} placeholder="Role responsibilities and context…" />
                </div>
                <div className="field span-2">
                  <label>Evaluation Weights</label>
                  <div className="weight-sliders">
                    <div className="weight-row">
                      <span>Technical</span>
                      <input type="range" min={10} max={90} value={form.tech_weight} onChange={e => setTech(+e.target.value)} />
                      <span className="weight-val">{form.tech_weight}%</span>
                    </div>
                    <div className="weight-row">
                      <span>Communication</span>
                      <input type="range" min={10} max={90} value={form.comm_weight} onChange={e => { setF('comm_weight', +e.target.value); setF('tech_weight', 100 - +e.target.value) }} />
                      <span className="weight-val">{form.comm_weight}%</span>
                    </div>
                  </div>
                </div>
              </div>
              <div className="form-actions" style={{ marginTop: 20 }}>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? <><span className="spinner" style={{ width: 12, height: 12 }} /> Creating…</> : 'Create Job'}
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => { setShowForm(false); setError('') }}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Jobs list ── */}
      {jobs.length === 0 ? (
        <div className="section-card">
          <div className="empty-state">
            <div style={{ fontSize: 32, marginBottom: 12, opacity: 0.25 }}>◫</div>
            <div style={{ fontSize: 16, fontFamily: 'var(--font-head)', fontWeight: 400, color: 'var(--text-2)', marginBottom: 8 }}>No jobs yet</div>
            <div style={{ fontSize: 13, marginBottom: 20 }}>Create jobs above for your assigned clients.</div>
          </div>
        </div>
      ) : (
        <>
          {/* Active jobs */}
          {(filter === 'all' || filter === 'active') && (
            <div className="section-card" style={{ marginBottom: 16 }}>
              <div className="section-card-head">
                <h3>Active</h3>
                <span className="badge badge-green">{filtered.filter(j => j.status === 'active').length}</span>
              </div>
              {filtered.filter(j => j.status === 'active').length === 0 ? (
                <div className="empty-state" style={{ padding: '20px' }}>No active jobs.</div>
              ) : filtered.filter(j => j.status === 'active').map(j => {
                const cands = candMap[j.id] ?? []
                const rq    = reqStatus(cands)
                const ps    = poolStatus[j.id]
                return (
                  <div key={j.id} className="table-row" style={{ cursor: 'pointer' }} onClick={() => navigate(`/recruiter/candidates?job=${j.id}`)}>
                    <div className="col-main">
                      <div className="col-name">
                        {j.job_code && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-3)', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r)', padding: '1px 6px', marginRight: 7, letterSpacing: '0.04em' }}>{j.job_code}</span>}
                        {j.title}
                      </div>
                      <div className="col-sub">
                        {j.profiles?.company_name ?? j.profiles?.email ?? '—'} ·{' '}
                        {j.experience_years ?? 0}+ yrs
                        {(j.required_skills ?? []).length > 0 &&
                          ` · ${(j.required_skills ?? []).slice(0, 2).join(', ')}${(j.required_skills ?? []).length > 2 ? '…' : ''}`}
                      </div>
                      {ps && (
                        <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', marginTop: 2,
                          color: ps === 'scanning' ? 'var(--accent)' : ps?.startsWith('done') ? 'var(--green)' : 'var(--red)' }}>
                          {ps === 'scanning' ? '⟳ Scanning talent pool…'
                            : ps?.startsWith('done') ? `✓ ${ps.split(':')[1]} pool match${+ps.split(':')[1] !== 1 ? 'es' : ''}`
                            : '✗ Pool scan failed'}
                        </div>
                      )}
                    </div>
                    <div className="col-right">
                      <span className={`badge ${REQ_CFG[rq].cls}`} style={{ fontSize: 9 }}>{REQ_CFG[rq].label}</span>
                      {j.pipeline_status && j.pipeline_status !== 'awaiting_cvs' && (
                        <span className={`badge ${j.pipeline_status === 'notified' ? 'badge-green' : j.pipeline_status === 'complete' ? 'badge-blue' : j.pipeline_status === 'processing' ? 'badge-amber' : j.pipeline_status === 'pending_client_approval' ? 'badge-amber' : ''}`} style={{ fontSize: 9 }}>
                          {j.pipeline_status === 'processing' ? '⟳ running' : j.pipeline_status === 'complete' ? '✓ done' : j.pipeline_status === 'notified' ? '✉ notified' : j.pipeline_status === 'pending_client_approval' ? '⏸ awaiting approval' : j.pipeline_status}
                        </span>
                      )}
                      {webhookFails.has(j.id) && (
                        <span className="badge badge-red" style={{ fontSize: 9 }} title="HRIS webhook delivery failed">⚠ webhook</span>
                      )}
                      <span className="mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>
                        {cands.filter(c => c.match_score != null).length} screened ·{' '}
                        {cands.filter(c => c.scores != null).length} iv ·{' '}
                        {cands.filter(c => c.match_pass).length} pass
                      </span>
                      <span className="mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>
                        {new Date(j.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                      </span>
                      <button
                        className="btn btn-secondary"
                        style={{ fontSize: 10, padding: '3px 8px' }}
                        onClick={e => { e.stopPropagation(); navigate(`/recruiter/candidates?job=${j.id}`) }}
                      >Pipeline</button>
                      <button
                        className="btn btn-secondary"
                        style={{ fontSize: 10, padding: '3px 8px', color: 'var(--red)' }}
                        disabled={closing === j.id}
                        onClick={e => { e.stopPropagation(); toggleStatus(j) }}
                      >{closing === j.id ? '…' : 'Close'}</button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Closed jobs */}
          {(filter === 'all' || filter === 'closed') && filtered.filter(j => j.status !== 'active').length > 0 && (
            <div className="section-card">
              <div className="section-card-head">
                <h3>Closed</h3>
                <span className="badge badge-amber">{filtered.filter(j => j.status !== 'active').length}</span>
              </div>
              {filtered.filter(j => j.status !== 'active').map(j => (
                <div key={j.id} className="table-row" style={{ opacity: 0.65, cursor: 'pointer' }} onClick={() => navigate(`/recruiter/candidates?job=${j.id}`)}>
                  <div className="col-main">
                    <div className="col-name">{j.title}</div>
                    <div className="col-sub">{j.profiles?.company_name ?? j.profiles?.email ?? '—'} · {j.experience_years ?? 0}+ yrs</div>
                  </div>
                  <div className="col-right">
                    <span className="badge badge-amber">closed</span>
                    <button
                      className="btn btn-secondary"
                      style={{ fontSize: 10, padding: '3px 8px', color: 'var(--green)' }}
                      disabled={closing === j.id}
                      onClick={e => { e.stopPropagation(); toggleStatus(j) }}
                    >{closing === j.id ? '…' : 'Reopen'}</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {showInstant && (
        <InstantPost
          onClose={() => setShowInstant(false)}
          onSave={handleInstantSave}
          onCustomize={(prefill) => {
            setWizardPrefill(prefill)
            setShowInstant(false)
            setShowWizard(true)
          }}
        />
      )}

      {showWizard && (
        <JDWizard
          onClose={() => { setShowWizard(false); setWizardPrefill(null) }}
          onSave={handleWizardSave}
          showAssign
          assignLabel="client"
          recruiters={clients.map(c => ({ id: c.id, contact_name: c.company_name || c.full_name || c.email, company_name: c.company_name, email: c.email }))}
          prefill={wizardPrefill}
        />
      )}
    </div>
  )
}
