import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useFormPersistence } from '../../hooks/useFormPersistence'

const PAGE_SIZE = 20

function derivePrefix(name) {
  if (!name) return ''
  const cleaned = name.replace(/\s+(Ltd\.?|Limited|Inc\.?|LLC|Corp\.?|PLC|GmbH|LLP)\.?\s*$/i, '').trim()
  const words = cleaned.split(/(?=[A-Z])|\s+/).filter(w => /^[a-zA-Z]/.test(w))
  let p
  if (words.length >= 3)      p = words[0][0] + words[1][0] + words[2][0]
  else if (words.length === 2) p = words[0][0] + (words[0][1] || 'X') + words[1][0]
  else                         p = cleaned.replace(/[^a-zA-Z]/g, '').substring(0, 3).padEnd(3, 'X')
  return p.toUpperCase()
}

function reqLabel(st) {
  if (st === 'active')   return { label: 'Active',   cls: 'badge-green' }
  if (st === 'pending')  return { label: 'Pending',  cls: 'badge-amber' }
  return                        { label: 'Inactive', cls: '' }
}

function subLabel(st) {
  if (st === 'active')    return { label: 'Active',    cls: 'badge-green' }
  if (st === 'suspended') return { label: 'Suspended', cls: 'badge-red'   }
  return                         { label: 'Trial',     cls: 'badge-amber' }
}

export default function AdminClients() {
  const navigate = useNavigate()

  // ── Data ─────────────────────────────────────────────────────────────────────
  const [profiles,      setProfiles]      = useState([])
  const [jobMap,        setJobMap]        = useState({})   // client_id → Job[]
  const [candMap,       setCandMap]       = useState({})   // job_id → count
  const [allRecruiters, setAllRecruiters] = useState([])   // all recruiter profiles
  const [rcMap,         setRcMap]         = useState({})   // client_id → recruiter profile[]
  const [loading,       setLoading]       = useState(true)

  // ── UI state ──────────────────────────────────────────────────────────────────
  const [search,       setSearch]       = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [sortBy,       setSortBy]       = useState('newest')
  const [page,         setPage]         = useState(1)

  // ── Invite client ─────────────────────────────────────────────────────────────
  const [showInvite, setShowInvite] = useState(false)
  const { values: inv, updateField: updateInv, clearForm: clearInv } = useFormPersistence('client_invite', { invEmail: '', invCompany: '', invContact: '', invPrefix: '' })
  const [inviting,   setInviting]   = useState(false)
  const [invError,   setInvError]   = useState('')
  const [invResult,  setInvResult]  = useState(null)

  // ── Assign recruiter modal ────────────────────────────────────────────────────
  const [assignModal,  setAssignModal]  = useState(null) // client profile
  const [assignRecId,  setAssignRecId]  = useState('')
  const [assigning,    setAssigning]    = useState(false)
  const [assignError,  setAssignError]  = useState('')

  // ── Remove confirmation modal ─────────────────────────────────────────────────
  const [removeModal,  setRemoveModal]  = useState(null) // client profile
  const [removing,     setRemoving]     = useState(false)
  const [removeError,  setRemoveError]  = useState('')

  // ── Subscription modal ────────────────────────────────────────────────────────
  const [plans,      setPlans]      = useState([])
  const [subModal,   setSubModal]   = useState(null)
  const [subPlanId,  setSubPlanId]  = useState('')
  const [subStatus,  setSubStatus]  = useState('trial')
  const [subSaving,  setSubSaving]  = useState(false)
  const [subError,   setSubError]   = useState('')

  useEffect(() => { load() }, [])
  useEffect(() => { setPage(1) }, [search, statusFilter, sortBy])

  async function load() {
    try { // fix: wrap in try/finally so setLoading(false) always fires even on query error
    const [
      { data: profileData },
      { data: jobData },
      { data: candData },
      { data: recData },
      { data: rcData },
      { data: planData },
    ] = await Promise.all([
      supabase.from('profiles').select('*').eq('user_role', 'client').order('created_at', { ascending: false }),
      supabase.from('jobs').select('id, recruiter_id, status, created_at'),
      supabase.from('candidates').select('job_id'),
      supabase.from('profiles').select('id, full_name, email').eq('user_role', 'recruiter').order('full_name'),
      supabase.from('recruiter_clients').select('recruiter_id, client_id, profiles!recruiter_clients_recruiter_id_fkey(id, full_name, email)'),
      supabase.from('plans').select('*').order('price_monthly', { ascending: true, nullsFirst: true }),
    ])

    const jm = {}
    ;(jobData ?? []).forEach(j => {
      if (!jm[j.recruiter_id]) jm[j.recruiter_id] = []
      jm[j.recruiter_id].push(j)
    })
    const cm = {}
    ;(candData ?? []).forEach(c => { cm[c.job_id] = (cm[c.job_id] ?? 0) + 1 })

    const rm = {}
    ;(rcData ?? []).forEach(r => {
      if (!rm[r.client_id]) rm[r.client_id] = []
      if (r.profiles) rm[r.client_id].push(r.profiles)
    })

    setProfiles(profileData ?? [])
    setJobMap(jm)
    setCandMap(cm)
    setAllRecruiters(recData ?? [])
    setRcMap(rm)
    setPlans(planData ?? [])
    } finally {
      setLoading(false) // fix: always clear loading even when Promise.all fails
    }
  }

  // ── Per-client helpers ────────────────────────────────────────────────────────
  function clientStats(p) {
    const jobs   = jobMap[p.id] ?? []
    const active = jobs.filter(j => j.status === 'active')
    const cands  = jobs.reduce((s, j) => s + (candMap[j.id] ?? 0), 0)
    return { jobs, active, cands }
  }

  function clientStatus(p) {
    const { jobs, active } = clientStats(p)
    if (active.length > 0) return 'active'
    if (jobs.length === 0)  return 'pending'
    return 'inactive'
  }

  // ── Global stats ──────────────────────────────────────────────────────────────
  const totalClients   = profiles.length
  const activeClients  = profiles.filter(p => clientStatus(p) === 'active').length
  const totalOpenRoles = Object.values(jobMap).flat().filter(j => j.status === 'active').length
  const totalCands     = Object.values(candMap).reduce((s, n) => s + n, 0)

  // ── Filter + sort ─────────────────────────────────────────────────────────────
  const filtered = profiles
    .filter(p => {
      const q        = search.toLowerCase()
      const okSearch = !q || p.company_name?.toLowerCase().includes(q) || p.email?.toLowerCase().includes(q)
      const okStatus = statusFilter === 'all' || clientStatus(p) === statusFilter
      return okSearch && okStatus
    })
    .sort((a, b) => {
      if (sortBy === 'company') return (a.company_name ?? '').localeCompare(b.company_name ?? '')
      if (sortBy === 'jobs')    return (jobMap[b.id]?.length ?? 0) - (jobMap[a.id]?.length ?? 0)
      return 0
    })

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const pageItems  = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  // ── Invite handlers ───────────────────────────────────────────────────────────
  function openInvite() {
    setInvError('')
    setShowInvite(true)
  }

  async function handleInvite() {
    if (!inv.invCompany.trim() || !inv.invEmail.trim()) { setInvError('Please fill in all fields'); return }
    setInviting(true); setInvError('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/invite-user`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${session?.access_token ?? import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          email:        inv.invEmail.trim().toLowerCase(),
          company_name: inv.invCompany.trim(),
          contact_name: inv.invContact.trim(),
          role:         'client',
        }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || result.message || 'Invite failed')
      // Force-correct the role — deployed edge function may be stale and use wrong default
      if (result.userId) {
        const prefix = (inv.invPrefix.trim() || derivePrefix(inv.invCompany)).toUpperCase().replace(/[^A-Z]/g, '').substring(0, 3)
        await supabase.from('profiles').update({
          user_role:     'client',
          company_name:  inv.invCompany.trim() || null,
          full_name:     inv.invContact.trim() || null,
          client_prefix: prefix || null,
          first_login:   true,
        }).eq('id', result.userId)
      }
      setInvResult({ email: inv.invEmail.trim().toLowerCase(), emailSent: result.emailSent })
      clearInv()
      setShowInvite(false)
      await load()
    } catch (err) {
      setInvError(err.message)
    } finally {
      setInviting(false)
    }
  }

  function copyDetails() {
    if (!invResult) return
    navigator.clipboard.writeText(
      `Portal: https://oneselect-ai-t6uo-phi.vercel.app\nEmail: ${invResult.email}\nNote: A one-time login link was sent to their email.`
    ).catch(() => {})
  }

  async function confirmRemove() {
    if (!removeModal) return
    setRemoving(true)
    setRemoveError('')
    try {
      // 1. Remove recruiter_clients assignments (in case FK has no CASCADE)
      await supabase.from('recruiter_clients').delete().eq('client_id', removeModal.id)
      // 2. Delete the profile row directly — admin RLS policy allows this
      const { error: profileErr } = await supabase.from('profiles').delete().eq('id', removeModal.id)
      if (profileErr) throw new Error(profileErr.message)
      // 3. Best-effort: delete auth account so the email can be freed.
      //    Fire-and-forget — never await this so a slow/undeployed function
      //    cannot block the UI from resolving.
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (!session) return
        fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/delete-user`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
          body: JSON.stringify({ userId: removeModal.id }),
        }).catch(() => {})
      }).catch(() => {})

      setProfiles(p => p.filter(x => x.id !== removeModal.id))
      setRemoveModal(null)
    } catch (err) {
      setRemoveError(err.message)
    } finally {
      setRemoving(false)
    }
  }

  // ── Assign recruiter handlers ─────────────────────────────────────────────────
  function openAssign(client) {
    setAssignModal(client)
    setAssignRecId('')
    setAssignError('')
  }

  async function handleAssign() {
    if (!assignRecId || !assignModal) return
    setAssigning(true); setAssignError('')
    const { error } = await supabase.from('recruiter_clients').insert({
      recruiter_id: assignRecId,
      client_id: assignModal.id,
    })
    setAssigning(false)
    if (error) { setAssignError(error.message); return }
    setAssignModal(null)
    await load()
  }

  async function handleUnassign(clientId, recruiterId) {
    await supabase.from('recruiter_clients').delete()
      .eq('recruiter_id', recruiterId)
      .eq('client_id', clientId)
    await load()
  }

  // Recruiters not yet assigned to this client
  function unassignedRecruiters(clientId) {
    const already = (rcMap[clientId] ?? []).map(r => r.id)
    return allRecruiters.filter(r => !already.includes(r.id))
  }

  // ── Subscription handlers ─────────────────────────────────────────────────────
  function openSubModal(client) {
    setSubModal(client)
    setSubPlanId(client.plan_id ?? '')
    setSubStatus(client.subscription_status ?? 'trial')
    setSubError('')
  }

  async function handleSaveSub() {
    if (!subModal) return
    setSubSaving(true); setSubError('')
    const { error } = await supabase.from('profiles').update({
      plan_id:                 subPlanId || null,
      subscription_status:     subStatus,
      subscription_started_at: subStatus === 'active' && subModal.subscription_status !== 'active'
        ? new Date().toISOString() : subModal.subscription_started_at,
    }).eq('id', subModal.id)
    setSubSaving(false)
    if (error) { setSubError(error.message); return }
    setSubModal(null)
    await load()
  }

  if (loading) return <div className="page"><span className="spinner" /></div>

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>Clients</h2>
          <p>{totalClients} client account{totalClients !== 1 ? 's' : ''}</p>
        </div>
        <button className="btn btn-primary" onClick={openInvite}>+ Invite Client</button>
      </div>

      {/* ── Stats bar ── */}
      <div className="metrics-row" style={{ marginBottom: 24 }}>
        <div className="metric-card blue">
          <span className="metric-val">{totalClients}</span>
          <span className="metric-label">Total Clients</span>
        </div>
        <div className="metric-card green">
          <span className="metric-val">{activeClients}</span>
          <span className="metric-label">Active Clients</span>
        </div>
        <div className="metric-card">
          <span className="metric-val">{totalOpenRoles}</span>
          <span className="metric-label">Open Roles</span>
        </div>
        <div className="metric-card amber">
          <span className="metric-val">{totalCands}</span>
          <span className="metric-label">Candidates Processed</span>
        </div>
      </div>

      {/* ── Search + filters ── */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          type="text"
          placeholder="Search company or email…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ flex: '1 1 220px', minWidth: 0 }}
        />
        <div style={{ display: 'flex', gap: 4 }}>
          {[['all', 'All'], ['active', 'Active'], ['pending', 'Pending']].map(([val, lbl]) => (
            <button
              key={val}
              className={`btn ${statusFilter === val ? 'btn-primary' : 'btn-secondary'}`}
              style={{ padding: '6px 12px', fontSize: 12 }}
              onClick={() => setStatusFilter(val)}
            >{lbl}</button>
          ))}
        </div>
        <select value={sortBy} onChange={e => setSortBy(e.target.value)} style={{ fontSize: 12, padding: '6px 10px' }}>
          <option value="newest">Newest first</option>
          <option value="company">Company name</option>
          <option value="jobs">Most jobs</option>
        </select>
      </div>

      {/* ── Client table ── */}
      <div className="section-card">
        <div className="section-card-head">
          <h3>All Clients</h3>
          <span className="mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>
            {filtered.length} result{filtered.length !== 1 ? 's' : ''}
            {totalPages > 1 ? ` · page ${page} of ${totalPages}` : ''}
          </span>
        </div>

        {pageItems.length === 0 ? (
          <div className="empty-state">
            {profiles.length === 0
              ? <><div style={{ fontSize: 28, marginBottom: 10, opacity: 0.3 }}>◉</div>No clients yet. Invite your first client.</>
              : 'No clients match this filter.'}
          </div>
        ) : (
          pageItems.map(c => {
            const { active, jobs, cands } = clientStats(c)
            const st   = clientStatus(c)
            const scfg = reqLabel(st)
            const sbcfg = subLabel(c.subscription_status ?? 'trial')
            const planName = plans.find(p => p.id === c.plan_id)?.name
            const lastActive = c.last_seen_at ?? c.first_login_at ?? c.created_at
            const assignedRecs = rcMap[c.id] ?? []
            return (
              <div key={c.id} style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
                {/* Top row */}
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                  <div className="profile-avatar" style={{ width: 36, height: 36, fontSize: 15, borderRadius: 'var(--r)', flexShrink: 0 }}>
                    {(c.company_name ?? c.email ?? '?')[0].toUpperCase()}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 500, fontSize: 13, color: 'var(--text)' }}>{c.company_name ?? '—'}</span>
                      {c.client_prefix && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--accent)', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r)', padding: '1px 6px', letterSpacing: '0.1em' }}>{c.client_prefix}</span>}
                      {c.full_name && <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{c.full_name}</span>}
                      <span className={`badge ${scfg.cls}`} style={{ fontSize: 10, ...(st === 'inactive' ? { color: 'var(--text-3)', background: 'var(--surface2)' } : {}) }}>{scfg.label}</span>
                    </div>
                    <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', marginTop: 2 }}>{c.email}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                      <span className={`badge ${sbcfg.cls}`} style={{ fontSize: 10 }}>{sbcfg.label}</span>
                      {planName && <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{planName}</span>}
                    </div>

                    {/* Stats row */}
                    <div style={{ display: 'flex', gap: 16, marginTop: 6, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                        <span style={{ fontFamily: 'var(--font-mono)', color: active.length > 0 ? 'var(--green)' : 'var(--text-3)', fontWeight: 600 }}>{active.length}</span> active job{active.length !== 1 ? 's' : ''}
                        {jobs.length > active.length ? ` / ${jobs.length} total` : ''}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                        <span style={{ fontFamily: 'var(--font-mono)', color: cands > 0 ? 'var(--text)' : 'var(--text-3)', fontWeight: 600 }}>{cands}</span> candidate{cands !== 1 ? 's' : ''}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                        last active {new Date(lastActive).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })}
                      </span>
                    </div>

                    {/* Recruiter assignment row */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-3)', marginRight: 2 }}>Recruiter:</span>
                      {assignedRecs.length === 0 ? (
                        <span style={{ fontSize: 11, color: 'var(--text-3)', fontStyle: 'italic' }}>None assigned</span>
                      ) : (
                        assignedRecs.map(r => (
                          <span key={r.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, background: 'var(--accent-d)', border: '1px solid var(--border)', borderRadius: 'var(--r)', padding: '2px 8px', color: 'var(--accent)' }}>
                            {r.full_name || r.email}
                            <button
                              onClick={() => handleUnassign(c.id, r.id)}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', fontSize: 13, lineHeight: 1, padding: '0 0 0 2px' }}
                              title="Remove assignment"
                            >×</button>
                          </span>
                        ))
                      )}
                      <button
                        className="btn btn-secondary"
                        style={{ fontSize: 10, padding: '2px 8px' }}
                        onClick={() => openAssign(c)}
                      >+ Assign Recruiter</button>
                    </div>
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: 5, flexShrink: 0, flexWrap: 'wrap' }}>
                    <button
                      className="btn btn-secondary"
                      style={{ fontSize: 10, padding: '3px 8px' }}
                      onClick={() => navigate('/admin/jobs', { state: { clientId: c.id, clientName: c.company_name || c.email } })}
                    >Jobs</button>
                    <button
                      className="btn btn-secondary"
                      style={{ fontSize: 10, padding: '3px 8px', color: 'var(--accent)' }}
                      onClick={() => navigate(`/admin/pipeline?client=${c.id}`)}
                    >Pipeline</button>
                    <button
                      className="btn btn-secondary"
                      style={{ fontSize: 10, padding: '3px 8px', color: 'var(--accent)' }}
                      onClick={() => openSubModal(c)}
                    >Subscription</button>
                    <button
                      className="btn btn-secondary"
                      style={{ fontSize: 10, padding: '3px 8px', color: 'var(--red)' }}
                      onClick={() => { setRemoveModal(c); setRemoveError('') }}
                    >Remove</button>
                  </div>
                </div>
              </div>
            )
          })
        )}

        {/* ── Pagination ── */}
        {totalPages > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '16px 0', borderTop: '1px solid var(--border)', marginTop: 8 }}>
            <button className="btn btn-secondary" style={{ fontSize: 12, padding: '5px 14px' }} disabled={page <= 1} onClick={() => setPage(p => p - 1)}>← Previous</button>
            <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-3)' }}>Page {page} of {totalPages}</span>
            <button className="btn btn-secondary" style={{ fontSize: 12, padding: '5px 14px' }} disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next →</button>
          </div>
        )}
      </div>

      {/* ── Remove Client Confirmation Modal ── */}
      {removeModal && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget && !removing) setRemoveModal(null) }}>
          <div className="modal" style={{ maxWidth: 420 }}>
            <div className="modal-head">
              <h3>Remove Client</h3>
              <button className="modal-close" disabled={removing} onClick={() => setRemoveModal(null)}>×</button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.7, marginBottom: 16 }}>
                Are you sure you want to remove <strong>{removeModal.company_name || removeModal.email}</strong>?
              </p>
              {removeError && <div className="error-banner" style={{ marginBottom: 14 }}>{removeError}</div>}
              <div style={{ padding: '12px 14px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r)', marginBottom: 20, fontSize: 12, color: 'var(--text-3)', lineHeight: 1.7 }}>
                · Their jobs and candidates are <strong style={{ color: 'var(--text-2)' }}>kept</strong> in the database<br />
                · Their recruiter assignments will be removed<br />
                · You can re-invite them later with the same email
              </div>
              <div className="form-actions">
                <button
                  className="btn btn-primary"
                  style={{ background: 'var(--red)', borderColor: 'var(--red)' }}
                  disabled={removing}
                  onClick={confirmRemove}
                >
                  {removing ? <><span className="spinner" style={{ width: 12, height: 12 }} /> Removing…</> : 'Yes, Remove'}
                </button>
                <button className="btn btn-secondary" disabled={removing} onClick={() => setRemoveModal(null)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Assign Recruiter Modal ── */}
      {assignModal && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setAssignModal(null) }}>
          <div className="modal" style={{ maxWidth: 420 }}>
            <div className="modal-head">
              <h3>Assign Recruiter to {assignModal.company_name || assignModal.email}</h3>
              <button className="modal-close" onClick={() => setAssignModal(null)}>×</button>
            </div>
            <div className="modal-body">
              {unassignedRecruiters(assignModal.id).length === 0 ? (
                <p style={{ fontSize: 13, color: 'var(--text-2)' }}>
                  {allRecruiters.length === 0
                    ? 'No recruiters exist yet. Invite one from the Recruiters page first.'
                    : 'All recruiters are already assigned to this client.'}
                </p>
              ) : (
                <>
                  <div className="field">
                    <label>Select Recruiter</label>
                    <select value={assignRecId} onChange={e => setAssignRecId(e.target.value)}>
                      <option value="">— choose recruiter —</option>
                      {unassignedRecruiters(assignModal.id).map(r => (
                        <option key={r.id} value={r.id}>{r.full_name || r.email}</option>
                      ))}
                    </select>
                  </div>
                  {assignError && <div className="error-banner" style={{ marginTop: 12 }}>{assignError}</div>}
                  <div className="form-actions" style={{ marginTop: 20 }}>
                    <button className="btn btn-primary" disabled={!assignRecId || assigning} onClick={handleAssign}>
                      {assigning ? <><span className="spinner" style={{ width: 12, height: 12 }} /> Assigning…</> : 'Assign'}
                    </button>
                    <button className="btn btn-secondary" onClick={() => setAssignModal(null)}>Cancel</button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Invite Client Modal ── */}
      {showInvite && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setShowInvite(false) }}>
          <div className="modal">
            <div className="modal-head">
              <h3>Invite New Client</h3>
              <button className="modal-close" onClick={() => setShowInvite(false)}>×</button>
            </div>
            <div className="modal-body">
              <div className="form-grid">
                <div className="field">
                  <label>Company Name *</label>
                  <input type="text" placeholder="Acme Corp" value={inv.invCompany} autoFocus
                    onChange={e => { updateInv('invCompany', e.target.value); updateInv('invPrefix', derivePrefix(e.target.value)) }} />
                </div>
                <div className="field">
                  <label>
                    Client Code
                    <span style={{ fontWeight: 300, color: 'var(--text-3)', marginLeft: 6 }}>3 letters — used for job IDs</span>
                  </label>
                  <input
                    type="text"
                    value={inv.invPrefix}
                    maxLength={3}
                    placeholder="e.g. TEV"
                    onChange={e => updateInv('invPrefix', e.target.value.toUpperCase().replace(/[^A-Z]/g, '').substring(0, 3))}
                    style={{ fontFamily: 'var(--font-mono)', letterSpacing: '0.15em', textTransform: 'uppercase', width: 100 }}
                  />
                </div>
                <div className="field">
                  <label>Contact Name</label>
                  <input type="text" placeholder="Jane Smith" value={inv.invContact} onChange={e => updateInv('invContact', e.target.value)} />
                </div>
                <div className="field">
                  <label>Email Address *</label>
                  <input
                    type="email" placeholder="jane@acmecorp.com"
                    value={inv.invEmail} onChange={e => updateInv('invEmail', e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleInvite() } }}
                  />
                </div>
              </div>
              {invError && <div className="error-banner" style={{ marginTop: 14 }}>{invError}</div>}
              <div className="form-actions" style={{ marginTop: 20 }}>
                <button className="btn btn-primary" disabled={inviting} onClick={handleInvite}>
                  {inviting ? <><span className="spinner" style={{ width: 12, height: 12 }} /> Sending…</> : 'Send Invitation'}
                </button>
                <button className="btn btn-secondary" onClick={() => setShowInvite(false)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Invite Result Modal ── */}
      {invResult && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: 480 }}>
            <div className="modal-head">
              <h3 style={{ color: 'var(--green)' }}>Client Invited Successfully!</h3>
            </div>
            <div className="modal-body">
              <div style={{ padding: '10px 14px', marginBottom: 20, fontSize: 13, background: invResult.emailSent ? 'var(--green-d)' : 'var(--amber-d)', borderLeft: `2px solid ${invResult.emailSent ? 'var(--green)' : 'var(--amber)'}`, color: invResult.emailSent ? 'var(--green)' : 'var(--amber)' }}>
                {invResult.emailSent ? `✓ Welcome email sent to ${invResult.email}` : '⚠ Email failed — copy and share manually'}
              </div>
              <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r)', padding: '16px 20px', marginBottom: 20 }}>
                <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--text-3)', marginBottom: 14 }}>Login Details</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'baseline' }}>
                    <span style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', width: 72, flexShrink: 0 }}>Portal</span>
                    <span style={{ fontSize: 12, color: 'var(--text-2)', fontFamily: 'var(--font-mono)' }}>oneselect-ai-t6uo-phi.vercel.app</span>
                  </div>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'baseline' }}>
                    <span style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', width: 72, flexShrink: 0 }}>Email</span>
                    <span style={{ fontSize: 13, color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>{invResult.email}</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.6 }}>
                    A one-time login link has been sent to their email. They will set their own password after first login.
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button className="btn btn-secondary" style={{ flex: 1, justifyContent: 'center' }} onClick={copyDetails}>Copy Login Details</button>
                <button className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setInvResult(null)}>Done</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Subscription Modal ── */}
      {subModal && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget && !subSaving) setSubModal(null) }}>
          <div className="modal" style={{ maxWidth: 440 }}>
            <div className="modal-head">
              <h3>Subscription — {subModal.company_name || subModal.email}</h3>
              <button className="modal-close" disabled={subSaving} onClick={() => setSubModal(null)}>×</button>
            </div>
            <div className="modal-body">
              <div className="form-grid">
                <div className="field span-2">
                  <label>Plan</label>
                  <select value={subPlanId} onChange={e => setSubPlanId(e.target.value)}>
                    <option value="">— No plan assigned —</option>
                    {plans.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.name}{p.price_monthly != null ? ` — ₹${Number(p.price_monthly).toFixed(0)}/mo` : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field span-2">
                  <label>Subscription Status</label>
                  <select value={subStatus} onChange={e => setSubStatus(e.target.value)}>
                    <option value="trial">Trial</option>
                    <option value="active">Active</option>
                    <option value="suspended">Suspended</option>
                  </select>
                </div>
              </div>
              {subStatus === 'suspended' && (
                <div style={{ marginTop: 12, padding: '10px 14px', background: 'var(--red-d, rgba(239,68,68,0.08))', border: '1px solid var(--red)', borderRadius: 'var(--r)', fontSize: 12, color: 'var(--red)', lineHeight: 1.6 }}>
                  Suspended clients will see a blocked screen when they log in.
                </div>
              )}
              {subError && <div className="error-banner" style={{ marginTop: 14 }}>{subError}</div>}
              <div className="form-actions" style={{ marginTop: 20 }}>
                <button className="btn btn-primary" disabled={subSaving} onClick={handleSaveSub}>
                  {subSaving ? <><span className="spinner" style={{ width: 12, height: 12 }} /> Saving…</> : 'Save'}
                </button>
                <button className="btn btn-secondary" disabled={subSaving} onClick={() => setSubModal(null)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
