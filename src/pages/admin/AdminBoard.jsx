import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'
import { logAudit } from '../../utils/audit'

const COLUMNS = [
  { stage: 'uploaded',   label: 'Applied / Uploaded', color: 'var(--text-3)' },
  { stage: 'screening',  label: 'Screening',           color: 'var(--amber)'  },
  { stage: 'passed',     label: 'Passed Screening',    color: 'var(--accent)' },
  { stage: 'assessment', label: 'Assessment',          color: '#6b7fd7'       },
  { stage: 'interview',  label: 'Interview',           color: 'var(--accent)' },
  { stage: 'strong_hire',label: 'Strong Hire',         color: 'var(--green)'  },
  { stage: 'hired',      label: 'Hired',               color: 'var(--green)'  },
  { stage: 'rejected',   label: 'Rejected',            color: 'var(--red)'    },
]

const REC_COLOR = {
  'Strong Hire': 'var(--green)',
  'Hire':        'var(--accent)',
  'Borderline':  'var(--amber)',
  'Reject':      'var(--red)',
}

function deriveStage(c) {
  if (c.stage) return c.stage
  if (c.final_decision === 'hired')    return 'hired'
  if (c.final_decision === 'rejected') return 'rejected'
  if (c.scores?.recommendation === 'Strong Hire') return 'strong_hire'
  if (c.scores?.overallScore != null)  return 'interview'
  if (c.match_pass === true)           return 'passed'
  if (c.match_score != null)           return 'screening'
  return 'uploaded'
}

function daysSince(dt) {
  if (!dt) return 0
  return Math.floor((Date.now() - new Date(dt).getTime()) / 86400000)
}

function dimColor(v) {
  return v >= 70 ? 'var(--green)' : v >= 50 ? 'var(--accent)' : 'var(--red)'
}

export default function AdminBoard() {
  const { user, profile } = useAuth()
  const [allCandidates, setAllCandidates] = useState([])
  const [clients,       setClients]       = useState([])
  const [jobs,          setJobs]          = useState([])
  const [filter,        setFilter]        = useState({ clientId: '', jobId: '', recommendation: '', search: '' })
  const [loading,       setLoading]       = useState(true)
  const [loadError,     setLoadError]     = useState('')
  const [dropTarget,    setDropTarget]    = useState(null)
  const dragId = useRef(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    setLoadError('')
    try { // fix: wrap in try/finally so setLoading(false) always fires on query error
    const [
      { data: cands, error: candsErr },
      { data: clientData },
      { data: jobData },
    ] = await Promise.all([
      supabase.from('candidates')
        .select('*, jobs(id, title, recruiter_id, profiles(company_name))')
        .order('created_at', { ascending: false })
        .limit(2000),
      supabase.from('profiles').select('id, company_name, full_name').eq('user_role', 'client'),
      supabase.from('jobs').select('id, title, recruiter_id').eq('status', 'active'),
    ])
    if (candsErr) { setLoadError(candsErr.message); return }
    setAllCandidates((cands ?? []).map(c => ({ ...c, _stage: deriveStage(c) })))
    setClients(clientData ?? [])
    setJobs(jobData ?? [])
    } finally {
      setLoading(false) // fix: always clear loading even when queries fail
    }
  }

  async function moveCard(candidateId, newStage) {
    const candidate  = allCandidates.find(c => c.id === candidateId)
    const fromStage  = candidate?._stage ?? 'unknown'
    const updates    = { stage: newStage }
    if (newStage === 'hired')    updates.final_decision = 'hired'
    if (newStage === 'rejected') updates.final_decision = 'rejected'
    await supabase.from('candidates').update(updates).eq('id', candidateId)
    setAllCandidates(p => p.map(c => c.id === candidateId ? { ...c, _stage: newStage, ...updates } : c))
    logAudit(supabase, {
      actorId:    user?.id,
      actorRole:  profile?.user_role ?? 'admin',
      action:     'stage_move',
      entityType: 'candidate',
      entityId:   candidateId,
      jobId:      candidate?.job_id ?? null,
      metadata:   { from_stage: fromStage, to_stage: newStage, candidate_name: candidate?.full_name },
    })
  }

  const filtered = allCandidates.filter(c => {
    if (filter.search && !c.full_name?.toLowerCase().includes(filter.search.toLowerCase())) return false
    if (filter.clientId && c.jobs?.recruiter_id !== filter.clientId) return false
    if (filter.jobId && c.job_id !== filter.jobId) return false
    if (filter.recommendation && c.scores?.recommendation !== filter.recommendation) return false
    return true
  })

  const grouped = Object.fromEntries(COLUMNS.map(col => [
    col.stage,
    filtered.filter(c => c._stage === col.stage),
  ]))

  if (loading) return <div className="page" style={{ display: 'flex', alignItems: 'center', gap: 10 }}><span className="spinner" /> Loading pipeline…</div>
  if (loadError) return <div className="page"><div className="error-banner">Failed to load board: {loadError} <button className="btn btn-secondary" style={{ marginLeft: 12, fontSize: 11 }} onClick={load}>Retry</button></div></div>

  return (
    <div className="page" style={{ overflow: 'hidden' }}>
      <div className="page-head">
        <div>
          <h2>Pipeline Board</h2>
          <p>All candidates across all jobs — drag to move between stages</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span className="mono text-muted" style={{ fontSize: 11 }}>{allCandidates.length} total candidates</span>
          <button className="btn btn-secondary" style={{ fontSize: 11, padding: '4px 10px' }} onClick={load}>↻ Refresh</button>
        </div>
      </div>

      {/* Filter bar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <input
          style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 12, fontFamily: 'var(--font-body)' }}
          placeholder="Search by name…"
          value={filter.search}
          onChange={e => setFilter(p => ({ ...p, search: e.target.value }))}
        />
        <select
          style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 12 }}
          value={filter.clientId}
          onChange={e => setFilter(p => ({ ...p, clientId: e.target.value, jobId: '' }))}
        >
          <option value="">All Clients</option>
          {clients.map(c => <option key={c.id} value={c.id}>{c.company_name ?? c.full_name}</option>)}
        </select>
        <select
          style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 12 }}
          value={filter.jobId}
          onChange={e => setFilter(p => ({ ...p, jobId: e.target.value }))}
        >
          <option value="">All Jobs</option>
          {(filter.clientId ? jobs.filter(j => j.recruiter_id === filter.clientId) : jobs)
            .map(j => <option key={j.id} value={j.id}>{j.title}</option>)}
        </select>
        <select
          style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 12 }}
          value={filter.recommendation}
          onChange={e => setFilter(p => ({ ...p, recommendation: e.target.value }))}
        >
          <option value="">All Recommendations</option>
          {['Strong Hire', 'Hire', 'Borderline', 'Reject'].map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        {(filter.search || filter.clientId || filter.jobId || filter.recommendation) && (
          <button className="btn btn-secondary" style={{ fontSize: 11, padding: '4px 10px' }} onClick={() => setFilter({ clientId: '', jobId: '', recommendation: '', search: '' })}>✕ Clear</button>
        )}
      </div>

      {/* Kanban board */}
      <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 16, minHeight: '65vh', alignItems: 'flex-start' }}>
        {COLUMNS.map(col => {
          const cards = grouped[col.stage] ?? []
          const isTarget = dropTarget === col.stage
          return (
            <div
              key={col.stage}
              style={{ minWidth: 210, maxWidth: 210, flex: '0 0 210px', display: 'flex', flexDirection: 'column' }}
              onDragOver={e => { e.preventDefault(); setDropTarget(col.stage) }}
              onDragLeave={() => setDropTarget(null)}
              onDrop={e => {
                e.preventDefault()
                setDropTarget(null)
                if (dragId.current) moveCard(dragId.current, col.stage)
                dragId.current = null
              }}
            >
              {/* Column header */}
              <div style={{ padding: '10px 12px', borderRadius: '8px 8px 0 0', background: 'var(--surface)', borderLeft: `3px solid ${col.color}`, border: '1px solid var(--border)', borderBottom: 'none', marginBottom: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{col.label}</span>
                  <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', background: 'var(--surface2)', padding: '1px 6px', borderRadius: 10, color: 'var(--text-3)' }}>{cards.length}</span>
                </div>
              </div>

              {/* Cards */}
              <div style={{
                flex: 1,
                minHeight: 100,
                maxHeight: '65vh',
                overflowY: 'auto',
                padding: '6px',
                background: isTarget ? 'rgba(184,146,74,0.06)' : 'var(--surface2)',
                border: `1px solid ${isTarget ? 'var(--accent)' : 'var(--border)'}`,
                borderRadius: '0 0 8px 8px',
                transition: 'background 0.15s, border-color 0.15s',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}>
                {cards.length === 0 && (
                  <div style={{ padding: '20px 0', textAlign: 'center', fontSize: 11, color: 'var(--text-3)' }}>Empty</div>
                )}
                {cards.map(c => {
                  const company = c.jobs?.profiles?.company_name ?? '—'
                  const jobTitle = c.jobs?.title ?? '—'
                  const days = daysSince(c.updated_at)
                  return (
                    <div
                      key={c.id}
                      draggable
                      onDragStart={() => { dragId.current = c.id }}
                      onDragEnd={() => { dragId.current = null; setDropTarget(null) }}
                      style={{
                        background: 'var(--surface)',
                        border: '1px solid var(--border)',
                        borderRadius: 8,
                        padding: '10px 12px',
                        cursor: 'grab',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 4,
                        userSelect: 'none',
                      }}
                    >
                      <div style={{ fontWeight: 600, fontSize: 13, lineHeight: 1.3 }}>{c.full_name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{c.candidate_role}</div>
                      <div style={{ fontSize: 10, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
                        {company} · {jobTitle.length > 18 ? jobTitle.slice(0, 18) + '…' : jobTitle}
                      </div>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4, alignItems: 'center' }}>
                        {c.match_score != null && (
                          <span className="badge" style={{ fontSize: 9, padding: '1px 5px', color: dimColor(c.match_score), border: `1px solid ${dimColor(c.match_score)}` }}>
                            {c.match_score}
                          </span>
                        )}
                        {c.scores?.recommendation && (
                          <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: REC_COLOR[c.scores.recommendation] ?? 'var(--text-3)' }}>
                            {c.scores.recommendation}
                          </span>
                        )}
                        <span style={{ fontSize: 9, color: 'var(--text-3)', marginLeft: 'auto', fontFamily: 'var(--font-mono)' }}>
                          {days === 0 ? 'today' : `${days}d`}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
