import { useState, useEffect, useRef, useCallback } from 'react'
import mammoth from 'mammoth'
import { supabase } from '../../lib/supabase'
import { callClaude } from '../../utils/api'
import { extractContent, isSupported, fileExt, ACCEPT_ATTR } from '../../utils/fileExtract'
import { subscribePoolMatch, startPoolMatch, isPoolMatchRunning } from '../../utils/poolMatchRunner'

const CV_PARSE_SYSTEM = `You are a CV parser. Return ONLY valid JSON — no markdown:
{"name":"string","email":"string","currentRole":"string","totalYears":number,"skills":["..."],"education":"string","summary":"string","highlights":["..."]}`

const NLP_SEARCH_SYSTEM = `You are a talent database search parser. Given a recruiter's natural language query, return ONLY valid JSON (no markdown):
{"role":"primary job title or role type","minYears":null,"maxYears":null,"skills":["skill1","skill2"],"availability":"available|any","booleanSearch":"full LinkedIn/Naukri boolean search string using AND OR NOT operators and quoted phrases"}`

const FORMAT_ICON = { pdf: '📕', docx: '📝', txt: '📄', jpg: '🖼️', jpeg: '🖼️', png: '🖼️' }
const AVAILABILITY_OPTS = ['available', 'placed', 'unavailable']
const AVAIL_BADGE = { available: 'badge-green', placed: 'badge-blue', unavailable: 'badge-amber' }

export default function AdminTalentPool() {
  const [candidates, setCandidates] = useState([])
  const [files, setFiles]           = useState([])
  const [dragging, setDragging]     = useState(false)
  const [parsing, setParsing]       = useState(false)
  const [loading, setLoading]       = useState(true)
  const [search, setSearch]         = useState('')
  const [availFilter, setAvailFilter] = useState('all')
  const [jobs, setJobs]             = useState([])
  const [matchJobId, setMatchJobId] = useState('')
  const [matching, setMatching]     = useState(false)
  const [matchProgress, setMatchProgress] = useState({ current: 0, total: 0 })
  const [log, setLog]               = useState([])
  const [matchResults, setMatchResults] = useState([])
  const [matchDone, setMatchDone]   = useState(false)
  const [resultSort, setResultSort] = useState('score-desc')
  const [resultFilter, setResultFilter] = useState('all')
  const [showLog, setShowLog]       = useState(false)
  const [selected, setSelected]     = useState(null)
  const [nlpQuery, setNlpQuery]     = useState('')
  const [nlpSearching, setNlpSearching] = useState(false)
  const [nlpResults, setNlpResults] = useState(null)
  const [nlpParsed, setNlpParsed]   = useState(null)
  const [booleanStr, setBooleanStr] = useState('')
  const [boolCopied, setBoolCopied] = useState(false)
  const [addJobSelections, setAddJobSelections] = useState({})
  const [addedToJob, setAddedToJob] = useState({})
  const [addingCandidateId, setAddingCandidateId] = useState(null)
  const [deletePoolModal, setDeletePoolModal]     = useState(null)
  const [allocModal, setAllocModal]               = useState(null)
  const [allocModalJobId, setAllocModalJobId]     = useState('')
  const [allocModalStage, setAllocModalStage]     = useState('sourced')
  const [allocating, setAllocating]               = useState(false)
  const [allocations, setAllocations]             = useState({})
  const [toast, setToast]                         = useState(null)
  const [page, setPage]                           = useState(0)
  const [total, setTotal]                         = useState(0)
  const fileInputRef = useRef()
  const logRef       = useRef()

  const PAGE_SIZE = 50

  useEffect(() => { load(0) }, [])
  useEffect(() => { logRef.current?.scrollTo(0, logRef.current.scrollHeight) }, [log])

  // Re-attach to any in-progress pool match when this component mounts
  useEffect(() => {
    const unsub = subscribePoolMatch(snap => {
      setMatching(snap.running)
      setMatchProgress(snap.progress)
      setLog(snap.log)
      setMatchResults(snap.results)
      setMatchDone(snap.done)
      if (snap.jobId) setMatchJobId(snap.jobId)
    })
    return unsub
  }, [])

  async function load(p = 0) {
    setLoading(true)
    try { // fix: wrap in try/finally so setLoading(false) always fires on query error
      const from = p * PAGE_SIZE
      const to   = from + PAGE_SIZE - 1
      const [{ data: pool, count }, { data: jobList }] = await Promise.all([
        supabase.from('talent_pool').select('*', { count: 'exact' }).order('created_at', { ascending: false }).range(from, to),
        supabase.from('jobs').select('id, title, profiles(company_name)').eq('status', 'active').order('created_at', { ascending: false }).limit(500),
      ])
      setCandidates(pool ?? [])
      setTotal(count ?? 0)
      setPage(p)
      setJobs(jobList ?? [])
    } finally {
      setLoading(false) // fix: always clear loading even when Promise.all fails
    }
  }

  const addLog = (msg, type = '') => setLog(p => [...p, { id: Date.now() + Math.random(), msg, type }])

  // ── File handling ─────────────────────────────────────────────────────────
  const addFiles = useCallback((incoming) => {
    const valid = Array.from(incoming).filter(isSupported)
    if (!valid.length) return
    setFiles(p => [...p, ...valid
      .filter(f => !p.some(e => e.file.name === f.name))
      .map(f => ({ id: crypto.randomUUID(), file: f, ext: fileExt(f), status: 'pending', parsed: null, error: '' }))])
  }, [])

  const onDrop = useCallback((e) => {
    e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files)
  }, [addFiles])

  function patchFile(id, updates) {
    setFiles(p => p.map(f => f.id === id ? { ...f, ...updates } : f))
  }

  async function parseAll() {
    setParsing(true)
    for (const entry of files.filter(f => f.status === 'pending')) {
      patchFile(entry.id, { status: 'parsing' })
      addLog(`Parsing ${entry.file.name}…`, 'info')
      try {
        // For DOCX, use mammoth directly to guarantee text extraction
        let content
        if (entry.ext === 'docx') {
          const arrayBuffer = await entry.file.arrayBuffer()
          const result = await mammoth.extractRawText({ arrayBuffer })
          if (!result.value?.trim()) throw new Error('No text could be extracted from this DOCX file')
          content = { kind: 'text', text: result.value }
        } else {
          content = await extractContent(entry.file)
        }

        if (content.kind === 'images') {
          addLog(`  ℹ Scanned PDF detected — using vision (${content.pages.length} page${content.pages.length !== 1 ? 's' : ''})`, 'info')
        }
        const msgs = content.kind === 'images'
          ? [{ role: 'user', content: [
              ...content.pages.map(p => ({ type: 'image', source: { type: 'base64', media_type: p.mediaType, data: p.base64 } })),
              { type: 'text', text: 'Parse this CV. It is provided as page images from a scanned PDF.' },
            ]}]
          : content.kind === 'image'
          ? [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: content.mediaType, data: content.base64 } }, { type: 'text', text: 'Parse this CV image.' }] }]
          : [{ role: 'user', content: `Parse this CV:\n\n${content.text}` }]

        let parsed
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            const reply = await callClaude(msgs, CV_PARSE_SYSTEM, 1024)
            const jsonStr = reply.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
            parsed = JSON.parse(jsonStr)
            break
          } catch (err) {
            if (attempt === 3) throw new Error(`Claude parse failed after 3 attempts: ${err.message}`)
            addLog(`  ↻ Retrying parse (attempt ${attempt + 1}/3)…`, 'info')
            await new Promise(r => setTimeout(r, 1000 * attempt))
          }
        }

        const { data: saved, error } = await supabase.from('talent_pool').insert({
          full_name:      parsed.name,
          email:          parsed.email ?? '',
          candidate_role: parsed.currentRole ?? '',
          total_years:    parsed.totalYears ?? 0,
          skills:         parsed.skills ?? [],
          education:      parsed.education ?? '',
          summary:        parsed.summary ?? '',
          highlights:     parsed.highlights ?? [],
          raw_text:       content.kind === 'text' ? content.text : '',
          availability:   'available',
        }).select().single()

        if (error) throw new Error(error.message)
        addLog(`✓ ${parsed.name} added to pool`, 'ok')
        patchFile(entry.id, { status: 'done', parsed })
        setCandidates(p => [saved, ...p])
      } catch (err) {
        addLog(`✗ ${entry.file.name}: ${err.message}`, 'err')
        patchFile(entry.id, { status: 'error', error: err.message })
      }
    }
    setParsing(false)
    if (matchJobId && !isPoolMatchRunning()) {
      startPoolMatch(matchJobId)
    }
  }

  async function updateAvailability(id, availability) {
    await supabase.from('talent_pool').update({ availability }).eq('id', id)
    setCandidates(p => p.map(c => c.id === id ? { ...c, availability } : c))
    if (selected?.id === id) setSelected(s => ({ ...s, availability }))
  }

  function scoreCandidate(c, parsed) {
    let score = 0
    const role = (parsed.role ?? '').toLowerCase()
    const cRole = (c.candidate_role ?? '').toLowerCase()
    if (role) {
      if (cRole.includes(role)) score += 40
      else {
        const words = role.split(/\s+/)
        score += Math.round((words.filter(w => cRole.includes(w)).length / words.length) * 30)
      }
    } else {
      score += 20
    }
    const reqSkills = (parsed.skills ?? []).map(s => s.toLowerCase())
    const cSkills   = (c.skills ?? []).map(s => s.toLowerCase())
    if (reqSkills.length > 0) {
      const matched = reqSkills.filter(rs => cSkills.some(cs => cs.includes(rs) || rs.includes(cs)))
      score += Math.round((matched.length / reqSkills.length) * 40)
    } else {
      score += 20
    }
    const years = c.total_years ?? 0
    if (parsed.minYears != null) {
      if (years >= parsed.minYears) score += 10
      else if (years >= parsed.minYears - 2) score += 5
    } else {
      score += 5
    }
    if (parsed.maxYears != null && years > parsed.maxYears) score -= 5
    if (parsed.availability === 'available' && c.availability === 'available') score += 5
    else if (parsed.availability !== 'available') score += 5
    return score
  }

  async function runNlpSearch() {
    if (!nlpQuery.trim()) return
    setNlpSearching(true)
    setNlpResults(null)
    setNlpParsed(null)
    setBooleanStr('')
    try {
      const reply = await callClaude([{ role: 'user', content: nlpQuery }], NLP_SEARCH_SYSTEM, 512)
      const jsonStr = reply.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
      const parsed = JSON.parse(jsonStr)
      setNlpParsed(parsed)
      setBooleanStr(parsed.booleanSearch ?? '')
      const scored = candidates
        .map(c => ({ ...c, nlpScore: scoreCandidate(c, parsed) }))
        .filter(c => c.nlpScore > 15)
        .sort((a, b) => b.nlpScore - a.nlpScore)
      setNlpResults(scored)
    } catch (_) {
      setNlpResults([])
    }
    setNlpSearching(false)
  }

  function showToast(msg, ok = true) {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3000)
  }

  async function handleAllocate() {
    const r = allocModal.result
    setAllocating(true)
    const job = jobs.find(j => j.id === allocModalJobId)
    const { error } = await supabase.from('candidates').insert({
      job_id:         allocModalJobId,
      full_name:      r.name,
      email:          r.email ?? '',
      candidate_role: r.candidate_role ?? '',
      total_years:    r.total_years ?? 0,
      skills:         r.skills ?? [],
      summary:        r.summary ?? '',
      highlights:     r.highlights ?? [],
      raw_text:       r.raw_text ?? '',
      source:         'talent_pool',
      pipeline_stage: allocModalStage,
      ...(allocModalStage === 'shortlisted' ? { match_pass: true, match_score: r.score } : {}),
    })
    setAllocating(false)
    if (!error) {
      setAllocations(prev => ({
        ...prev,
        [r.talent_id]: [...(prev[r.talent_id] ?? []), { jobId: allocModalJobId, jobTitle: job?.title ?? 'Job' }],
      }))
      showToast(`${r.name} added to "${job?.title ?? 'job'}" · ${allocModalStage}`)
      setAllocModal(null)
    } else {
      showToast(error.message, false)
    }
  }

  async function handleDeletePoolCandidate() {
    const id = deletePoolModal.candidate.id
    setDeletePoolModal(m => ({ ...m, deleting: true }))
    const { error } = await supabase.from('talent_pool').delete().eq('id', id)
    if (!error) {
      setCandidates(p => p.filter(c => c.id !== id))
      if (selected?.id === id) setSelected(null)
    }
    setDeletePoolModal(null)
  }

  async function addToJobPipeline(candidate, jobId) {
    if (!jobId) return
    setAddingCandidateId(candidate.id)
    const { error } = await supabase.from('candidates').insert({
      job_id:         jobId,
      full_name:      candidate.full_name,
      email:          candidate.email ?? '',
      candidate_role: candidate.candidate_role ?? '',
      total_years:    candidate.total_years ?? 0,
      summary:        candidate.summary ?? '',
      raw_text:       candidate.raw_text ?? '',
    })
    setAddingCandidateId(null)
    if (!error) setAddedToJob(p => ({ ...p, [candidate.id + jobId]: true }))
  }

  function runMatch() {
    if (!matchJobId || isPoolMatchRunning()) return
    setShowLog(false)
    startPoolMatch(matchJobId)
  }

  // ── Derived ───────────────────────────────────────────────────────────────
  const filtered = candidates.filter(c => {
    const okAvail  = availFilter === 'all' || c.availability === availFilter
    const q        = search.toLowerCase()
    const okSearch = !q ||
      c.full_name?.toLowerCase().includes(q) ||
      c.candidate_role?.toLowerCase().includes(q) ||
      (c.skills ?? []).some(s => s.toLowerCase().includes(q))
    return okAvail && okSearch
  })

  const pendingCount   = files.filter(f => f.status === 'pending').length
  const doneCount      = files.filter(f => f.status === 'done').length
  const parseProgress  = files.length ? (doneCount / files.length) * 100 : 0
  const running        = parsing || matching

  const availCounts = { available: 0, placed: 0, unavailable: 0 }
  candidates.forEach(c => { if (availCounts[c.availability] != null) availCounts[c.availability]++ })

  if (loading) return <div className="page"><span className="spinner" /></div>

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>Talent Pool</h2>
          <p>{candidates.length} candidate{candidates.length !== 1 ? 's' : ''} in master pool</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ padding: '6px 14px', background: 'var(--green-d)', border: '1px solid var(--green)', borderRadius: 'var(--r)', fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--green)' }}>
            {availCounts.available} available
          </div>
          <div style={{ padding: '6px 14px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r)', fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-3)' }}>
            {availCounts.placed} placed
          </div>
        </div>
      </div>

      {/* ── 1 Upload to Pool ── */}
      <div className="section-card">
        <div className="section-card-head"><h3>1 · Upload CVs to Pool</h3></div>
        <div className="section-card-body">
          <div
            className={`drop-zone${dragging ? ' drag-over' : ''}`}
            onDrop={onDrop}
            onDragOver={e => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onClick={() => fileInputRef.current.click()}
          >
            <div className="drop-icon">⬆</div>
            <p>Drop CVs or <span className="link">browse</span> to add to the master talent pool</p>
            <div className="format-pills">
              {['PDF', 'DOCX', 'TXT', 'JPG', 'PNG'].map(f => <span key={f} className="format-pill">{f}</span>)}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPT_ATTR}
              multiple
              style={{ display: 'none' }}
              onChange={e => { addFiles(e.target.files); e.target.value = '' }}
            />
          </div>

          {files.length > 0 && (
            <div className="file-list">
              <div className="file-list-header">
                <span>{files.length} file{files.length !== 1 ? 's' : ''}</span>
                {parsing && (
                  <div style={{ flex: 1 }}>
                    <div className="progress-track"><div className="progress-fill" style={{ width: `${parseProgress}%` }} /></div>
                  </div>
                )}
                <button
                  className="btn btn-primary"
                  style={{ padding: '5px 12px', fontSize: 12 }}
                  disabled={!pendingCount || parsing}
                  onClick={parseAll}
                >
                  {parsing
                    ? <><span className="spinner" style={{ width: 11, height: 11 }} /> Parsing…</>
                    : 'Parse & Add to Pool'}
                </button>
              </div>
              {files.map(f => (
                <div key={f.id} className="file-row">
                  <div className="file-info">
                    <span className="file-icon">{FORMAT_ICON[f.ext] ?? '📄'}</span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <span className="file-name">{f.file.name}</span>
                        <span className={`badge ${f.ext === 'pdf' ? 'badge-red' : f.ext === 'docx' ? 'badge-blue' : 'badge-amber'}`} style={{ fontSize: 9 }}>
                          {f.ext?.toUpperCase()}
                        </span>
                      </div>
                      {f.parsed && <div className="file-parsed"><strong>{f.parsed.name}</strong> · {f.parsed.currentRole}</div>}
                      {f.status === 'error' && <div className="error-text">⚠ {f.error}</div>}
                    </div>
                  </div>
                  <div className="file-status">
                    {f.status === 'pending' && <span className="badge badge-amber">Pending</span>}
                    {f.status === 'parsing' && <span className="spinner" />}
                    {f.status === 'done'    && <span className="badge badge-green">Added</span>}
                    {f.status === 'error'   && <span className="badge badge-red">Error</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── 2 Pool Table ── */}
      <div className="section-card">
        <div className="section-card-head">
          <h3>2 · Candidate Pool</h3>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="text"
              placeholder="Search name, role, skill…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ width: 220, padding: '5px 10px', fontSize: 12 }}
            />
            <select
              value={availFilter}
              onChange={e => setAvailFilter(e.target.value)}
              style={{ fontSize: 12, padding: '5px 10px' }}
            >
              <option value="all">All</option>
              {AVAILABILITY_OPTS.map(a => (
                <option key={a} value={a}>{a.charAt(0).toUpperCase() + a.slice(1)}</option>
              ))}
            </select>
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="empty-state">
            {candidates.length === 0
              ? 'No candidates in the pool yet. Upload CVs above.'
              : 'No candidates match this filter.'}
          </div>
        ) : (
          filtered.map(c => (
            <div key={c.id} className="table-row clickable" onClick={() => setSelected(c)}>
              <div className="col-main">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div className="profile-avatar" style={{ width: 34, height: 34, fontSize: 14, borderRadius: 'var(--r)', flexShrink: 0 }}>
                    {(c.full_name ?? '?')[0].toUpperCase()}
                  </div>
                  <div>
                    <div className="col-name">{c.full_name}</div>
                    <div className="col-sub">{c.candidate_role} · {c.total_years}y exp</div>
                  </div>
                </div>
              </div>
              <div className="col-right">
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', maxWidth: 200, justifyContent: 'flex-end' }}>
                  {(c.skills ?? []).slice(0, 3).map(s => (
                    <span key={s} style={{ fontSize: 9, fontFamily: 'var(--font-mono)', padding: '2px 6px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r)', color: 'var(--text-3)' }}>
                      {s}
                    </span>
                  ))}
                </div>
                <select
                  value={c.availability ?? 'available'}
                  onClick={e => e.stopPropagation()}
                  onChange={e => updateAvailability(c.id, e.target.value)}
                  style={{ fontSize: 10, padding: '2px 6px', border: '1px solid var(--border)', background: 'var(--surface2)', borderRadius: 'var(--r)', color: 'var(--text-2)' }}
                >
                  {AVAILABILITY_OPTS.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
                <span className={`badge ${AVAIL_BADGE[c.availability ?? 'available']}`} style={{ fontSize: 9 }}>
                  {c.availability ?? 'available'}
                </span>
                <button
                  className="btn btn-ghost"
                  title="Remove from pool"
                  style={{ padding: '2px 6px', fontSize: 14, color: 'var(--red)', opacity: 0.5 }}
                  onClick={e => { e.stopPropagation(); setDeletePoolModal({ candidate: c }) }}
                >🗑</button>
              </div>
            </div>
          ))
        )}

        {/* Pagination */}
        {total > PAGE_SIZE && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px', borderTop: '1px solid var(--border)' }}>
            <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-3)' }}>
              {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn btn-secondary" style={{ fontSize: 10, padding: '3px 10px' }} disabled={page === 0} onClick={() => load(page - 1)}>← Prev</button>
              <button className="btn btn-secondary" style={{ fontSize: 10, padding: '3px 10px' }} disabled={(page + 1) * PAGE_SIZE >= total} onClick={() => load(page + 1)}>Next →</button>
            </div>
          </div>
        )}
      </div>

      {/* ── 3 Match Pool to Job ── */}
      <div className="section-card">
        <div className="section-card-head"><h3>3 · Match Pool to Job</h3></div>
        <div className="section-card-body">
          <p style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 14 }}>
            Run AI screening on all available pool candidates against a job. Results appear in the recruiter's pipeline and the admin's Pipeline page.
          </p>
          {matching && matchProgress.total > 0 && (
            <div style={{ marginBottom: 14, padding: '10px 14px', background: 'rgba(184,146,74,0.07)', border: '1px solid rgba(184,146,74,0.3)', borderRadius: 'var(--r)', display: 'flex', alignItems: 'center', gap: 12 }}>
              <span className="spinner" style={{ width: 12, height: 12, flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 6 }}>
                  Matching in progress — {matchProgress.current} of {matchProgress.total} candidates scored
                </div>
                <div style={{ height: 4, background: 'var(--surface2)', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${(matchProgress.current / matchProgress.total) * 100}%`, background: 'var(--accent)', borderRadius: 2, transition: 'width 0.3s' }} />
                </div>
              </div>
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <select value={matchJobId} onChange={e => setMatchJobId(e.target.value)} style={{ flex: 1 }} disabled={matching}>
              <option value="">— select active job —</option>
              {jobs.map(j => (
                <option key={j.id} value={j.id}>
                  {j.title}{j.profiles?.company_name ? ` · ${j.profiles.company_name}` : ''}
                </option>
              ))}
            </select>
            <button
              className="btn btn-primary"
              disabled={!matchJobId || matching}
              onClick={runMatch}
              style={{ whiteSpace: 'nowrap' }}
            >
              {matching ? (
                <>
                  <span className="spinner" style={{ width: 12, height: 12 }} />
                  {matchProgress.total > 0 ? ` ${matchProgress.current}/${matchProgress.total}` : ' Matching…'}
                </>
              ) : 'Run Match'}
            </button>
          </div>
        </div>
      </div>

      {/* ── Progress log (visible during matching) ── */}
      {log.length > 0 && !matchDone && (
        <div className="pipeline-log-wrap">
          <div className="pipeline-log-head">
            <span className="spinner" style={{ width: 8, height: 8, opacity: running ? 1 : 0 }} />
            Progress Log
          </div>
          <div className="pipeline-log" ref={logRef}>
            {log.map(l => <div key={l.id} className={`log-line${l.type ? ' ' + l.type : ''}`}>{l.msg}</div>)}
          </div>
        </div>
      )}

      {/* ── Match results cards (shown after match completes) ── */}
      {matchDone && matchResults.length > 0 && (() => {
        const passScores = matchResults.filter(r => r.pass).map(r => r.score)
        const threshold  = passScores.length ? Math.min(...passScores) : null

        const sorted = [...matchResults]
          .filter(r => resultFilter === 'all' || (resultFilter === 'pass' ? r.pass : !r.pass))
          .sort((a, b) =>
            resultSort === 'score-desc' ? b.score - a.score :
            resultSort === 'score-asc'  ? a.score - b.score :
            a.name.localeCompare(b.name)
          )

        return (
          <div className="section-card">
            <div className="section-card-head" style={{ flexWrap: 'wrap', gap: 10 }}>
              <div>
                <h3>Match Results</h3>
                {threshold != null && (
                  <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2, fontFamily: 'var(--font-mono)' }}>
                    Passing score: ≥{threshold}/100
                  </p>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <select
                  value={resultSort}
                  onChange={e => setResultSort(e.target.value)}
                  style={{ fontSize: 12, padding: '4px 8px' }}
                >
                  <option value="score-desc">Best to Worst</option>
                  <option value="score-asc">Worst to Best</option>
                  <option value="name">A–Z by Name</option>
                </select>
                <select
                  value={resultFilter}
                  onChange={e => setResultFilter(e.target.value)}
                  style={{ fontSize: 12, padding: '4px 8px' }}
                >
                  <option value="all">All Candidates</option>
                  <option value="pass">Passed Only</option>
                  <option value="fail">Failed Only</option>
                </select>
                <button
                  style={{ fontSize: 11, padding: '4px 10px', background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--r)', color: 'var(--text-3)', cursor: 'pointer', fontFamily: 'var(--font-mono)' }}
                  onClick={() => setShowLog(v => !v)}
                >
                  {showLog ? 'Hide log' : 'Show log'}
                </button>
              </div>
            </div>

            {showLog && (
              <div className="pipeline-log" style={{ margin: '0 0 16px', borderRadius: 'var(--r)' }}>
                {log.map(l => <div key={l.id} className={`log-line${l.type ? ' ' + l.type : ''}`}>{l.msg}</div>)}
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12, padding: '0 20px 20px' }}>
              {sorted.map((r, i) => (
                <div key={i} style={{
                  background: 'var(--surface)',
                  border: `1px solid ${r.pass ? 'var(--accent)' : 'var(--border)'}`,
                  borderRadius: 'var(--r)',
                  padding: 16,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}>
                  {/* Header: avatar + name + badge */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div className="profile-avatar" style={{ width: 36, height: 36, fontSize: 14, borderRadius: 'var(--r)', flexShrink: 0, background: r.pass ? 'var(--accent-d)' : 'var(--surface2)', color: r.pass ? 'var(--accent)' : 'var(--text-3)', border: `1px solid ${r.pass ? 'var(--accent)' : 'var(--border)'}` }}>
                      {r.name[0]?.toUpperCase()}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</div>
                      <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{r.rank}</div>
                    </div>
                    <span style={{
                      fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700,
                      padding: '3px 8px', borderRadius: 'var(--r)', whiteSpace: 'nowrap',
                      background: r.pass ? 'var(--accent-d)' : 'var(--red-d)',
                      color: r.pass ? 'var(--accent)' : 'var(--red)',
                      border: `1px solid ${r.pass ? 'var(--accent)' : 'var(--red)'}`,
                    }}>
                      {r.pass ? 'PASS' : 'FAIL'}
                    </span>
                  </div>

                  {/* Score bar */}
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                      <span style={{ fontSize: 10, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Match Score</span>
                      <span style={{ fontSize: 18, fontWeight: 700, fontFamily: 'var(--font-mono)', color: r.pass ? 'var(--accent)' : 'var(--red)' }}>{r.score}<span style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 400 }}>/100</span></span>
                    </div>
                    <div style={{ height: 4, background: 'var(--surface2)', borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${r.score}%`, background: r.pass ? 'var(--accent)' : 'var(--red)', borderRadius: 2, transition: 'width 0.4s ease' }} />
                    </div>
                  </div>

                  {/* Reason */}
                  {r.reason && (
                    <p style={{ fontSize: 12, color: 'var(--text-2)', margin: 0, lineHeight: 1.5 }}>{r.reason}</p>
                  )}

                  {/* Allocation tags */}
                  {(allocations[r.talent_id] ?? []).length > 0 && (
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {allocations[r.talent_id].map(a => (
                        <span key={a.jobId} style={{ fontSize: 9, padding: '2px 7px', background: 'rgba(184,146,74,0.1)', border: '1px solid rgba(184,146,74,0.3)', borderRadius: 'var(--r)', fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>
                          ✓ {a.jobTitle}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Allocate button */}
                  <button
                    className="btn btn-secondary"
                    style={{ fontSize: 11, padding: '5px 10px', width: '100%', justifyContent: 'center' }}
                    onClick={() => { setAllocModal({ result: r }); setAllocModalJobId(''); setAllocModalStage('sourced') }}
                  >
                    + Allocate to Job
                  </button>
                </div>
              ))}
            </div>
          </div>
        )
      })()}

      {/* ── 4 AI Smart Search ── */}
      <div className="section-card">
        <div className="section-card-head"><h3>4 · AI Smart Search</h3></div>
        <div className="section-card-body">
          <p style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 14 }}>
            Describe your ideal candidate in plain English. AI converts it to structured filters and a Boolean search string for LinkedIn / Naukri.
          </p>
          <div style={{ display: 'flex', gap: 10 }}>
            <input
              type="text"
              placeholder='e.g. "Senior product manager 7+ years fintech experience in Delhi"'
              value={nlpQuery}
              onChange={e => setNlpQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && runNlpSearch()}
              style={{ flex: 1, padding: '9px 12px', fontSize: 13 }}
            />
            <button
              className="btn btn-primary"
              disabled={!nlpQuery.trim() || nlpSearching}
              onClick={runNlpSearch}
              style={{ whiteSpace: 'nowrap' }}
            >
              {nlpSearching ? <><span className="spinner" style={{ width: 12, height: 12 }} /> Searching…</> : 'Search Pool'}
            </button>
          </div>

          {nlpParsed && (
            <div style={{ marginTop: 14, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              {nlpParsed.role && <span style={{ fontSize: 10, padding: '3px 8px', background: 'rgba(184,146,74,0.1)', border: '1px solid rgba(184,146,74,0.3)', borderRadius: 'var(--r)', fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>role: {nlpParsed.role}</span>}
              {nlpParsed.minYears != null && <span style={{ fontSize: 10, padding: '3px 8px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r)', fontFamily: 'var(--font-mono)', color: 'var(--text-3)' }}>{nlpParsed.minYears}+ yrs</span>}
              {(nlpParsed.skills ?? []).map(s => (
                <span key={s} style={{ fontSize: 10, padding: '3px 8px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r)', fontFamily: 'var(--font-mono)', color: 'var(--text-3)' }}>{s}</span>
              ))}
            </div>
          )}

          {booleanStr && (
            <div style={{ marginTop: 14, padding: '12px 14px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r)', position: 'relative' }}>
              <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-3)', marginBottom: 6 }}>Boolean Search String</div>
              <code style={{ fontSize: 11, color: 'var(--text-2)', lineHeight: 1.6, display: 'block', wordBreak: 'break-word' }}>{booleanStr}</code>
              <button
                onClick={() => { navigator.clipboard.writeText(booleanStr); setBoolCopied(true); setTimeout(() => setBoolCopied(false), 2000) }}
                style={{ position: 'absolute', top: 10, right: 10, fontSize: 10, padding: '3px 8px', background: boolCopied ? 'var(--green-d)' : 'var(--surface)', border: `1px solid ${boolCopied ? 'var(--green)' : 'var(--border)'}`, borderRadius: 'var(--r)', cursor: 'pointer', fontFamily: 'var(--font-mono)', color: boolCopied ? 'var(--green)' : 'var(--text-3)' }}
              >
                {boolCopied ? '✓ Copied' : 'Copy'}
              </button>
            </div>
          )}
        </div>

        {nlpResults !== null && (
          <div>
            {nlpResults.length === 0 ? (
              <div className="empty-state">No candidates match this query. Try broader terms.</div>
            ) : (
              <>
                <div style={{ padding: '8px 20px 4px', fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', borderTop: '1px solid var(--border)' }}>
                  {nlpResults.length} match{nlpResults.length !== 1 ? 'es' : ''} found
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12, padding: '12px 20px 20px' }}>
                  {nlpResults.map(c => {
                    const jobKey = addJobSelections[c.id] || ''
                    const added = addedToJob[c.id + jobKey]
                    return (
                      <div key={c.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r)', padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div className="profile-avatar" style={{ width: 36, height: 36, fontSize: 14, borderRadius: 'var(--r)', flexShrink: 0 }}>
                            {(c.full_name ?? '?')[0].toUpperCase()}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.full_name}</div>
                            <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-3)' }}>{c.candidate_role} · {c.total_years}y</div>
                          </div>
                          <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--accent)', flexShrink: 0 }}>{c.nlpScore}</span>
                        </div>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {(c.skills ?? []).slice(0, 4).map(s => (
                            <span key={s} style={{ fontSize: 9, padding: '2px 6px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r)', fontFamily: 'var(--font-mono)', color: 'var(--text-3)' }}>{s}</span>
                          ))}
                        </div>
                        {added ? (
                          <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--green)', textAlign: 'center', padding: '6px 0' }}>✓ Added to pipeline</div>
                        ) : (
                          <div style={{ display: 'flex', gap: 6 }}>
                            <select
                              value={addJobSelections[c.id] ?? ''}
                              onChange={e => setAddJobSelections(p => ({ ...p, [c.id]: e.target.value }))}
                              style={{ flex: 1, fontSize: 11, padding: '4px 6px' }}
                            >
                              <option value="">— select job —</option>
                              {jobs.map(j => <option key={j.id} value={j.id}>{j.title}{j.profiles?.company_name ? ` · ${j.profiles.company_name}` : ''}</option>)}
                            </select>
                            <button
                              className="btn btn-primary"
                              style={{ padding: '4px 10px', fontSize: 11, whiteSpace: 'nowrap' }}
                              disabled={!addJobSelections[c.id] || addingCandidateId === c.id}
                              onClick={() => addToJobPipeline(c, addJobSelections[c.id])}
                            >
                              {addingCandidateId === c.id ? <span className="spinner" style={{ width: 10, height: 10 }} /> : 'Add →'}
                            </button>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* ── Delete Pool Candidate Modal ── */}
      {deletePoolModal && (
        <div className="modal-overlay" onClick={() => setDeletePoolModal(null)}>
          <div className="modal" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <div>
                <h3>Remove from Pool</h3>
                <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>This cannot be undone</p>
              </div>
              <button className="modal-close" onClick={() => setDeletePoolModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 13, color: 'var(--text-2)' }}>
                Are you sure you want to remove <strong>{deletePoolModal.candidate.full_name}</strong> from the talent pool?
              </p>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
                <button className="btn btn-secondary" onClick={() => setDeletePoolModal(null)}>Cancel</button>
                <button
                  className="btn btn-primary"
                  style={{ background: 'var(--red)', borderColor: 'var(--red)' }}
                  disabled={deletePoolModal.deleting}
                  onClick={handleDeletePoolCandidate}
                >
                  {deletePoolModal.deleting ? <><span className="spinner" style={{ width: 11, height: 11 }} /> Removing…</> : 'Remove'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Candidate Detail Modal ── */}
      {selected && (
        <div className="modal-overlay" onClick={() => setSelected(null)}>
          <div className="modal" style={{ maxWidth: 600 }} onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <div>
                <h3>{selected.full_name}</h3>
                <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>
                  {selected.candidate_role} · {selected.total_years}y exp
                </p>
              </div>
              <button className="modal-close" onClick={() => setSelected(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 20, flexWrap: 'wrap' }}>
                <select
                  value={selected.availability ?? 'available'}
                  onChange={e => updateAvailability(selected.id, e.target.value)}
                  style={{ fontSize: 12, padding: '5px 10px' }}
                >
                  {AVAILABILITY_OPTS.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
                {selected.email && (
                  <span style={{ fontSize: 12, color: 'var(--text-2)', fontFamily: 'var(--font-mono)' }}>{selected.email}</span>
                )}
              </div>

              {selected.summary && (
                <div style={{ marginBottom: 18 }}>
                  <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-3)', marginBottom: 6 }}>Summary</div>
                  <p style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.7, margin: 0 }}>{selected.summary}</p>
                </div>
              )}

              {(selected.skills ?? []).length > 0 && (
                <div style={{ marginBottom: 18 }}>
                  <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-3)', marginBottom: 6 }}>Skills</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {selected.skills.map(s => (
                      <span key={s} style={{ fontSize: 11, padding: '3px 8px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r)', color: 'var(--text-2)' }}>
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {(selected.highlights ?? []).length > 0 && (
                <div>
                  <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-3)', marginBottom: 6 }}>Highlights</div>
                  <ul style={{ margin: 0, paddingLeft: 16, fontSize: 13, color: 'var(--text-2)', lineHeight: 1.8 }}>
                    {selected.highlights.map((h, i) => <li key={i}>{h}</li>)}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Allocate to Job Modal ── */}
      {allocModal && (
        <div className="modal-overlay" onClick={() => setAllocModal(null)}>
          <div className="modal" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <div>
                <h3>Allocate to Job</h3>
                <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>{allocModal.result.name}</p>
              </div>
              <button className="modal-close" onClick={() => setAllocModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="field" style={{ marginBottom: 14 }}>
                <label>Job</label>
                <select value={allocModalJobId} onChange={e => setAllocModalJobId(e.target.value)}>
                  <option value="">— select active job —</option>
                  {jobs.map(j => (
                    <option key={j.id} value={j.id}>
                      {j.title}{j.profiles?.company_name ? ` · ${j.profiles.company_name}` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field" style={{ marginBottom: 24 }}>
                <label>Pipeline Stage</label>
                <select value={allocModalStage} onChange={e => setAllocModalStage(e.target.value)}>
                  <option value="sourced">Sourced</option>
                  <option value="screening">Screening</option>
                  <option value="shortlisted">Shortlisted</option>
                </select>
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button className="btn btn-secondary" onClick={() => setAllocModal(null)}>Cancel</button>
                <button
                  className="btn btn-primary"
                  disabled={!allocModalJobId || allocating}
                  onClick={handleAllocate}
                >
                  {allocating ? <><span className="spinner" style={{ width: 11, height: 11 }} /> Allocating…</> : 'Allocate'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Toast ── */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
          padding: '12px 18px', borderRadius: 'var(--r)',
          background: toast.ok ? 'var(--green-d)' : 'var(--red-d)',
          border: `1px solid ${toast.ok ? 'var(--green)' : 'var(--red)'}`,
          color: toast.ok ? 'var(--green)' : 'var(--red)',
          fontSize: 13, fontFamily: 'var(--font-mono)',
          display: 'flex', alignItems: 'center', gap: 8,
          boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
        }}>
          {toast.ok ? '✓' : '✗'} {toast.msg}
        </div>
      )}
    </div>
  )
}
