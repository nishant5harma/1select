import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

export default function AdminLinkedInPool({ allowedClientIds } = {}) {
  const [candidates, setCandidates] = useState([])
  const [jobs, setJobs]             = useState([])
  const [loading, setLoading]       = useState(true)
  const [search, setSearch]         = useState('')
  const [minScore, setMinScore]     = useState('')
  const [addModal, setAddModal]     = useState(null) // candidate object
  const [selectedJobId, setSelectedJobId] = useState('')
  const [adding, setAdding]         = useState(false)
  const [addError, setAddError]     = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try { // fix: wrap in try/finally so setLoading(false) always fires on query error
      let jobQ = supabase.from('jobs').select('id, title, profiles(company_name)').eq('status', 'active').order('created_at', { ascending: false })
      if (allowedClientIds?.length) jobQ = jobQ.in('recruiter_id', allowedClientIds)

      const [{ data: cands }, { data: jobList }] = await Promise.all([
        supabase
          .from('candidates')
          .select('*')
          .eq('source', 'linkedin')
          .is('job_id', null)
          .order('created_at', { ascending: false }),
        jobQ,
      ])
      setCandidates(cands ?? [])
      setJobs(jobList ?? [])
    } finally {
      setLoading(false) // fix: always clear loading even when Promise.all fails
    }
  }

  async function addToJob(candidate) {
    if (!selectedJobId) { setAddError('Select a job'); return }
    setAdding(true)
    setAddError('')
    const { error } = await supabase
      .from('candidates')
      .update({ job_id: selectedJobId })
      .eq('id', candidate.id)
    if (error) { setAddError(error.message); setAdding(false); return }
    setCandidates(prev => prev.filter(c => c.id !== candidate.id))
    setAddModal(null)
    setSelectedJobId('')
    setAdding(false)
  }

  const filtered = candidates.filter(c => {
    const score = c.linkedin_data?.match_score ?? 0
    if (minScore !== '' && score < Number(minScore)) return false
    if (search) {
      const q = search.toLowerCase()
      return (
        c.full_name?.toLowerCase().includes(q) ||
        c.candidate_role?.toLowerCase().includes(q) ||
        (c.skills ?? []).some(s => s.toLowerCase().includes(q))
      )
    }
    return true
  })

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">LinkedIn Pool</h1>
          <p className="page-subtitle">Auto-sourced profiles scored 4–6 — not yet assigned to a job</p>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        <input
          className="input"
          style={{ width: 240 }}
          placeholder="Search name, role, skill…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select
          className="input"
          style={{ width: 160 }}
          value={minScore}
          onChange={e => setMinScore(e.target.value)}
        >
          <option value="">All scores</option>
          <option value="6">Score ≥ 6</option>
          <option value="5">Score ≥ 5</option>
          <option value="4">Score ≥ 4</option>
        </select>
        <span className="mono text-muted" style={{ fontSize: 12, alignSelf: 'center' }}>
          {filtered.length} profile{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {loading ? (
        <div className="loading">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">No LinkedIn profiles in the talent pool yet. They appear here when sourced candidates score 4–6 against a job.</div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Role / Headline</th>
                <th>Skills</th>
                <th style={{ width: 80, textAlign: 'center' }}>Score</th>
                <th>Match Reason</th>
                <th style={{ width: 140 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => {
                const ld    = c.linkedin_data ?? {}
                const score = ld.match_score ?? null
                const skills = (c.skills ?? []).slice(0, 4)
                return (
                  <tr key={c.id}>
                    <td>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{c.full_name}</div>
                      {c.education && (
                        <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{c.education}</div>
                      )}
                    </td>
                    <td style={{ fontSize: 13 }}>
                      {c.candidate_role || ld.headline || '—'}
                    </td>
                    <td>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                        {skills.map(sk => (
                          <span key={sk} style={{ fontSize: 10, padding: '1px 5px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r)', color: 'var(--text-3)' }}>{sk}</span>
                        ))}
                      </div>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      {score != null ? (
                        <span style={{
                          display: 'inline-block',
                          padding: '2px 8px',
                          background: score >= 6 ? 'var(--accent)' : 'var(--surface2)',
                          color: score >= 6 ? '#fff' : 'var(--text-2)',
                          borderRadius: 'var(--r)',
                          fontSize: 12,
                          fontWeight: 600,
                        }}>{score}/10</span>
                      ) : '—'}
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--text-2)', maxWidth: 240 }}>
                      {ld.match_reason || '—'}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        {c.linkedin_url && (
                          <a
                            href={c.linkedin_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn btn-secondary"
                            style={{ fontSize: 11, padding: '3px 8px', textDecoration: 'none' }}
                          >↗ Profile</a>
                        )}
                        <button
                          className="btn btn-primary"
                          style={{ fontSize: 11, padding: '3px 8px' }}
                          onClick={() => { setAddModal(c); setSelectedJobId(''); setAddError('') }}
                        >+ Job</button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Add to Job modal */}
      {addModal && (
        <div className="modal-overlay" onClick={() => setAddModal(null)}>
          <div className="modal" style={{ width: 420 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Add to Job</h2>
              <button className="modal-close" onClick={() => setAddModal(null)}>×</button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 13, marginBottom: 16, color: 'var(--text-2)' }}>
                Move <strong>{addModal.full_name}</strong> into a job's Sourced pipeline stage.
              </p>
              <label className="label">Select Job</label>
              <select
                className="input"
                value={selectedJobId}
                onChange={e => setSelectedJobId(e.target.value)}
                style={{ marginBottom: 16 }}
              >
                <option value="">— choose a job —</option>
                {jobs.map(j => (
                  <option key={j.id} value={j.id}>
                    {j.title}{j.profiles?.company_name ? ` · ${j.profiles.company_name}` : ''}
                  </option>
                ))}
              </select>
              {addError && <div className="error-msg" style={{ marginBottom: 12 }}>{addError}</div>}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setAddModal(null)}>Cancel</button>
              <button
                className="btn btn-primary"
                disabled={adding || !selectedJobId}
                onClick={() => addToJob(addModal)}
              >{adding ? 'Adding…' : 'Add to Job'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
