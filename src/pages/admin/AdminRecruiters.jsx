import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useFormPersistence } from '../../hooks/useFormPersistence'

export default function AdminRecruiters() {
  const [recruiters, setRecruiters] = useState([])
  const [clients, setClients] = useState([])
  const [assignments, setAssignments] = useState([]) // { recruiter_id, client_id }
  const [loading, setLoading] = useState(true)

  // Invite state
  const [showInvite, setShowInvite] = useState(false)
  const { values: inv, updateField: updateInv, clearForm: clearInv } = useFormPersistence('recruiter_invite', { invName: '', invEmail: '' })
  const [inviting, setInviting] = useState(false)
  const [invError, setInvError] = useState('')
  const [invResult, setInvResult] = useState(null)

  // Assignment modal state
  const [assignModal, setAssignModal] = useState(null) // recruiter profile
  const [assignClientId, setAssignClientId] = useState('')
  const [assigning, setAssigning] = useState(false)

  // Remove confirmation modal
  const [removeModal, setRemoveModal] = useState(null) // recruiter profile to remove
  const [removing, setRemoving] = useState(false)
  const [removeError, setRemoveError] = useState('')
  // After removal: orphaned clients waiting for reassignment
  const [orphanedClients, setOrphanedClients] = useState([]) // client profiles
  const [orphanAssignments, setOrphanAssignments] = useState({}) // client_id → recruiter_id being assigned
  const [orphanSaving, setOrphanSaving] = useState({}) // client_id → bool

  useEffect(() => { load() }, [])

  async function load() {
    try { // fix: wrap in try/finally so setLoading(false) always fires on query error
    const [{ data: recs }, { data: cls }, { data: asgn }] = await Promise.all([
      supabase.from('profiles').select('*').eq('user_role', 'recruiter').order('created_at', { ascending: false }),
      supabase.from('profiles').select('id, company_name, full_name, email').eq('user_role', 'client').order('company_name'),
      supabase.from('recruiter_clients').select('recruiter_id, client_id, profiles!recruiter_clients_client_id_fkey(id, company_name, email)'),
    ])
    setRecruiters(recs ?? [])
    setClients(cls ?? [])
    setAssignments(asgn ?? [])
    } finally {
      setLoading(false) // fix: always clear loading even when queries fail
    }
  }

  function assignedClients(recruiterId) {
    return assignments
      .filter(a => a.recruiter_id === recruiterId)
      .map(a => a.profiles)
      .filter(Boolean)
  }

  async function handleInvite() {
    if (!inv.invEmail.trim()) { setInvError('Email is required'); return }
    setInviting(true); setInvError('')
    try {
      const { data: sessionData } = await supabase.auth.getSession() // fix: guard against null session destructure
      const session = sessionData?.session
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/invite-user`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${session?.access_token ?? import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          email:        inv.invEmail.trim().toLowerCase(),
          contact_name: inv.invName.trim() || inv.invEmail.trim().toLowerCase(),
          company_name: 'One Select',
          role:         'recruiter',
        }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || result.message || 'Invite failed')
      // Force-correct the role — deployed edge function may be stale and use wrong default
      if (result.userId) {
        await supabase.from('profiles').update({
          user_role:   'recruiter',
          full_name:   inv.invName.trim() || inv.invEmail.trim().toLowerCase(),
          first_login: true,
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

  async function handleAssign() {
    if (!assignClientId || !assignModal) return
    setAssigning(true)
    const { error } = await supabase.from('recruiter_clients').insert({
      recruiter_id: assignModal.id,
      client_id: assignClientId,
    })
    setAssigning(false)
    if (!error) {
      setAssignModal(null)
      setAssignClientId('')
      await load()
    }
  }

  async function handleUnassign(recruiterId, clientId) {
    await supabase.from('recruiter_clients').delete()
      .eq('recruiter_id', recruiterId)
      .eq('client_id', clientId)
    await load()
  }

  function openRemoveModal(r) {
    setRemoveModal(r)
    setRemoving(false)
    setRemoveError('')
  }

  async function confirmRemove() {
    if (!removeModal) return
    setRemoving(true)
    setRemoveError('')
    const affected = assignedClients(removeModal.id)
    try {
      // 1. Remove recruiter_clients rows (in case FK has no CASCADE)
      await supabase.from('recruiter_clients').delete().eq('recruiter_id', removeModal.id)
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

      setRecruiters(p => p.filter(x => x.id !== removeModal.id))
      setAssignments(p => p.filter(a => a.recruiter_id !== removeModal.id))
      setRemoveModal(null)
      if (affected.length > 0) {
        setOrphanedClients(affected)
        setOrphanAssignments({})
        setOrphanSaving({})
      }
    } catch (err) {
      setRemoveError(err.message)
    } finally {
      setRemoving(false)
    }
  }

  async function assignOrphan(clientId) {
    const recruiterId = orphanAssignments[clientId]
    if (!recruiterId) return
    setOrphanSaving(p => ({ ...p, [clientId]: true }))
    await supabase.from('recruiter_clients').insert({ recruiter_id: recruiterId, client_id: clientId })
    setOrphanedClients(p => p.filter(c => c.id !== clientId))
    setOrphanSaving(p => ({ ...p, [clientId]: false }))
    await load()
  }

  if (loading) return <div className="page"><span className="spinner" /></div>

  const unassignedClients = (recruiterId) =>
    clients.filter(c => !assignments.some(a => a.recruiter_id === recruiterId && a.client_id === c.id))

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>Recruiters</h2>
          <p>{recruiters.length} internal recruiter{recruiters.length !== 1 ? 's' : ''}</p>
        </div>
        <button className="btn btn-primary" onClick={() => { updateInv('invName', ''); updateInv('invEmail', ''); setInvError(''); setShowInvite(true) }}>
          + Invite Recruiter
        </button>
      </div>

      {recruiters.length === 0 ? (
        <div className="section-card">
          <div className="empty-state">
            <div style={{ fontSize: 28, marginBottom: 10, opacity: 0.3 }}>◉</div>
            <div style={{ fontWeight: 400, color: 'var(--text-2)', marginBottom: 6 }}>No recruiters yet</div>
            <div style={{ fontSize: 12 }}>Invite your first recruiter to get started.</div>
          </div>
        </div>
      ) : (
        <div className="section-card">
          <div className="section-card-head"><h3>All Recruiters</h3></div>
          {recruiters.map(r => {
            const assigned = assignedClients(r.id)
            return (
              <div key={r.id} style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                  <div className="profile-avatar" style={{ width: 36, height: 36, fontSize: 15, borderRadius: 'var(--r)', flexShrink: 0 }}>
                    {(r.full_name || r.email || '?')[0].toUpperCase()}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 500, fontSize: 13, color: 'var(--text)' }}>{r.full_name || '—'}</div>
                    <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', marginTop: 2 }}>{r.email}</div>

                    {/* Assigned clients */}
                    <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                      {assigned.length === 0 ? (
                        <span style={{ fontSize: 11, color: 'var(--text-3)' }}>No clients assigned</span>
                      ) : (
                        assigned.map(c => (
                          <span key={c.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r)', padding: '3px 8px', color: 'var(--text-2)' }}>
                            {c.company_name || c.email}
                            <button
                              onClick={() => handleUnassign(r.id, c.id)}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', fontSize: 12, lineHeight: 1, padding: '0 0 0 2px' }}
                              title="Remove assignment"
                            >×</button>
                          </span>
                        ))
                      )}
                      <button
                        className="btn btn-secondary"
                        style={{ fontSize: 10, padding: '3px 8px' }}
                        onClick={() => { setAssignModal(r); setAssignClientId('') }}
                      >
                        + Assign Client
                      </button>
                    </div>
                  </div>
                  <button
                    className="btn btn-secondary"
                    style={{ fontSize: 10, padding: '3px 8px', color: 'var(--red)', flexShrink: 0 }}
                    onClick={() => openRemoveModal(r)}
                  >Remove</button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── Invite Modal ── */}
      {showInvite && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setShowInvite(false) }}>
          <div className="modal">
            <div className="modal-head">
              <h3>Invite Recruiter</h3>
              <button className="modal-close" onClick={() => setShowInvite(false)}>×</button>
            </div>
            <div className="modal-body">
              <div className="form-grid">
                <div className="field span-2">
                  <label>Full Name</label>
                  <input type="text" placeholder="Jane Smith" value={inv.invName} onChange={e => updateInv('invName', e.target.value)} autoFocus />
                </div>
                <div className="field span-2">
                  <label>Email Address *</label>
                  <input
                    type="email" placeholder="jane@oneselect.ai"
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
              <h3 style={{ color: 'var(--green)' }}>Recruiter Invited!</h3>
            </div>
            <div className="modal-body">
              <div style={{ padding: '10px 14px', marginBottom: 20, fontSize: 13, background: invResult.emailSent ? 'var(--green-d)' : 'var(--amber-d)', borderLeft: `2px solid ${invResult.emailSent ? 'var(--green)' : 'var(--amber)'}`, color: invResult.emailSent ? 'var(--green)' : 'var(--amber)' }}>
                {invResult.emailSent ? `✓ Welcome email sent to ${invResult.email}` : '⚠ Email failed — copy and share manually'}
              </div>
              <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r)', padding: '16px 20px', marginBottom: 20 }}>
                <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--text-3)', marginBottom: 14 }}>Login Details</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'baseline' }}>
                    <span style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', width: 72, flexShrink: 0 }}>Email</span>
                    <span style={{ fontSize: 13, color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>{invResult.email}</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.6 }}>
                    A one-time login link has been sent to their email. They will set their own password after first login.
                  </div>
                </div>
              </div>
              <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} onClick={() => setInvResult(null)}>Done</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Orphaned clients banner (shown after recruiter removal) ── */}
      {orphanedClients.length > 0 && (
        <div style={{ margin: '0 0 20px', padding: '16px 20px', background: 'var(--amber-d)', border: '1px solid var(--amber)', borderRadius: 'var(--r)' }}>
          <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--amber)', marginBottom: 12 }}>
            {orphanedClients.length} client{orphanedClients.length !== 1 ? 's' : ''} now unassigned — assign a new recruiter
          </div>
          {orphanedClients.map(c => (
            <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', minWidth: 160 }}>{c.company_name || c.email}</span>
              <select
                value={orphanAssignments[c.id] ?? ''}
                onChange={e => setOrphanAssignments(p => ({ ...p, [c.id]: e.target.value }))}
                style={{ fontSize: 12 }}
              >
                <option value="">— pick recruiter —</option>
                {recruiters.map(r => (
                  <option key={r.id} value={r.id}>{r.full_name || r.email}</option>
                ))}
              </select>
              <button
                className="btn btn-primary"
                style={{ fontSize: 11, padding: '5px 12px' }}
                disabled={!orphanAssignments[c.id] || orphanSaving[c.id]}
                onClick={() => assignOrphan(c.id)}
              >
                {orphanSaving[c.id] ? <><span className="spinner" style={{ width: 11, height: 11 }} /> Assigning…</> : 'Assign'}
              </button>
              <button
                className="btn btn-secondary"
                style={{ fontSize: 11, padding: '5px 12px' }}
                onClick={() => setOrphanedClients(p => p.filter(x => x.id !== c.id))}
              >Skip</button>
            </div>
          ))}
        </div>
      )}

      {/* ── Remove confirmation modal ── */}
      {removeModal && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget && !removing) setRemoveModal(null) }}>
          <div className="modal" style={{ maxWidth: 440 }}>
            <div className="modal-head">
              <h3>Remove Recruiter</h3>
              <button className="modal-close" disabled={removing} onClick={() => setRemoveModal(null)}>×</button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.7, marginBottom: 16 }}>
                Are you sure you want to remove <strong>{removeModal.full_name || removeModal.email}</strong>?
              </p>
              {removeError && <div className="error-banner" style={{ marginBottom: 14 }}>{removeError}</div>}
              {(() => {
                const affected = assignedClients(removeModal.id)
                return affected.length > 0 ? (
                  <div style={{ padding: '12px 14px', background: 'var(--amber-d)', border: '1px solid var(--amber)', borderRadius: 'var(--r)', marginBottom: 16 }}>
                    <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--amber)', marginBottom: 8 }}>
                      {affected.length} client{affected.length !== 1 ? 's' : ''} will become unassigned:
                    </div>
                    {affected.map(c => (
                      <div key={c.id} style={{ fontSize: 13, color: 'var(--text)', marginBottom: 2 }}>· {c.company_name || c.email}</div>
                    ))}
                    <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 8 }}>
                      Their jobs and candidates are kept. You'll be able to assign a new recruiter immediately after.
                    </div>
                  </div>
                ) : null
              })()}
              <div className="form-actions">
                <button className="btn btn-primary" style={{ background: 'var(--red)', borderColor: 'var(--red)' }} disabled={removing} onClick={confirmRemove}>
                  {removing ? <><span className="spinner" style={{ width: 12, height: 12 }} /> Removing…</> : 'Yes, Remove'}
                </button>
                <button className="btn btn-secondary" disabled={removing} onClick={() => setRemoveModal(null)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Assign Client Modal ── */}
      {assignModal && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setAssignModal(null) }}>
          <div className="modal" style={{ maxWidth: 420 }}>
            <div className="modal-head">
              <h3>Assign Client to {assignModal.full_name || assignModal.email}</h3>
              <button className="modal-close" onClick={() => setAssignModal(null)}>×</button>
            </div>
            <div className="modal-body">
              {unassignedClients(assignModal.id).length === 0 ? (
                <p style={{ fontSize: 13, color: 'var(--text-2)' }}>All clients are already assigned to this recruiter.</p>
              ) : (
                <>
                  <div className="field">
                    <label>Select Client</label>
                    <select value={assignClientId} onChange={e => setAssignClientId(e.target.value)}>
                      <option value="">— choose client —</option>
                      {unassignedClients(assignModal.id).map(c => (
                        <option key={c.id} value={c.id}>{c.company_name || c.email}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-actions" style={{ marginTop: 20 }}>
                    <button className="btn btn-primary" disabled={!assignClientId || assigning} onClick={handleAssign}>
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
    </div>
  )
}
