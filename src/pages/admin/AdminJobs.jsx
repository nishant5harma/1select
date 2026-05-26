import { useState, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'
import { logAudit } from '../../utils/audit'
import JDWizard from '../../components/JDWizard'
import { downloadCsv, candidateRows } from '../../utils/exportCsv'

// ── Requirements-met logic ────────────────────────────────────────────────────
// met      = 1+ candidate with match_pass=true AND Strong Hire/Hire recommendation
// progress = 1+ passed screening, pending interview
// attention= candidates exist but none qualified
// awaiting = no candidates at all
function reqStatus(cands) {
  if (!cands.length) return 'awaiting'
  const hasStrong = cands.some(c =>
    c.match_pass && ['Strong Hire', 'Hire'].includes(c.scores?.recommendation)
  )
  if (hasStrong) return 'met'
  const pendingInterview = cands.some(c => c.match_pass && !c.scores)
  if (pendingInterview) return 'progress'
  return 'attention'
}

const REQ_CFG = {
  met:       { label: 'Requirements Met', cls: 'badge-green' },
  progress:  { label: 'In Progress',      cls: 'badge-blue'  },
  attention: { label: 'Needs Attention',  cls: 'badge-red'   },
  awaiting:  { label: 'Awaiting CVs',     cls: 'badge-amber' },
}

const COL = '2fr 1.5fr 90px 140px 170px 60px 90px 120px'

export default function AdminJobs() {
  const { user, profile } = useAuth()
  const location   = useLocation()
  const navigate   = useNavigate()
  const clientId   = location.state?.clientId   ?? null
  const clientName = location.state?.clientName ?? null

  const [jobs,           setJobs]           = useState([])
  const [candMap,        setCandMap]        = useState({})  // job_id → Candidate[]
  const [webhookFails,   setWebhookFails]   = useState(new Set())  // job_ids with unresolved failures
  const [retryingWebhook, setRetryingWebhook] = useState(new Set()) // job_ids currently retrying
  const [webhookModal,   setWebhookModal]   = useState(null) // { job, failures, retrying }
  const [loading,        setLoading]        = useState(true)
  const [filter,         setFilter]         = useState('all')
  const [closing,        setClosing]        = useState(null)
  const [showWizard,     setShowWizard]     = useState(false)
  const [recruiters,     setRecruiters]     = useState([])
  const [error,          setError]          = useState('')

  useEffect(() => { load(); loadRecruiters() }, [])

  async function loadRecruiters() {
    const { data } = await supabase
      .from('profiles')
      .select('id, email, contact_name, company_name')
      .eq('user_role', 'recruiter')
      .order('contact_name', { ascending: true })
    setRecruiters(data ?? [])
  }

  async function handleWizardSave(jobData) {
    setShowWizard(false)
    setError('')
    const { assigned_to, work_mode, comp_min, comp_max, ...rest } = jobData
    const recruiterId = assigned_to ?? null
    if (!recruiterId) { setError('No recruiter assigned — job not saved'); return }
    const { data: newJob, error: err } = await supabase.from('jobs').insert({
      recruiter_id: recruiterId,
      status: 'active',
      work_mode,
      salary_min: rest.salary_min ?? comp_min ?? null,
      salary_max: rest.salary_max ?? comp_max ?? null,
      ...rest,
    }).select().single()
    if (err) { setError(err.message); return }
    logAudit(supabase, {
      actorId:    user?.id,
      actorRole:  profile?.user_role ?? 'admin',
      action:     'job_created',
      entityType: 'job',
      entityId:   newJob?.id,
      jobId:      newJob?.id ?? null,
      metadata:   { title: newJob?.title, recruiter_id: recruiterId },
    })
    // Fire LinkedIn sourcing in background — never blocks job creation
    if (newJob) {
      supabase.functions.invoke('source-linkedin-candidates', {
        body: {
          job_id:           newJob.id,
          job_title:        newJob.title,
          job_description:  newJob.description ?? '',
          skills:           newJob.required_skills ?? [],
          location:         'India',
          experience_level: newJob.experience_years ? `${newJob.experience_years}+ years` : '',
        },
      }).catch(() => {})
    }
    load()
  }

  async function load() {
    try { // fix: wrap in try/finally so setLoading(false) always fires even on query error
      let q = supabase
        .from('jobs')
        .select('*, profiles(company_name, email)')
        .order('created_at', { ascending: false })
      if (clientId) q = q.eq('recruiter_id', clientId)

      const { data: jobData } = await q
      const ids = (jobData ?? []).map(j => j.id)

      let candData = []
      if (ids.length) {
        const { data } = await supabase
          .from('candidates')
          .select('job_id, match_pass, match_score, scores')
          .in('job_id', ids)
        candData = data ?? []
      }

      const cm = {}
      candData.forEach(c => {
        if (!cm[c.job_id]) cm[c.job_id] = []
        cm[c.job_id].push(c)
      })

      let failSet = new Set()
      if (ids.length) {
        const { data: failures } = await supabase.from('webhook_failures').select('job_id').in('job_id', ids).eq('resolved', false)
        ;(failures ?? []).forEach(f => failSet.add(f.job_id))
      }

      setJobs(jobData ?? [])
      setCandMap(cm)
      setWebhookFails(failSet)
    } finally {
      setLoading(false) // fix: always clear loading even when queries fail
    }
  }

  async function toggleStatus(job) {
    setClosing(job.id)
    const next = job.status === 'active' ? 'closed' : 'active'
    await supabase.from('jobs').update({ status: next }).eq('id', job.id)
    setJobs(p => p.map(j => j.id === job.id ? { ...j, status: next } : j))
    logAudit(supabase, {
      actorId:    user?.id,
      actorRole:  profile?.user_role ?? 'admin',
      action:     next === 'closed' ? 'job_closed' : 'job_reopened',
      entityType: 'job',
      entityId:   job.id,
      jobId:      job.id,
      metadata:   { title: job.title, new_status: next },
    })
    setClosing(null)
  }

  const filtered = filter === 'all' ? jobs : jobs.filter(j => j.status === filter)

  // ── Stats (only meaningful for all-client view) ───────────────────────────
  const activeJobs    = jobs.filter(j => j.status === 'active')
  const withStrong    = activeJobs.filter(j => reqStatus(candMap[j.id] ?? []) === 'met').length
  const needAttention = activeJobs.filter(j => {
    const st = reqStatus(candMap[j.id] ?? [])
    return st === 'attention' || st === 'awaiting'
  }).length
  const avgDays = activeJobs.length
    ? Math.round(
        activeJobs.reduce((s, j) => s + (Date.now() - new Date(j.created_at)) / 86_400_000, 0)
        / activeJobs.length
      )
    : 0

  if (loading) return <div className="page"><span className="spinner" /></div>

  return (
    <div className="page">
      <div className="page-head">
        <div>
          {clientName && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <button
                className="btn btn-secondary"
                style={{ fontSize: 11, padding: '3px 8px' }}
                onClick={() => navigate('/admin/clients')}
              >← Clients</button>
              <span className="mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>{clientName}</span>
            </div>
          )}
          <h2>{clientName ? 'Jobs' : 'All Jobs'}</h2>
          <p>
            {jobs.length} job{jobs.length !== 1 ? 's' : ''}
            {clientName ? ' for this client' : ' across all clients'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {['all', 'active', 'closed'].map(s => (
            <button
              key={s}
              className={`btn ${filter === s ? 'btn-primary' : 'btn-secondary'}`}
              style={{ padding: '6px 12px', fontSize: 12, textTransform: 'capitalize' }}
              onClick={() => setFilter(s)}
            >{s}</button>
          ))}
          <button
            className="btn btn-primary"
            style={{ marginLeft: 6 }}
            onClick={() => setShowWizard(true)}
          >✨ Create with AI</button>
        </div>
      </div>

      {error && <div className="error-banner" style={{ marginBottom: 16 }}>{error}</div>}

      {/* ── Stats bar (all-client view only) ── */}
      {!clientId && (
        <div className="metrics-row" style={{ marginBottom: 24 }}>
          <div className="metric-card">
            <span className="metric-val">{activeJobs.length}</span>
            <span className="metric-label">Active Jobs</span>
          </div>
          <div className="metric-card green">
            <span className="metric-val">{withStrong}</span>
            <span className="metric-label">Requirements Met</span>
          </div>
          <div className="metric-card amber">
            <span className="metric-val">{needAttention}</span>
            <span className="metric-label">Needs Attention</span>
          </div>
          <div className="metric-card">
            <span className="metric-val">{avgDays}d</span>
            <span className="metric-label">Avg Days Open</span>
          </div>
        </div>
      )}

      {/* ── Jobs table ── */}
      <div className="section-card">
        <div className="section-card-head">
          <h3>{clientName ? `${clientName} · Jobs` : 'All Jobs'}</h3>
          <span className="mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>{filtered.length} shown</span>
        </div>

        {filtered.length === 0 ? (
          <div className="empty-state">
            {jobs.length === 0 ? 'No jobs created yet.' : 'No jobs match this filter.'}
          </div>
        ) : (
          <>
            {/* Table header */}
            <div style={{
              display: 'grid', gridTemplateColumns: COL, gap: '0 10px',
              padding: '8px 20px', borderBottom: '1px solid var(--border)',
              fontSize: 10, fontFamily: 'var(--font-mono)',
              textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-3)',
            }}>
              <span>Job</span>
              <span>{clientId ? 'Created' : 'Client'}</span>
              <span>Status</span>
              <span>Req. Met</span>
              <span>Candidates</span>
              <span style={{ textAlign: 'right' }}>Top</span>
              <span style={{ textAlign: 'right' }}>Date</span>
              <span>Actions</span>
            </div>

            {filtered.map(j => {
              const cands      = candMap[j.id] ?? []
              const rq         = reqStatus(cands)
              const rqCfg      = REQ_CFG[rq]
              const screened   = cands.filter(c => c.match_score != null).length
              const interviewed = cands.filter(c => c.scores != null).length
              const qualified  = cands.filter(c => c.match_pass).length
              const topScore   = cands.reduce((mx, c) => Math.max(mx, c.match_score ?? 0), 0)
              const daysOpen   = Math.floor((Date.now() - new Date(j.created_at)) / 86_400_000)
              const slaTarget  = j.sla_days ?? 30
              const slaBreached = j.status === 'active' && daysOpen > slaTarget
              const slaWarning  = j.status === 'active' && daysOpen > slaTarget * 0.75 && !slaBreached

              return (
                <div key={j.id} style={{
                  display: 'grid', gridTemplateColumns: COL, gap: '0 10px',
                  padding: '13px 20px', borderBottom: '1px solid var(--border2)',
                  alignItems: 'center',
                }}>
                  {/* Job title */}
                  <div>
                    <div style={{ fontWeight: 500, fontSize: 13, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                      {j.job_code && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-3)', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r)', padding: '1px 6px', letterSpacing: '0.04em', fontWeight: 400 }}>{j.job_code}</span>}
                      {j.title}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
                      {j.experience_years ?? 0}+ yrs
                      {(j.required_skills ?? []).length > 0 &&
                        ` · ${(j.required_skills ?? []).slice(0, 2).join(', ')}${(j.required_skills ?? []).length > 2 ? '…' : ''}`}
                    </div>
                  </div>

                  {/* Client / date */}
                  <div style={{ fontSize: 12, color: 'var(--text-2)' }}>
                    {clientId
                      ? new Date(j.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
                      : (j.profiles?.company_name ?? j.profiles?.email ?? '—')}
                  </div>

                  {/* Status */}
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    <span className={`badge ${j.status === 'active' ? 'badge-green' : j.status === 'closed' ? 'badge-red' : 'badge-amber'}`} style={{ fontSize: 9 }}>
                      {j.status ?? 'active'}
                    </span>
                    {slaBreached && <span className="badge badge-red" style={{ fontSize: 9 }} title={`${daysOpen}d open — SLA target ${slaTarget}d`}>⚠ {daysOpen}d</span>}
                    {slaWarning  && <span className="badge badge-amber" style={{ fontSize: 9 }} title={`${daysOpen}d open — SLA target ${slaTarget}d`}>{daysOpen}d</span>}
                    {j.pipeline_status && j.pipeline_status !== 'awaiting_cvs' && (
                      <span className={`badge ${j.pipeline_status === 'notified' ? 'badge-green' : j.pipeline_status === 'complete' ? 'badge-blue' : j.pipeline_status === 'processing' ? 'badge-amber' : j.pipeline_status === 'pending_client_approval' ? 'badge-amber' : ''}`} style={{ fontSize: 9 }}>
                        {j.pipeline_status === 'processing' ? '⟳ running' : j.pipeline_status === 'complete' ? '✓ done' : j.pipeline_status === 'notified' ? '✉ notified' : j.pipeline_status === 'pending_client_approval' ? '⏸ awaiting approval' : j.pipeline_status}
                      </span>
                    )}
                    {webhookFails.has(j.id) && (
                      <button
                        className="badge badge-red"
                        style={{ fontSize: 9, cursor: 'pointer', border: 'none', padding: '2px 6px' }}
                        title="HRIS webhook failed — click for details"
                        onClick={async (e) => {
                          e.stopPropagation()
                          const { data: failures } = await supabase
                            .from('webhook_failures')
                            .select('id, error_message, created_at, payload')
                            .eq('job_id', j.id)
                            .eq('resolved', false)
                            .order('created_at', { ascending: false })
                          setWebhookModal({ job: j, failures: failures ?? [], retrying: false })
                        }}
                      >
                        ⚠ webhook failed
                      </button>
                    )}
                  </div>

                  {/* Requirements met */}
                  <div>
                    <span className={`badge ${rqCfg.cls}`} style={{ fontSize: 9, whiteSpace: 'nowrap' }}>
                      {rqCfg.label}
                    </span>
                  </div>

                  {/* Candidate counts */}
                  <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', whiteSpace: 'nowrap' }}>
                    <span style={{ color: screened    > 0 ? 'var(--text)'   : undefined }}>{screened}</span> screened ·{' '}
                    <span style={{ color: interviewed > 0 ? 'var(--accent)' : undefined }}>{interviewed}</span> iv ·{' '}
                    <span style={{ color: qualified   > 0 ? 'var(--green)'  : undefined }}>{qualified}</span> pass
                  </div>

                  {/* Top score */}
                  <div style={{
                    textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 13,
                    color: topScore >= 70 ? 'var(--green)' : topScore >= 50 ? 'var(--accent)' : 'var(--text-3)',
                  }}>
                    {topScore > 0 ? topScore : '—'}
                  </div>

                  {/* Date */}
                  <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', textAlign: 'right' }}>
                    {new Date(j.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })}
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    <button
                      className="btn btn-secondary"
                      style={{ fontSize: 10, padding: '3px 7px', whiteSpace: 'nowrap' }}
                      onClick={() => navigate(`/admin/pipeline?client=${j.recruiter_id}&job=${j.id}`)}
                    >Pipeline</button>
                    <button
                      className="btn btn-secondary"
                      style={{ fontSize: 10, padding: '3px 7px', whiteSpace: 'nowrap', color: j.status === 'active' ? 'var(--red)' : 'var(--green)' }}
                      disabled={closing === j.id}
                      onClick={() => toggleStatus(j)}
                    >{closing === j.id ? '…' : j.status === 'active' ? 'Close' : 'Reopen'}</button>
                    <button
                      className="btn btn-secondary"
                      style={{ fontSize: 10, padding: '3px 7px', whiteSpace: 'nowrap' }}
                      onClick={async () => {
                        const { data } = await supabase.from('candidates').select('*').eq('job_id', j.id).order('match_score', { ascending: false })
                        downloadCsv(`${j.job_code ?? j.id}-candidates.csv`, candidateRows(data ?? [], j.title))
                      }}
                    >↓ CSV</button>
                  </div>
                </div>
              )
            })}
          </>
        )}
      </div>

      {/* ── Webhook Failure Modal ── */}
      {webhookModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000 }}>
          <div style={{ background: 'var(--surface)', borderRadius: 12, padding: 28, width: 500, display: 'flex', flexDirection: 'column', gap: 16, maxHeight: '80vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Webhook Failure — {webhookModal.job.title}</div>
                <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{webhookModal.failures.length} unresolved failure{webhookModal.failures.length !== 1 ? 's' : ''}</div>
              </div>
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--text-3)', lineHeight: 1 }} onClick={() => setWebhookModal(null)}>✕</button>
            </div>

            {webhookModal.failures.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--text-3)', padding: '16px 0', textAlign: 'center' }}>No failure details found.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {webhookModal.failures.map((f, i) => (
                  <div key={f.id} style={{ padding: '12px 14px', background: 'var(--bg)', border: '1px solid var(--border)', borderLeft: '2px solid var(--red)' }}>
                    <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', marginBottom: 4 }}>
                      {new Date(f.created_at).toLocaleString('en-GB')}
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--red)', lineHeight: 1.5 }}>{f.error_message ?? 'Unknown error'}</div>
                    {f.payload && (
                      <details style={{ marginTop: 6 }}>
                        <summary style={{ fontSize: 11, color: 'var(--text-3)', cursor: 'pointer', fontFamily: 'var(--font-mono)' }}>Payload</summary>
                        <pre style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 4, overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{JSON.stringify(f.payload, null, 2)}</pre>
                      </details>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setWebhookModal(null)}>Close</button>
              <button
                className="btn btn-primary"
                disabled={webhookModal.retrying}
                onClick={async () => {
                  setWebhookModal(m => ({ ...m, retrying: true }))
                  try {
                    const cands = candMap[webhookModal.job.id] ?? []
                    const target = cands.find(c => c.final_decision === 'hired' || c.offer_status === 'sent') ?? cands[0]
                    if (target) {
                      await supabase.functions.invoke('trigger-webhook', {
                        body: { candidateId: target.id, event: 'candidate.hired' },
                      })
                    }
                    // Mark failures as resolved
                    await supabase.from('webhook_failures').update({ resolved: true }).eq('job_id', webhookModal.job.id).eq('resolved', false)
                    setWebhookFails(prev => { const n = new Set(prev); n.delete(webhookModal.job.id); return n })
                    setWebhookModal(null)
                  } catch {
                    setWebhookModal(m => ({ ...m, retrying: false }))
                  }
                }}
              >
                {webhookModal.retrying ? <><span className="spinner" style={{ width: 11, height: 11 }} /> Retrying…</> : 'Retry Now'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showWizard && (
        <JDWizard
          onClose={() => setShowWizard(false)}
          onSave={handleWizardSave}
          showAssign
          recruiters={recruiters}
        />
      )}
    </div>
  )
}
