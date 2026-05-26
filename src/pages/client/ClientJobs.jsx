import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'
import { usePlan } from '../../hooks/usePlan'
import { TRIAL_LIMITS } from '../../config/trialLimits'
import PaidFeature from '../../components/PaidFeature'
import TrialNudgeBanner from '../../components/TrialNudgeBanner'
import { CURRENCIES, DEFAULT_CURRENCY, fmtSalary } from '../../utils/currency'
import { triggerTalentPoolMatch } from '../../utils/talentPool'
import TagInput from '../../components/TagInput'
import JDWizard from '../../components/JDWizard'
import InstantPost from '../../components/InstantPost'

const DEFAULT = { title: '', experience_years: 3, required_skills: [], preferred_skills: [], description: '', tech_weight: 60, comm_weight: 40, salary_min: '', salary_max: '', salary_currency: DEFAULT_CURRENCY }
const REC_COLOR = { 'Strong Hire': 'var(--green)', 'Hire': 'var(--accent)', 'Borderline': 'var(--amber)', 'Reject': 'var(--red)' }
const mono = { fontFamily: 'var(--font-mono)' }

function dimColor(v) { return v >= 70 ? 'var(--green)' : v >= 50 ? 'var(--accent)' : 'var(--red)' }

function getStage(c) {
  if (c.final_decision === 'hired' || c.offer_status === 'sent') return 'Hired'
  if (c.scores?.overallScore != null) return 'Interview Done'
  if (c.match_pass === true) return 'Interview Pending'
  if (c.match_pass === false) return 'Screened Out'
  return 'Applied'
}

function PipelineFunnel({ candidates, activeStage, onStageClick }) {
  const stages = [
    { key: 'all',              label: 'Total',            color: 'var(--accent)',  count: candidates.length },
    { key: 'Interview Pending',label: 'Interview Pending',color: 'var(--amber)',   count: candidates.filter(c => getStage(c) === 'Interview Pending').length },
    { key: 'Interview Done',   label: 'Interview Done',   color: 'var(--accent)',  count: candidates.filter(c => getStage(c) === 'Interview Done').length },
    { key: 'Screened Out',     label: 'Screened Out',     color: 'var(--red)',     count: candidates.filter(c => getStage(c) === 'Screened Out').length },
    { key: 'Hired',            label: 'Hired',            color: 'var(--green)',   count: candidates.filter(c => getStage(c) === 'Hired').length },
  ]
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8, marginBottom: 20 }}>
      {stages.map(s => (
        <div
          key={s.key}
          onClick={() => onStageClick(s.key)}
          style={{
            padding: '14px 12px', background: 'var(--surface)', border: `1px solid ${activeStage === s.key ? s.color : 'var(--border)'}`,
            borderTop: `3px solid ${s.color}`, cursor: 'pointer', textAlign: 'center',
            boxShadow: activeStage === s.key ? `0 0 0 1px ${s.color}` : 'none',
          }}
        >
          <div style={{ fontSize: 26, fontFamily: 'var(--font-head)', fontWeight: 300, color: s.color, lineHeight: 1 }}>{s.count}</div>
          <div style={{ fontSize: 10, ...mono, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-3)', marginTop: 4 }}>{s.label}</div>
        </div>
      ))}
    </div>
  )
}

function SourcingActivityPanel({ stats }) {
  const items = [
    { icon: '🔍', value: stats.profiles_scanned, label: 'LinkedIn profiles scanned' },
    { icon: '✓',  value: stats.profiles_matched,  label: 'matched your requirements' },
    { icon: '👤', value: stats.shortlisted,        label: 'shortlisted for your review' },
  ]
  return (
    <div style={{ marginBottom: 20, padding: '16px 20px', background: 'var(--surface)', border: '1px solid var(--border)', borderTop: '2px solid var(--accent)', borderRadius: 'var(--r)' }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--accent)', marginBottom: 14 }}>
        AI Sourcing Status
      </div>
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 0, marginBottom: 12 }}>
        {items.map(({ icon, value, label }, i) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8, paddingRight: i < 2 ? 20 : 0, marginRight: i < 2 ? 20 : 0, borderRight: i < 2 ? '1px solid var(--border)' : 'none' }}>
            <span style={{ fontSize: 14, lineHeight: 1 }}>{icon}</span>
            <span style={{ fontFamily: 'var(--font-head)', fontSize: 28, fontWeight: 300, color: 'var(--text)', lineHeight: 1 }}>{value}</span>
            <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{label}</span>
          </div>
        ))}
      </div>
      <p style={{ margin: 0, fontSize: 12, color: 'var(--text-3)', fontStyle: 'italic', lineHeight: 1.6 }}>
        One Select AI continuously scans LinkedIn to find the best candidates for your role. Your recruiter reviews and shortlists the top matches.
      </p>
    </div>
  )
}

function JobDetail({ job: initialJob, onBack, onUpdate }) {
  const [job, setJob] = useState(initialJob)
  const [candidates, setCandidates] = useState([])
  const [loading, setLoading] = useState(true)
  const [stageFilter, setStageFilter] = useState('all')
  const [selectedId, setSelectedId] = useState(null)
  const [editing, setEditing] = useState(false)
  const [activityLog, setActivityLog] = useState([])
  const [sourcing, setSourcing] = useState(null)
  const [editForm, setEditForm] = useState({
    title: initialJob.title ?? '',
    experience_years: initialJob.experience_years ?? 3,
    required_skills: initialJob.required_skills ?? [],
    preferred_skills: initialJob.preferred_skills ?? [],
    description: initialJob.description ?? '',
    salary_min: initialJob.salary_min ?? '',
    salary_max: initialJob.salary_max ?? '',
    salary_currency: initialJob.salary_currency ?? DEFAULT_CURRENCY,
  })
  const [updateSaving, setUpdateSaving] = useState(false)
  const [updateError, setUpdateError] = useState('')
  const setEF = (k, v) => setEditForm(f => ({ ...f, [k]: v }))

  async function handleUpdate(e) {
    e.preventDefault()
    setUpdateError('')
    setUpdateSaving(true)
    const patch = {
      title: editForm.title,
      experience_years: editForm.experience_years,
      required_skills: editForm.required_skills,
      preferred_skills: editForm.preferred_skills,
      description: editForm.description,
      salary_min: editForm.salary_min ? parseInt(editForm.salary_min, 10) : null,
      salary_max: editForm.salary_max ? parseInt(editForm.salary_max, 10) : null,
      salary_currency: editForm.salary_currency || DEFAULT_CURRENCY,
    }
    const { error } = await supabase.from('jobs').update(patch).eq('id', job.id)
    setUpdateSaving(false)
    if (error) { setUpdateError(error.message); return }
    const updated = { ...job, ...patch }
    setJob(updated)
    onUpdate?.(updated)
    setEditing(false)
  }

  useEffect(() => {
    supabase.from('candidates').select('*').eq('job_id', job.id)
      .not('match_pass', 'is', null)
      .order('match_score', { ascending: false, nullsFirst: false })
      .then(({ data }) => { setCandidates(data ?? []); setLoading(false) })
      .catch(() => setLoading(false))
    supabase.from('audit_log').select('action, actor_role, metadata, created_at').eq('job_id', job.id)
      .order('created_at', { ascending: false }).limit(20)
      .then(({ data }) => setActivityLog(data ?? []))
      .catch(() => {})
    supabase.rpc('get_sourcing_stats', { p_job_id: job.id })
      .then(({ data }) => { if (data) setSourcing(data) })
      .catch(() => {})
  }, [job.id])

  const filtered = stageFilter === 'all' ? candidates : candidates.filter(c => getStage(c) === stageFilter)
  const selected = candidates.find(c => c.id === selectedId)

  if (selected) {
    const s = selected.scores ?? {}
    const rec = s.recommendation
    return (
      <div className="page">
        <button className="btn btn-secondary" style={{ marginBottom: 20 }} onClick={() => setSelectedId(null)}>← Back to pipeline</button>
        <div className="profile-hero">
          <div className="profile-avatar">{(selected.full_name ?? '?')[0].toUpperCase()}</div>
          <div className="profile-id" style={{ flex: 1 }}>
            <h3>{selected.full_name}</h3>
            <p>{selected.candidate_role}{selected.total_years ? ` · ${selected.total_years}y exp` : ''}</p>
            {selected.match_score != null && (
              <div style={{ marginTop: 8 }}>
                <span className={`badge ${selected.match_pass ? 'badge-green' : 'badge-red'}`}>Screen {selected.match_score}/100</span>
              </div>
            )}
          </div>
          {s.overallScore != null && (
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 32, fontWeight: 700, color: dimColor(s.overallScore), lineHeight: 1 }}>{s.overallScore}</div>
              {rec && <div style={{ fontSize: 11, ...mono, textTransform: 'uppercase', color: REC_COLOR[rec] ?? 'var(--text-3)' }}>{rec}</div>}
            </div>
          )}
        </div>
        {selected.match_reason && (
          <div style={{ margin: '16px 0', padding: '12px 16px', background: 'var(--surface)', border: '1px solid var(--border)', borderLeft: `2px solid ${selected.match_pass ? 'var(--green)' : 'var(--red)'}`, fontSize: 13, color: 'var(--text-2)' }}>
            <div style={{ fontSize: 10, ...mono, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-3)', marginBottom: 4 }}>Screening verdict</div>
            {selected.match_reason}
          </div>
        )}
        {s.overallScore != null && (
          <div className="section-card">
            <div className="section-card-head"><h3>Interview Assessment</h3></div>
            <div className="section-card-body">
              {[['technicalAbility','Technical'],['communication','Communication'],['roleFit','Role Fit'],['problemSolving','Problem Solving'],['experienceRelevance','Experience']].map(([key, label]) => (
                <div key={key} className="score-dim" style={{ marginBottom: 10 }}>
                  <span className="dim-label">{label}</span>
                  <div className="dim-track"><div className="dim-fill" style={{ width: `${s[key] ?? 0}%`, background: dimColor(s[key] ?? 0) }} /></div>
                  <span className="dim-val">{s[key] ?? '—'}</span>
                </div>
              ))}
              {s.insight && <p style={{ marginTop: 12, fontSize: 13, color: 'var(--text-2)', lineHeight: 1.7, fontStyle: 'italic' }}>{s.insight}</p>}
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="page">
      <div className="page-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="btn btn-secondary" onClick={onBack}>← My Jobs</button>
          <div>
            <h2 style={{ margin: 0 }}>{job.title}</h2>
            <p style={{ margin: 0 }}>{job.experience_years}+ yrs{job.required_skills?.length ? ` · ${job.required_skills.slice(0, 4).join(', ')}` : ''}</p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span className={`badge ${job.status === 'active' ? 'badge-green' : 'badge-amber'}`}>{job.status}</span>
          <button className="btn btn-secondary" style={{ fontSize: 12, padding: '5px 12px' }} onClick={() => setEditing(v => !v)}>
            {editing ? 'Cancel Edit' : '✎ Edit Job'}
          </button>
        </div>
      </div>

      {editing && (
        <div className="section-card" style={{ marginBottom: 20 }}>
          <div className="section-card-head"><h3>Edit Job Details</h3></div>
          <div className="section-card-body">
            <form onSubmit={handleUpdate}>
              <div className="form-grid">
                <div className="field">
                  <label>Job Title</label>
                  <input type="text" required value={editForm.title} onChange={e => setEF('title', e.target.value)} />
                </div>
                <div className="field">
                  <label>Years of Experience</label>
                  <input type="number" min={0} value={editForm.experience_years} onChange={e => setEF('experience_years', +e.target.value)} />
                </div>
                <div className="field">
                  <label>Currency</label>
                  <select value={editForm.salary_currency} onChange={e => setEF('salary_currency', e.target.value)}>
                    {CURRENCIES.map(c => <option key={c.code} value={c.code}>{c.symbol} {c.name}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>Salary Min ({editForm.salary_currency === 'INR' ? 'LPA' : 'K'})</label>
                  <input type="number" min={0} value={editForm.salary_min} onChange={e => setEF('salary_min', e.target.value)} placeholder={editForm.salary_currency === 'INR' ? 'e.g. 18' : 'e.g. 50'} />
                </div>
                <div className="field">
                  <label>Salary Max ({editForm.salary_currency === 'INR' ? 'LPA' : 'K'})</label>
                  <input type="number" min={0} value={editForm.salary_max} onChange={e => setEF('salary_max', e.target.value)} placeholder={editForm.salary_currency === 'INR' ? 'e.g. 30' : 'e.g. 80'} />
                </div>
                <div className="field span-2">
                  <label>Required Skills</label>
                  <TagInput value={editForm.required_skills} onChange={v => setEF('required_skills', v)} placeholder="Type and press Enter…" />
                </div>
                <div className="field span-2">
                  <label>Preferred Skills</label>
                  <TagInput value={editForm.preferred_skills} onChange={v => setEF('preferred_skills', v)} placeholder="Nice-to-have…" />
                </div>
                <div className="field span-2">
                  <label>Description</label>
                  <textarea rows={6} value={editForm.description} onChange={e => setEF('description', e.target.value)} placeholder="Role responsibilities and context…" />
                </div>
              </div>
              {updateError && <div style={{ fontSize: 12, color: 'var(--red)', marginTop: 12 }}>{updateError}</div>}
              <div className="form-actions" style={{ marginTop: 16 }}>
                <button type="submit" className="btn btn-primary" disabled={updateSaving}>
                  {updateSaving ? <><span className="spinner" style={{ width: 12, height: 12 }} /> Saving…</> : 'Save Changes'}
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => setEditing(false)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {loading ? <div style={{ textAlign: 'center', padding: 40 }}><span className="spinner" /></div> : (
        <>
          {job.status === 'active' && sourcing?.profiles_scanned > 0 && (
            <SourcingActivityPanel stats={sourcing} />
          )}

          <PipelineFunnel candidates={candidates} activeStage={stageFilter} onStageClick={setStageFilter} />

          <div className="section-card">
            <div className="section-card-head">
              <h3>{stageFilter === 'all' ? 'All Candidates' : stageFilter}</h3>
              <span className="badge">{filtered.length}</span>
            </div>
            {filtered.length === 0 ? (
              <div className="empty-state">No candidates in this stage yet</div>
            ) : filtered.map(c => {
              const s = c.scores ?? {}
              const stage = getStage(c)
              const stageColor = { 'Hired': 'badge-green', 'Interview Done': 'badge-green', 'Interview Pending': 'badge-amber', 'Screened Out': 'badge-red', 'Applied': '' }
              return (
                <div key={c.id} className="table-row clickable" onClick={() => setSelectedId(c.id)}>
                  <div className="col-main">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div className="profile-avatar" style={{ width: 32, height: 32, fontSize: 13, borderRadius: 'var(--r)', flexShrink: 0 }}>
                        {(c.full_name ?? '?')[0].toUpperCase()}
                      </div>
                      <div>
                        <div className="col-name">{c.full_name}</div>
                        <div className="col-sub">{c.candidate_role}{c.total_years ? ` · ${c.total_years}y` : ''}</div>
                      </div>
                    </div>
                  </div>
                  <div className="col-right">
                    {c.match_score != null && (
                      <span style={{ fontSize: 11, ...mono, color: 'var(--text-3)' }}>Screen {c.match_score}</span>
                    )}
                    {s.overallScore != null && (
                      <span style={{ fontSize: 13, fontWeight: 700, ...mono, color: dimColor(s.overallScore) }}>{s.overallScore}</span>
                    )}
                    {s.recommendation && (
                      <span style={{ fontSize: 11, fontWeight: 600, ...mono, color: REC_COLOR[s.recommendation] ?? 'var(--text-3)' }}>{s.recommendation}</span>
                    )}
                    <span className={`badge ${stageColor[stage] ?? ''}`} style={{ fontSize: 10 }}>{stage}</span>
                  </div>
                </div>
              )
            })}
          </div>

          {activityLog.length > 0 && (
            <div className="section-card" style={{ marginTop: 16 }}>
              <div className="section-card-head"><h3>Recruiter Activity</h3></div>
              {activityLog.map((entry, i) => {
                const ACTION_LABEL = {
                  candidate_screened:   'Screened a candidate',
                  interview_scored:     'Scored an interview',
                  client_approved:      'Client approved a candidate',
                  client_rejected:      'Client rejected a candidate',
                  offer_sent:           'Offer sent',
                  candidate_hired:      'Candidate hired',
                  job_created:          'Job created',
                  job_updated:          'Job updated',
                }
                const label = ACTION_LABEL[entry.action] ?? entry.action.replace(/_/g, ' ')
                const who = entry.actor_role === 'client' ? 'You' : 'Recruiter'
                const name = entry.metadata?.candidate_name ? ` — ${entry.metadata.candidate_name}` : ''
                const reason = entry.metadata?.reason ? ` (${entry.metadata.reason})` : ''
                return (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '10px 20px', borderBottom: i < activityLog.length - 1 ? '1px solid var(--border)' : 'none', gap: 12 }}>
                    <div style={{ fontSize: 13, color: 'var(--text-2)' }}>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: entry.actor_role === 'client' ? 'var(--accent)' : 'var(--text-3)' }}>{who}</span>
                      {' '}{label}{name}{reason}
                    </div>
                    <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', flexShrink: 0 }}>
                      {new Date(entry.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default function ClientJobs() {
  const { user, effectiveClientId, isStakeholder } = useAuth()
  const { isTrial } = usePlan()
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [showWizard, setShowWizard] = useState(false)
  const [showInstant, setShowInstant] = useState(false)
  const [wizardPrefill, setWizardPrefill] = useState(null)
  const [form, setForm] = useState(DEFAULT)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [poolStatus, setPoolStatus] = useState({})
  const [selectedJob, setSelectedJob] = useState(null)

  useEffect(() => { if (user) load() }, [user])

  async function load() {
    try { // fix: wrap in try/finally so setLoading(false) always fires on query error
    const { data } = await supabase.from('jobs').select('*, candidates(count)').eq('recruiter_id', effectiveClientId).order('created_at', { ascending: false })
    setJobs(data ?? [])
    } finally {
      setLoading(false) // fix: always clear loading even when queries fail
    }
  }

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const setTech = (v) => { set('tech_weight', v); set('comm_weight', 100 - v) }

  async function handleCreate(e) {
    e.preventDefault()
    setError('')
    if (isTrial && jobs.length >= TRIAL_LIMITS.max_jobs) {
      setError(`Trial accounts can post up to ${TRIAL_LIMITS.max_jobs} jobs. Upgrade to post unlimited jobs.`)
      return
    }
    setSaving(true)
    const { data, error: err } = await supabase.from('jobs').insert({
      recruiter_id: user.id,
      title: form.title,
      experience_years: form.experience_years,
      required_skills: form.required_skills,
      preferred_skills: form.preferred_skills,
      description: form.description,
      tech_weight: form.tech_weight,
      comm_weight: form.comm_weight,
      salary_min: form.salary_min ? parseInt(form.salary_min, 10) : null,
      salary_max: form.salary_max ? parseInt(form.salary_max, 10) : null,
      salary_currency: form.salary_currency || DEFAULT_CURRENCY,
      status: 'active',
    }).select().single()
    setSaving(false)
    if (err) { setError(err.message); return }
    setJobs(p => [data, ...p])
    setShowForm(false)
    setForm(DEFAULT)

    setPoolStatus(p => ({ ...p, [data.id]: 'scanning' }))
    triggerTalentPoolMatch(data.id)
      .then(passed => setPoolStatus(p => ({ ...p, [data.id]: `done:${passed}` })))
      .catch(() => setPoolStatus(p => ({ ...p, [data.id]: 'error' })))
  }

  async function handleInstantSave(jobData) {
    setShowInstant(false)
    setError('')
    if (isTrial && jobs.length >= TRIAL_LIMITS.max_jobs) {
      setError(`Trial accounts can post up to ${TRIAL_LIMITS.max_jobs} jobs. Upgrade to post unlimited jobs.`)
      return
    }
    const { data, error: err } = await supabase.from('jobs').insert({
      recruiter_id:    user.id,
      status:          'active',
      title:           jobData.title,
      description:     jobData.description,
      required_skills: jobData.required_skills,
      preferred_skills:jobData.preferred_skills,
      experience_years:jobData.experience_years,
      tech_weight:     jobData.tech_weight,
      comm_weight:     jobData.comm_weight,
    }).select().single()
    if (err) { setError(err.message); return }
    await load()
    setPoolStatus(p => ({ ...p, [data.id]: 'scanning' }))
    triggerTalentPoolMatch(data.id)
      .then(passed => setPoolStatus(p => ({ ...p, [data.id]: `done:${passed}` })))
      .catch(() => setPoolStatus(p => ({ ...p, [data.id]: 'error' })))
  }

  async function handleWizardSave(jobData) {
    setShowWizard(false)
    setError('')
    if (isTrial && jobs.length >= TRIAL_LIMITS.max_jobs) {
      setError(`Trial accounts can post up to ${TRIAL_LIMITS.max_jobs} jobs. Upgrade to post unlimited jobs.`)
      return
    }
    const { data, error: err } = await supabase.from('jobs').insert({
      recruiter_id: user.id,
      status: 'active',
      title:            jobData.title,
      description:      jobData.description,
      required_skills:  jobData.required_skills,
      preferred_skills: jobData.preferred_skills,
      experience_years: jobData.experience_years,
      tech_weight:      jobData.tech_weight,
      comm_weight:      jobData.comm_weight,
    }).select().single()
    if (err) { setError(err.message); return }

    await load()

    setPoolStatus(p => ({ ...p, [data.id]: 'scanning' }))
    triggerTalentPoolMatch(data.id)
      .then(passed => setPoolStatus(p => ({ ...p, [data.id]: `done:${passed}` })))
      .catch(() => setPoolStatus(p => ({ ...p, [data.id]: 'error' })))
  }

  async function toggleStatus(job, e) {
    e.stopPropagation()
    const newStatus = job.status === 'active' ? 'closed' : 'active'
    await supabase.from('jobs').update({ status: newStatus }).eq('id', job.id)
    setJobs(p => p.map(j => j.id === job.id ? { ...j, status: newStatus } : j))
  }

  const activeJobs = jobs.filter(j => j.status === 'active')
  const closedJobs = jobs.filter(j => j.status !== 'active')

  if (loading) return <div className="page"><span className="spinner" /></div>

  if (selectedJob) return (
    <JobDetail
      job={selectedJob}
      onBack={() => setSelectedJob(null)}
      onUpdate={updated => {
        setJobs(p => p.map(j => j.id === updated.id ? { ...j, ...updated } : j))
        setSelectedJob(updated)
      }}
    />
  )

  return (
    <div className="page">
      <TrialNudgeBanner />
      <div className="page-head">
        <div>
          <h2>My Jobs</h2>
          <p>{activeJobs.length} active · {closedJobs.length} closed</p>
        </div>
        {!isStakeholder && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary" onClick={() => { setShowForm(!showForm); setError('') }}>
              {showForm ? 'Cancel' : '+ Quick Add'}
            </button>
            <button className="btn btn-secondary" onClick={() => { setShowWizard(true); setShowForm(false) }}>
              Step-by-step
            </button>
            <button className="btn btn-primary" onClick={() => { setShowInstant(true); setShowForm(false) }}>
              ✨ Post a Job
            </button>
          </div>
        )}
      </div>

      {error && <div className="error-banner" style={{ marginBottom: 16 }}>{error}</div>}

      {showForm && (
        <div className="section-card" style={{ marginBottom: 20 }}>
          <div className="section-card-head"><h3>New Job Posting</h3></div>
          <div className="section-card-body">
            <form onSubmit={handleCreate}>
              <div className="form-grid">
                <div className="field">
                  <label>Job Title</label>
                  <input type="text" required value={form.title} placeholder="e.g. Senior Backend Engineer" onChange={e => set('title', e.target.value)} />
                </div>
                <div className="field">
                  <label>Years of Experience</label>
                  <input type="number" min={0} value={form.experience_years} onChange={e => set('experience_years', +e.target.value)} />
                </div>
                <div className="field">
                  <label>Currency</label>
                  <select value={form.salary_currency} onChange={e => set('salary_currency', e.target.value)}>
                    {CURRENCIES.map(c => <option key={c.code} value={c.code}>{c.symbol} {c.name}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>Salary Min ({form.salary_currency === 'INR' ? 'LPA' : 'K'})</label>
                  <input type="number" min={0} value={form.salary_min} onChange={e => set('salary_min', e.target.value)} placeholder={form.salary_currency === 'INR' ? 'e.g. 18' : 'e.g. 50'} />
                </div>
                <div className="field">
                  <label>Salary Max ({form.salary_currency === 'INR' ? 'LPA' : 'K'})</label>
                  <input type="number" min={0} value={form.salary_max} onChange={e => set('salary_max', e.target.value)} placeholder={form.salary_currency === 'INR' ? 'e.g. 30' : 'e.g. 80'} />
                </div>
                <div className="field span-2">
                  <label>Required Skills</label>
                  <TagInput value={form.required_skills} onChange={v => set('required_skills', v)} placeholder="Type and press Enter…" />
                </div>
                <div className="field span-2">
                  <label>Preferred Skills</label>
                  <TagInput value={form.preferred_skills} onChange={v => set('preferred_skills', v)} placeholder="Nice-to-have…" />
                </div>
                <div className="field span-2">
                  <label>Description</label>
                  <textarea rows={4} value={form.description} onChange={e => set('description', e.target.value)} placeholder="Role responsibilities and context…" />
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
                      <input type="range" min={10} max={90} value={form.comm_weight} onChange={e => { set('comm_weight', +e.target.value); set('tech_weight', 100 - +e.target.value) }} />
                      <span className="weight-val">{form.comm_weight}%</span>
                    </div>
                  </div>
                </div>
              </div>
              <div className="form-actions" style={{ marginTop: 20 }}>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? <><span className="spinner" style={{ width: 12, height: 12 }} /> Saving…</> : 'Create Job'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {jobs.length === 0 ? (
        <div className="section-card">
          <div className="empty-state">
            <div style={{ fontSize: 32, marginBottom: 12, opacity: 0.25 }}>◫</div>
            <div style={{ fontSize: 16, fontFamily: 'var(--font-head)', fontWeight: 400, color: 'var(--text-2)', marginBottom: 8 }}>No job postings yet</div>
            <div style={{ fontSize: 13, marginBottom: 20 }}>Create your first job to start the hiring pipeline.</div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
              <button className="btn btn-secondary" onClick={() => setShowForm(true)}>+ Quick Add</button>
              <button className="btn btn-primary" onClick={() => setShowInstant(true)}>✨ Post a Job</button>
            </div>
          </div>
        </div>
      ) : (
        <>
          {activeJobs.length > 0 && (
            <div className="section-card" style={{ marginBottom: 16 }}>
              <div className="section-card-head"><h3>Active</h3><span className="badge badge-green">{activeJobs.length}</span></div>
              {activeJobs.map(j => (
                <div key={j.id} className="table-row clickable" onClick={() => setSelectedJob(j)}>
                  <div className="col-main">
                    <div className="col-name">
                      {j.job_code && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-3)', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r)', padding: '1px 6px', marginRight: 7, letterSpacing: '0.04em' }}>{j.job_code}</span>}
                      {j.title}
                    </div>
                    <div className="col-sub">
                      {j.experience_years}+ yrs
                      {j.required_skills?.length ? ` · ${j.required_skills.slice(0, 3).join(', ')}${j.required_skills.length > 3 ? '…' : ''}` : ''}
                      {j.salary_min && j.salary_max && <span style={{ marginLeft: 6, color: 'var(--green)', fontFamily: 'var(--font-mono)', fontSize: 10 }}>{fmtSalary(j.salary_min, j.salary_max, j.salary_currency)}</span>}
                    </div>
                  </div>
                  <div className="col-right">
                    <span className="mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>
                      {j.candidates?.[0]?.count ?? 0} candidate{j.candidates?.[0]?.count !== 1 ? 's' : ''}
                    </span>
                    {poolStatus[j.id] === 'scanning' && (
                      <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span className="spinner" style={{ width: 9, height: 9 }} /> scanning pool…
                      </span>
                    )}
                    {poolStatus[j.id]?.startsWith('done:') && (
                      <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--green)' }}>
                        ✓ {poolStatus[j.id].split(':')[1]} pool match{poolStatus[j.id].split(':')[1] !== '1' ? 'es' : ''}
                      </span>
                    )}
                    <span className="mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>
                      {new Date(j.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                    </span>
                    <button
                      className="btn btn-secondary"
                      style={{ fontSize: 10, padding: '4px 10px' }}
                      onClick={e => toggleStatus(j, e)}
                    >
                      Close
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {closedJobs.length > 0 && (
            <div className="section-card">
              <div className="section-card-head"><h3>Closed</h3><span className="badge badge-amber">{closedJobs.length}</span></div>
              {closedJobs.map(j => (
                <div key={j.id} className="table-row" style={{ opacity: 0.6 }}>
                  <div className="col-main">
                    <div className="col-name">
                      {j.job_code && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-3)', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r)', padding: '1px 6px', marginRight: 7, letterSpacing: '0.04em' }}>{j.job_code}</span>}
                      {j.title}
                    </div>
                    <div className="col-sub">{j.experience_years}+ yrs</div>
                  </div>
                  <div className="col-right">
                    <span className="badge badge-amber">closed</span>
                    <button
                      className="btn btn-secondary"
                      style={{ fontSize: 10, padding: '4px 10px' }}
                      onClick={e => toggleStatus(j, e)}
                    >
                      Reopen
                    </button>
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
          showAssign={false}
          prefill={wizardPrefill}
        />
      )}
    </div>
  )
}
