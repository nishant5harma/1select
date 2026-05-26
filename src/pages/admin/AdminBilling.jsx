import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

const EMPTY_PLAN = { name: '', description: '', price_monthly: '' }
const STATUS_OPTIONS = ['trial', 'active', 'suspended', 'expired']

const DEFAULT_PLANS = [
  {
    name: 'Basic',
    price_monthly: 4999,
    description: 'Up to 3 active jobs · 50 CV uploads/mo · AI screening included',
    features: ['3 active job postings', '50 CV uploads / month', 'AI CV screening', 'LinkedIn sourcing (25 profiles/job)', 'Email support'],
    color: 'var(--text-3)',
  },
  {
    name: 'Pro',
    price_monthly: 14999,
    description: 'Up to 10 active jobs · Unlimited CVs · AI interview + offer letters',
    features: ['10 active job postings', 'Unlimited CV uploads', 'AI CV screening + video interviews', 'LinkedIn sourcing (50 profiles/job)', 'Talent pool access', 'Offer letter generation', 'Priority support'],
    color: 'var(--accent)',
    highlight: true,
  },
  {
    name: 'Enterprise',
    price_monthly: null,
    description: 'Custom pricing · Unlimited everything · Dedicated support',
    features: ['Unlimited job postings', 'Unlimited CVs + interviews', 'White-label options', 'Custom integrations', 'Dedicated account manager', 'SLA guarantee'],
    color: 'var(--green)',
  },
]

const monthStart = () => {
  const d = new Date()
  d.setDate(1); d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

const MO = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000 }
const MB = { background: 'var(--surface)', borderRadius: 8, padding: 28, width: 460, display: 'flex', flexDirection: 'column', gap: 16 }
const MI = { width: '100%', padding: '9px 12px', borderRadius: 'var(--r)', border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13, boxSizing: 'border-box' }
const TH = { padding: '10px 12px', textAlign: 'left', fontSize: 10, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-3)', fontWeight: 400 }
const TD = { padding: '10px 12px', fontSize: 13 }

const INV_CLS = { pending: 'badge-amber', paid: 'badge-green', overdue: 'badge-red' }
const STATUS_CLS = { trial: 'badge-amber', active: 'badge-green', suspended: 'badge-red', expired: 'badge-red' }

export default function AdminBilling() {
  // ── Plans ──────────────────────────────────────────────────────
  const [plans,       setPlans]       = useState([])
  const [plansLoading, setPlansLoading] = useState(true)
  const [planModal,   setPlanModal]   = useState(null) // null | 'new' | plan obj
  const [planForm,    setPlanForm]    = useState(EMPTY_PLAN)
  const [planSaving,  setPlanSaving]  = useState(false)
  const [planError,   setPlanError]   = useState('')
  const [deleteModal, setDeleteModal] = useState(null)
  const [deleting,    setDeleting]    = useState(false)
  const [seeding,     setSeeding]     = useState(false)

  // ── Clients ────────────────────────────────────────────────────
  const [clients,      setClients]      = useState([])
  const [usage,        setUsage]        = useState({})
  const [loading,      setLoading]      = useState(true)
  const [dirtyRows,    setDirtyRows]    = useState({}) // clientId → {plan_id, price_override, subscription_status}
  const [rowSaving,    setRowSaving]    = useState(new Set())
  const [rowSaved,     setRowSaved]     = useState(new Set())
  const [rowError,     setRowError]     = useState({})
  const [invoiceStatus, setInvoiceStatus] = useState({})
  const [notesModal,   setNotesModal]   = useState(null)
  const [notesText,    setNotesText]    = useState('')
  const [notesSaving,  setNotesSaving]  = useState(false)

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    setLoading(true)
    setPlansLoading(true)
    try { // fix: wrap in try/finally so loading flags always clear even on query error
      const ms = monthStart()
      const [
        { data: plansData },
        { data: clientData },
        { data: jobData },
        { data: candData },
      ] = await Promise.all([
        supabase.from('plans').select('*').order('price_monthly', { ascending: true, nullsFirst: true }),
        supabase.from('profiles').select('*, plans(*)').eq('user_role', 'client').order('company_name'),
        supabase.from('jobs').select('id, recruiter_id, created_at'), // fix: removed .limit(2000) — count all jobs for accurate billing
        supabase.from('candidates').select('job_id, created_at, scores'), // fix: removed .limit(2000) — count all candidates
      ])

      const allClients = clientData ?? []
      const allJobs    = jobData   ?? []
      const allCands   = candData  ?? []

      const usageMap = {}
      for (const c of allClients) {
        const clientJobs   = allJobs.filter(j => j.recruiter_id === c.id)
        const clientJobIds = clientJobs.map(j => j.id)
        const rolesThisMonth  = clientJobs.filter(j => j.created_at >= ms).length
        const cands           = allCands.filter(x => clientJobIds.includes(x.job_id))
        const candsThisMonth  = cands.filter(x => x.created_at >= ms).length
        const interviews      = cands.filter(x => x.scores?.overallScore != null && x.created_at >= ms).length
        usageMap[c.id] = { roles: rolesThisMonth, candidates: candsThisMonth, interviews }
      }

      setPlans(plansData ?? [])
      setClients(allClients)
      setUsage(usageMap)
    } finally {
      setLoading(false) // fix: always clear loading flags even when Promise.all fails
      setPlansLoading(false)
    }
  }

  // ── Plans CRUD ─────────────────────────────────────────────────

  async function seedDefaultPlans() {
    setSeeding(true)
    const existing = new Set(plans.map(p => p.name.toLowerCase()))
    const toCreate = DEFAULT_PLANS.filter(p => !existing.has(p.name.toLowerCase()))
    if (toCreate.length) {
      await supabase.from('plans').insert(toCreate.map(p => ({
        name:          p.name,
        description:   p.description,
        price_monthly: p.price_monthly,
      })))
    }
    await loadAll()
    setSeeding(false)
  }

  const planClientCount = planId => clients.filter(c => c.plan_id === planId).length

  function openNewPlan() {
    setPlanForm(EMPTY_PLAN)
    setPlanError('')
    setPlanModal('new')
  }

  function openEditPlan(plan) {
    setPlanForm({ name: plan.name, description: plan.description ?? '', price_monthly: plan.price_monthly ?? '' })
    setPlanError('')
    setPlanModal(plan)
  }

  async function handleSavePlan() {
    if (!planForm.name.trim()) { setPlanError('Plan name is required'); return }
    setPlanSaving(true); setPlanError('')
    const payload = {
      name:          planForm.name.trim(),
      description:   planForm.description.trim() || null,
      price_monthly: planForm.price_monthly !== '' ? Number(planForm.price_monthly) : null,
    }
    const { error } = planModal === 'new'
      ? await supabase.from('plans').insert(payload)
      : await supabase.from('plans').update(payload).eq('id', planModal.id)
    setPlanSaving(false)
    if (error) { setPlanError(error.message); return }
    setPlanModal(null)
    await loadAll()
  }

  async function handleDeletePlan() {
    if (!deleteModal) return
    setDeleting(true)
    await supabase.from('plans').delete().eq('id', deleteModal.id)
    setDeleting(false)
    setDeleteModal(null)
    await loadAll()
  }

  // ── Client row editing ─────────────────────────────────────────

  function getRow(client) {
    return dirtyRows[client.id] ?? {
      plan_id:             client.plan_id             ?? null,
      price_override:      client.price_override      ?? '',
      subscription_status: client.subscription_status ?? 'trial',
    }
  }

  function setRowField(clientId, field, value) {
    setDirtyRows(prev => {
      const client = clients.find(c => c.id === clientId)
      const base = prev[clientId] ?? {
        plan_id:             client.plan_id             ?? null,
        price_override:      client.price_override      ?? '',
        subscription_status: client.subscription_status ?? 'trial',
      }
      return { ...prev, [clientId]: { ...base, [field]: value } }
    })
  }

  function isRowDirty(client) {
    const row = dirtyRows[client.id]
    if (!row) return false
    return (
      row.plan_id             !== (client.plan_id             ?? null)    ||
      String(row.price_override      ?? '') !== String(client.price_override      ?? '') ||
      row.subscription_status !== (client.subscription_status ?? 'trial')
    )
  }

  async function saveRow(client) {
    const row = dirtyRows[client.id]
    if (!row) return
    setRowSaving(prev => new Set([...prev, client.id]))
    const payload = {
      plan_id:             row.plan_id    || null,
      price_override:      row.price_override !== '' ? Number(row.price_override) : null,
      subscription_status: row.subscription_status,
    }
    const { error } = await supabase.from('profiles').update(payload).eq('id', client.id)
    setRowSaving(prev => { const n = new Set(prev); n.delete(client.id); return n })
    if (error) {
      setRowError(prev => ({ ...prev, [client.id]: error.message }))
    } else {
      setClients(prev => prev.map(c => c.id === client.id
        ? { ...c, ...payload, plans: plans.find(p => p.id === payload.plan_id) ?? null }
        : c
      ))
      setDirtyRows(prev => { const n = { ...prev }; delete n[client.id]; return n })
      setRowError(prev => { const n = { ...prev }; delete n[client.id]; return n })
      setRowSaved(prev => new Set([...prev, client.id]))
      setTimeout(() => setRowSaved(prev => { const n = new Set(prev); n.delete(client.id); return n }), 2000)
    }
  }

  async function saveNotes() {
    if (!notesModal) return
    setNotesSaving(true)
    await supabase.from('profiles').update({ billing_notes: notesText }).eq('id', notesModal.id)
    setClients(prev => prev.map(c => c.id === notesModal.id ? { ...c, billing_notes: notesText } : c))
    setNotesModal(null)
    setNotesSaving(false)
  }

  function toggleInvoice(clientId) {
    const cur  = invoiceStatus[clientId] ?? 'pending'
    const next = cur === 'pending' ? 'paid' : cur === 'paid' ? 'overdue' : 'pending'
    setInvoiceStatus(p => ({ ...p, [clientId]: next }))
  }

  if (loading) return (
    <div className="page" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span className="spinner" /> Loading…
    </div>
  )

  // MRR: active clients using price_override ?? plan price
  const activeClients = clients.filter(c => (dirtyRows[c.id]?.subscription_status ?? c.subscription_status) === 'active')
  const trialClients  = clients.filter(c => (dirtyRows[c.id]?.subscription_status ?? c.subscription_status) === 'trial')
  const totalMRR = activeClients.reduce((sum, c) => {
    const price = c.price_override ?? c.plans?.price_monthly ?? 0
    return sum + Number(price)
  }, 0)

  return (
    <div className="page">
      <div className="page-head">
        <div><h2>Billing</h2><p>Revenue tracking, plan management and client subscriptions</p></div>
      </div>

      {/* ── MRR Summary ── */}
      <div className="metrics-row">
        <div className="metric-card green">
          <span className="metric-val">₹{totalMRR.toLocaleString()}</span>
          <span className="metric-label">MRR (Active clients)</span>
        </div>
        <div className="metric-card blue">
          <span className="metric-val">{activeClients.length}</span>
          <span className="metric-label">Active Clients</span>
        </div>
        <div className="metric-card amber">
          <span className="metric-val">{trialClients.length}</span>
          <span className="metric-label">Trial Clients</span>
        </div>
        <div className="metric-card">
          <span className="metric-val">{clients.length}</span>
          <span className="metric-label">Total Clients</span>
        </div>
      </div>

      {/* ── Plans Management ── */}
      <div className="section-card" style={{ marginBottom: 20 }}>
        <div className="section-card-head">
          <h3>Plans</h3>
          <div style={{ display: 'flex', gap: 8 }}>
            {plans.length < DEFAULT_PLANS.length && (
              <button className="btn btn-secondary" style={{ fontSize: 11, padding: '5px 12px' }} disabled={seeding} onClick={seedDefaultPlans}>
                {seeding ? <><span className="spinner" style={{ width: 11, height: 11 }} /> Seeding…</> : '✦ Seed Default Plans'}
              </button>
            )}
            <button className="btn btn-primary" style={{ fontSize: 11, padding: '5px 12px' }} onClick={openNewPlan}>
              + Create Plan
            </button>
          </div>
        </div>

        {/* Plan reference cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, padding: '16px 16px 0' }}>
          {DEFAULT_PLANS.map(p => {
            const exists = plans.some(db => db.name.toLowerCase() === p.name.toLowerCase())
            return (
              <div key={p.name} style={{ border: `1px solid ${p.highlight ? 'var(--accent)' : 'var(--border)'}`, borderTop: `3px solid ${p.color}`, borderRadius: 'var(--r)', padding: 16, background: p.highlight ? 'rgba(184,146,74,0.04)' : 'var(--bg)', position: 'relative' }}>
                {p.highlight && <div style={{ position: 'absolute', top: -1, right: 12, fontSize: 9, fontFamily: 'var(--font-mono)', background: 'var(--accent)', color: '#fff', padding: '2px 8px', borderRadius: '0 0 4px 4px', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Popular</div>}
                <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{p.name}</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 18, fontWeight: 700, color: p.color, marginBottom: 8 }}>
                  {p.price_monthly != null ? <>₹{p.price_monthly.toLocaleString()}<span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-3)' }}>/mo</span></> : 'Custom'}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
                  {p.features.map(f => (
                    <div key={f} style={{ fontSize: 11, color: 'var(--text-2)', display: 'flex', gap: 6 }}>
                      <span style={{ color: p.color, flexShrink: 0 }}>✓</span>{f}
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: exists ? 'var(--green)' : 'var(--text-3)', padding: '3px 8px', background: exists ? 'rgba(16,185,129,0.08)' : 'var(--surface2)', borderRadius: 'var(--r)', display: 'inline-block' }}>
                  {exists ? '✓ In database' : '— Not created'}
                </div>
              </div>
            )
          })}
        </div>

        {plansLoading ? (
          <div style={{ padding: 24, display: 'flex', justifyContent: 'center' }}><span className="spinner" /></div>
        ) : plans.length === 0 ? (
          <div className="empty-state" style={{ marginTop: 16 }}>No plans yet — seed defaults or create one above.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['Plan', 'Price / mo', 'Description', 'Clients', ''].map(h => (
                    <th key={h} style={TH}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {plans.map(p => {
                  const count = planClientCount(p.id)
                  return (
                    <tr key={p.id} style={{ borderBottom: '1px solid var(--border2)' }}>
                      <td style={{ ...TD, fontWeight: 500 }}>{p.name}</td>
                      <td style={{ ...TD, fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>
                        {p.price_monthly != null ? `₹${Number(p.price_monthly).toLocaleString()}` : '—'}
                      </td>
                      <td style={{ ...TD, color: 'var(--text-3)', maxWidth: 280 }}>{p.description ?? '—'}</td>
                      <td style={{ ...TD, fontFamily: 'var(--font-mono)', textAlign: 'center' }}>{count}</td>
                      <td style={TD}>
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                          <button
                            className="btn btn-secondary"
                            style={{ fontSize: 10, padding: '3px 8px' }}
                            onClick={() => openEditPlan(p)}
                          >Edit</button>
                          <button
                            className="btn btn-secondary"
                            style={{ fontSize: 10, padding: '3px 8px', color: count > 0 ? 'var(--text-3)' : 'var(--red)', cursor: count > 0 ? 'not-allowed' : 'pointer' }}
                            disabled={count > 0}
                            title={count > 0 ? `${count} client(s) on this plan — reassign them first` : 'Delete plan'}
                            onClick={() => setDeleteModal(p)}
                          >Delete</button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Client Subscriptions ── */}
      <div className="section-card">
        <div className="section-card-head"><h3>Client Subscriptions</h3></div>
        {clients.length === 0 ? (
          <div className="empty-state">No clients yet.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['Client', 'Plan', 'Price Override', 'Status', 'Invoice', 'Actions'].map(h => (
                    <th key={h} style={TH}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {clients.map(c => {
                  const row      = getRow(c)
                  const dirty    = isRowDirty(c)
                  const saving   = rowSaving.has(c.id)
                  const saved    = rowSaved.has(c.id)
                  const rowErr   = rowError[c.id]
                  const inv      = invoiceStatus[c.id] ?? 'pending'
                  const planPrice = plans.find(p => p.id === row.plan_id)?.price_monthly ?? null
                  const hasOverride = row.price_override !== '' && row.price_override != null &&
                    (planPrice == null || Number(row.price_override) !== Number(planPrice))

                  return (
                    <tr key={c.id} style={{ borderBottom: '1px solid var(--border2)' }}>
                      {/* Client */}
                      <td style={TD}>
                        <div style={{ fontWeight: 500 }}>{c.company_name ?? c.full_name ?? c.email}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{c.email}</div>
                      </td>

                      {/* Plan dropdown */}
                      <td style={TD}>
                        <select
                          value={row.plan_id ?? ''}
                          onChange={e => setRowField(c.id, 'plan_id', e.target.value || null)}
                          style={{ ...MI, width: 140, padding: '5px 8px' }}
                        >
                          <option value="">— No plan —</option>
                          {plans.map(p => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </select>
                      </td>

                      {/* Price Override */}
                      <td style={TD}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <span style={{ color: 'var(--text-3)', fontSize: 12, flexShrink: 0 }}>₹</span>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            placeholder={planPrice != null ? String(Number(planPrice).toLocaleString()) : '—'}
                            value={row.price_override}
                            onChange={e => setRowField(c.id, 'price_override', e.target.value)}
                            style={{
                              ...MI,
                              width: 84,
                              padding: '5px 8px',
                              color: hasOverride ? 'var(--accent)' : 'var(--text)',
                            }}
                          />
                          {hasOverride && (
                            <span style={{
                              fontSize: 9,
                              padding: '2px 5px',
                              background: 'rgba(184,146,74,0.12)',
                              color: 'var(--accent)',
                              borderRadius: 'var(--r)',
                              fontFamily: 'var(--font-mono)',
                              letterSpacing: '0.04em',
                              whiteSpace: 'nowrap',
                              flexShrink: 0,
                            }}>custom</span>
                          )}
                        </div>
                      </td>

                      {/* Status */}
                      <td style={TD}>
                        <select
                          value={row.subscription_status}
                          onChange={e => setRowField(c.id, 'subscription_status', e.target.value)}
                          style={{ ...MI, width: 110, padding: '5px 8px' }}
                        >
                          {STATUS_OPTIONS.map(s => (
                            <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                          ))}
                        </select>
                      </td>

                      {/* Invoice */}
                      <td style={TD}>
                        <button
                          className={`badge ${INV_CLS[inv]}`}
                          style={{ cursor: 'pointer', fontSize: 10, border: 'none', fontFamily: 'var(--font-body)' }}
                          onClick={() => toggleInvoice(c.id)}
                          title="Click to cycle: Pending → Paid → Overdue"
                        >
                          {inv.charAt(0).toUpperCase() + inv.slice(1)}
                        </button>
                      </td>

                      {/* Actions */}
                      <td style={TD}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
                          <div style={{ display: 'flex', gap: 6 }}>
                            {(dirty || saved) && (
                              <button
                                className="btn btn-primary"
                                style={{ fontSize: 10, padding: '3px 10px', background: saved ? 'var(--green)' : undefined, borderColor: saved ? 'var(--green)' : undefined }}
                                disabled={saving || saved}
                                onClick={() => saveRow(c)}
                              >
                                {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save'}
                              </button>
                            )}
                            <button
                              className="btn btn-secondary"
                              style={{ fontSize: 10, padding: '3px 8px' }}
                              onClick={() => { setNotesModal(c); setNotesText(c.billing_notes ?? '') }}
                            >Notes</button>
                          </div>
                          {rowErr && <div style={{ fontSize: 10, color: 'var(--red)', maxWidth: 160 }}>⚠ {rowErr}</div>}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Plan Create / Edit Modal ── */}
      {planModal && (
        <div style={MO} onClick={e => { if (e.target === e.currentTarget && !planSaving) setPlanModal(null) }}>
          <div style={MB}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: 15, fontWeight: 600 }}>
                {planModal === 'new' ? 'Create Plan' : `Edit — ${planModal.name}`}
              </div>
              <button
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: 'var(--text-3)', lineHeight: 1, padding: 0 }}
                disabled={planSaving}
                onClick={() => setPlanModal(null)}
              >×</button>
            </div>

            <div className="field">
              <label style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Plan Name *
              </label>
              <input
                type="text"
                style={MI}
                placeholder="e.g. Starter"
                value={planForm.name}
                onChange={e => setPlanForm(f => ({ ...f, name: e.target.value }))}
                autoFocus
              />
            </div>

            <div className="field">
              <label style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Monthly Price (₹)
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                style={MI}
                placeholder="e.g. 1500"
                value={planForm.price_monthly}
                onChange={e => setPlanForm(f => ({ ...f, price_monthly: e.target.value }))}
              />
            </div>

            <div className="field">
              <label style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Description
              </label>
              <textarea
                style={{ ...MI, height: 80, resize: 'vertical', fontFamily: 'var(--font-body)', lineHeight: 1.6 }}
                placeholder="Brief description shown to clients…"
                value={planForm.description}
                onChange={e => setPlanForm(f => ({ ...f, description: e.target.value }))}
              />
            </div>

            {planError && (
              <div style={{ fontSize: 12, color: 'var(--red)', padding: '8px 12px', background: 'rgba(220,60,60,0.08)', borderRadius: 'var(--r)' }}>
                {planError}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" disabled={planSaving} onClick={() => setPlanModal(null)}>Cancel</button>
              <button className="btn btn-primary" disabled={planSaving} onClick={handleSavePlan}>
                {planSaving
                  ? <><span className="spinner" style={{ width: 12, height: 12 }} /> Saving…</>
                  : planModal === 'new' ? 'Create Plan' : 'Save Changes'
                }
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Plan Confirmation ── */}
      {deleteModal && (
        <div style={MO} onClick={e => { if (e.target === e.currentTarget && !deleting) setDeleteModal(null) }}>
          <div style={{ ...MB, width: 380 }}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>Delete Plan</div>
            <p style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.7, margin: 0 }}>
              Delete <strong>{deleteModal.name}</strong>? This cannot be undone. Clients currently on this plan will have their plan unset.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" disabled={deleting} onClick={() => setDeleteModal(null)}>Cancel</button>
              <button
                className="btn btn-primary"
                style={{ background: 'var(--red)', borderColor: 'var(--red)' }}
                disabled={deleting}
                onClick={handleDeletePlan}
              >
                {deleting ? <><span className="spinner" style={{ width: 12, height: 12 }} /> Deleting…</> : 'Delete Plan'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Notes Modal ── */}
      {notesModal && (
        <div style={MO}>
          <div style={MB}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Billing Notes</div>
              <div style={{ fontSize: 13, color: 'var(--text-3)' }}>{notesModal.company_name ?? notesModal.email}</div>
            </div>
            <textarea
              style={{ ...MI, height: 120, resize: 'vertical', fontFamily: 'var(--font-body)', lineHeight: 1.6 }}
              value={notesText}
              onChange={e => setNotesText(e.target.value)}
              placeholder="Invoice dates, payment terms, custom agreements…"
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setNotesModal(null)}>Cancel</button>
              <button className="btn btn-primary" disabled={notesSaving} onClick={saveNotes}>
                {notesSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
