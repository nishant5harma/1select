import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'

export default function RecruiterClients() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [clients, setClients] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { if (user) load() }, [user])

  async function load() {
    try { // fix: wrap in try/finally so setLoading(false) always fires on query error
    // Load assigned clients with their profile data
    const { data: rcData } = await supabase
      .from('recruiter_clients')
      .select('client_id, profiles!recruiter_clients_client_id_fkey(id, company_name, email, full_name, created_at)')
      .eq('recruiter_id', user.id)

    const assignedClients = (rcData ?? []).map(r => r.profiles).filter(Boolean)
    const clientIds = assignedClients.map(c => c.id)

    if (!clientIds.length) {
      setClients([])
      return
    }

    // Load job + candidate counts per client
    const { data: jobsData } = await supabase
      .from('jobs')
      .select('id, status, recruiter_id, candidates(count)')
      .in('recruiter_id', clientIds)

    const allJobs = jobsData ?? []

    const enriched = assignedClients.map(c => {
      const clientJobs = allJobs.filter(j => j.recruiter_id === c.id)
      return {
        ...c,
        totalJobs: clientJobs.length,
        activeJobs: clientJobs.filter(j => j.status === 'active').length,
        totalCandidates: clientJobs.reduce((sum, j) => sum + (j.candidates?.[0]?.count ?? 0), 0),
      }
    })

    setClients(enriched)
    } finally {
      setLoading(false) // fix: always clear loading even when queries fail
    }
  }

  if (loading) return <div className="page"><span className="spinner" /></div>

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>My Clients</h2>
          <p>{clients.length} client{clients.length !== 1 ? 's' : ''} assigned to you</p>
        </div>
      </div>

      {clients.length === 0 ? (
        <div className="section-card">
          <div className="empty-state">
            <div style={{ fontSize: 28, marginBottom: 10, opacity: 0.3 }}>◉</div>
            <div style={{ fontWeight: 400, color: 'var(--text-2)', marginBottom: 6 }}>No clients assigned yet</div>
            <div style={{ fontSize: 12 }}>Your admin will assign clients to you.</div>
          </div>
        </div>
      ) : (
        <div className="section-card">
          <div className="section-card-head"><h3>Assigned Clients</h3></div>
          {clients.map(c => (
            <div
              key={c.id}
              className="table-row clickable"
              onClick={() => navigate(`/recruiter/pipeline?client=${c.id}`)}
            >
              <div className="profile-avatar" style={{ width: 40, height: 40, fontSize: 16, borderRadius: 'var(--r)', flexShrink: 0 }}>
                {(c.company_name ?? c.full_name ?? '?')[0].toUpperCase()}
              </div>
              <div className="col-main">
                <div className="col-name">{c.company_name || c.full_name || c.email}</div>
                <div className="col-sub">{c.email}</div>
              </div>
              <div className="col-right">
                <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-3)' }}>
                  {c.activeJobs} active / {c.totalJobs} job{c.totalJobs !== 1 ? 's' : ''}
                </span>
                <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-3)' }}>
                  {c.totalCandidates} candidate{c.totalCandidates !== 1 ? 's' : ''}
                </span>
                <span className="badge badge-blue" style={{ fontSize: 10 }}>View Pipeline →</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
