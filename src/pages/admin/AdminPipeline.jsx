import { useState, useEffect, useRef, useCallback } from 'react'
import { useLocation } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'
import { usePersistentState } from '../../hooks/usePersistentState'

import { callClaude, runAutomatedInterview, generateShortlistSummary, diagnosePipelineHealth } from '../../utils/api'
import { subscribeRunner, runnerStart, runnerComplete, runnerPause, runnerResume, runnerStop, awaitResume, getRunnerState } from '../../utils/pipelineRunner'
import { generateAssessment, scoreAssessment } from '../../utils/assessments'
import mammoth from 'mammoth'
import { extractContent, isSupported, fileExt, ACCEPT_ATTR } from '../../utils/fileExtract'
import { parseExperience } from '../../utils/parseExperience'
import { triggerTalentPoolMatch, mapMatchToCandidate } from '../../utils/talentPool'
import { logAudit } from '../../utils/audit'
import TagInput from '../../components/TagInput'
import VideoPlayer from '../../components/VideoPlayer'
import AIScoreFeedback from '../../components/AIScoreFeedback'

const stripRawText = (k, v) => k === 'raw_text' ? undefined : v

const CV_PARSE_SYSTEM = `You are a CV parser. Return ONLY valid JSON — no markdown:
{"name":"string","email":"string","currentRole":"string","totalYears":number,"skills":["..."],"education":"string","summary":"string","highlights":["..."],"linkedinUrl":"string or null","githubUrl":"string or null","portfolioUrl":"string or null"}`

const screeningSystem = (job) =>
  `You are an expert recruiter. Evaluate this candidate against the job.
The CV may be in any language. Translate internally before scoring. Always return your JSON response in English regardless of CV language.
Job: ${job.title} | ${job.experience_years}+ years | Required: ${(job.required_skills ?? []).join(', ')}
Description: ${job.description ?? ''}
Return ONLY valid JSON: {"matchScore":number,"pass":boolean,"reason":"string","rank":"top10|strong|moderate|weak"}`

const FORMAT_ICON = { pdf:'📕', docx:'📝', txt:'📄', jpg:'🖼️', jpeg:'🖼️', png:'🖼️' }
const REC_COLOR   = { 'Strong Hire': 'var(--green)', 'Hire': 'var(--accent)', 'Borderline': 'var(--amber)', 'Reject': 'var(--red)' }

function dimColor(v) { return v >= 70 ? 'var(--green)' : v >= 50 ? 'var(--accent)' : 'var(--red)' }

function daysAgo(ts) {
  if (!ts) return null
  const d = Math.floor((Date.now() - new Date(ts)) / 86_400_000)
  return d === 0 ? 'today' : d === 1 ? '1d' : `${d}d`
}

function slaDot(c) {
  const ref = c.stage_entered_at ?? c.screened_at ?? null
  if (!ref) return null
  const days = Math.floor((Date.now() - new Date(ref)) / 86_400_000)
  if (days >= 7) return { color: 'var(--red)',   title: `${days}d in stage — stalling` }
  if (days >= 3) return { color: 'var(--amber)', title: `${days}d in stage` }
  return null
}

function ScoreRing({ score, size = 48 }) {
  const r = size / 2 - 5, circ = 2 * Math.PI * r
  const fill = (score / 100) * circ, color = dimColor(score)
  return (
    <div className="score-ring">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--border2)" strokeWidth="4"/>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth="4"
          strokeDasharray={`${fill} ${circ}`} strokeLinecap="round" transform={`rotate(-90 ${size/2} ${size/2})`}/>
      </svg>
      <div className="ring-inner"><span className="ring-val">{score}</span></div>
    </div>
  )
}

const DEFAULT_JOB_FORM = { title:'', experience_years:3, required_skills:[], preferred_skills:[], description:'', tech_weight:60, comm_weight:40 }
const EMPTY_MANUAL = { full_name:'', email:'', phone:'', candidate_role:'', total_years:'', skills:'', education:'', summary:'', linkedin_url:'', github_url:'', portfolio_url:'', addToPool:false }
const appUrl = 'https://oneselect-ai-t6uo-phi.vercel.app'

export default function AdminPipeline({ allowedClientIds } = {}) {
  const { profile, user } = useAuth()
  const isClient = profile?.user_role === 'client'
  const location = useLocation()

  // Namespace keys so admin and recruiter don't share state
  const storagePrefix = allowedClientIds !== undefined ? 'recruiter_pipeline' : 'admin_pipeline'
  const initialClientRef = useRef(true)

  const [clients, setClients]         = useState([])
  const [clientId, setClientId]       = usePersistentState(storagePrefix + '_client_id', '')
  const [clientJobs, setClientJobs]   = useState([])
  const [jobId, setJobId]             = usePersistentState(storagePrefix + '_job_id', '')
  const [jobForm, setJobForm]         = useState(DEFAULT_JOB_FORM)
  const [activeJob, setActiveJob]     = usePersistentState(storagePrefix + '_active_job', null)
  const [candidates, setCandidates]   = usePersistentState(storagePrefix + '_candidates', [], stripRawText)
  const [files, setFiles]             = useState([])
  const [dragging, setDragging]       = useState(false)
  const [pipelineRunning, setPipelineRunning] = useState(false)
  const [pipelinePaused, setPipelinePaused]   = useState(false)
  const [assessmentEnabled, setAssessmentEnabled] = usePersistentState(storagePrefix + '_assessment_enabled', false)
  const [log, setLog]                 = usePersistentState(storagePrefix + '_log', [])
  const [useTalentPool, setUseTalentPool] = usePersistentState(storagePrefix + '_use_talent_pool', false)
  const [poolMatchLoading, setPoolMatchLoading] = useState(false)
  const [poolMatchProgress, setPoolMatchProgress] = useState({ current: 0, total: 0 })
  const [videoPlayerTarget, setVideoPlayerTarget] = useState(null)

  // Outreach (Feature 1)
  const [outreachLog, setOutreachLog]     = useState({}) // candidateId → {sent_at, responded, id}
  const [outreachModal, setOutreachModal] = useState(null)

  // AI invite modal (unchanged)
  const [aiInviteModal, setAiInviteModal] = useState(null)

  // Schedule modal — replaces simple liveInviteModal (Feature 4)
  const [scheduleModal, setScheduleModal] = useState(null)

  // Final decision modal
  const [decisionModal, setDecisionModal] = useState(null)

  // Live call modal
  const [liveCallModal, setLiveCallModal] = useState(null)

  // Recruiter notes modal
  const [notesModal, setNotesModal] = useState(null) // { candidate, text, saving }

  // Offer letter modal (Feature 5)
  const [offerModal, setOfferModal] = useState(null)

  // Delete + Add Manually
  const [deleteModal, setDeleteModal]           = useState(null)
  const [addManuallyModal, setAddManuallyModal] = useState(null)

  // AI shortlist + pipeline health
  const [shortlistSummary,        setShortlistSummary]        = useState(null)
  const [shortlistSummaryLoading, setShortlistSummaryLoading] = useState(false)
  const [pipelineHealth,          setPipelineHealth]          = useState(null)
  const [pipelineHealthLoading,   setPipelineHealthLoading]   = useState(false)

  // LinkedIn sourced candidates
  const [movingToScreening, setMovingToScreening] = useState(new Set())
  const [loadingJob, setLoadingJob] = useState(false)

  const running = pipelineRunning || poolMatchLoading
  const fileInputRef = useRef()
  const logRef = useRef()

  useEffect(() => { loadClients() }, [])
  useEffect(() => {
    const isInitial = initialClientRef.current
    initialClientRef.current = false
    if (!clientId) return
    loadClientJobs(clientId, isInitial)
  }, [clientId])
  useEffect(() => {
    if (!clients.length || clientId) return
    if (clients.length === 1) { setClientId(clients[0].id); return }
    const urlClient = new URLSearchParams(location.search).get('client')
    if (urlClient && clients.some(c => c.id === urlClient)) setClientId(urlClient)
  }, [clients, location.search])

  // Auto-select the job specified in ?job= once its client's jobs are loaded
  useEffect(() => {
    if (!clientJobs.length || jobId) return
    const urlJob = new URLSearchParams(location.search).get('job')
    if (urlJob && clientJobs.some(j => j.id === urlJob)) selectJob(urlJob)
  }, [clientJobs, jobId, location.search])

  useEffect(() => { logRef.current?.scrollTo(0, logRef.current.scrollHeight) }, [log])

  // Sync local running/paused state with the module-level runner singleton
  useEffect(() => {
    const { running, paused, jobId: rJobId } = getRunnerState()
    const isOurs = !!activeJob?.id && rJobId === activeJob.id
    if (running && isOurs) { setPipelineRunning(true); setPipelinePaused(paused); refreshCandidates() }
    return subscribeRunner(({ running: r, paused: p, jobId: rj }) => {
      const ours = !!activeJob?.id && rj === activeJob.id
      setPipelineRunning(r && ours)
      setPipelinePaused(p && ours)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeJob?.id])

  async function loadClients() {
    let q = supabase.from('profiles').select('id, full_name, company_name, email').eq('user_role', 'client').order('company_name')
    if (allowedClientIds?.length) q = q.in('id', allowedClientIds)
    const { data } = await q
    setClients(data ?? [])
  }

  async function loadClientJobs(cid, keepSelection = false) {
    if (!keepSelection) { setJobId(''); setActiveJob(null); setCandidates([]); setFiles([]) }
    const { data } = await supabase.from('jobs').select('*').eq('recruiter_id', cid).order('created_at', { ascending: false })
    setClientJobs(data ?? [])
  }

  function clearPipeline() {
    const suffixes = ['_client_id', '_job_id', '_active_job', '_candidates', '_assessment_enabled', '_log', '_use_talent_pool']
    suffixes.forEach(s => localStorage.removeItem(storagePrefix + s))
    setClientId('')
    setJobId('')
    setActiveJob(null)
    setCandidates([])
    setAssessmentEnabled(false)
    setLog([])
    setUseTalentPool(false)
    setClientJobs([])
    setFiles([])
  }

  async function selectJob(id, poolMode = useTalentPool) {
    setJobId(id)
    if (id === 'new') { setActiveJob(null); setCandidates([]); return }
    const job = clientJobs.find(j => j.id === id)
    setActiveJob(job)
    setLoadingJob(true)
    setCandidates([])

    try {
      let loaded
      if (poolMode) {
        const { data } = await supabase
          .from('job_matches')
          .select('*, talent_pool(*)')
          .eq('job_id', id)
          .order('match_score', { ascending: false, nullsFirst: false })
        loaded = (data ?? []).map(mapMatchToCandidate)
      } else {
        const { data } = await supabase.from('candidates').select('*').eq('job_id', id).order('match_score', { ascending: false }).limit(500)
        loaded = (data ?? []).map(c => ({ ...c, _status: c.match_score != null ? 'screened' : 'parsed' }))
      }

      setCandidates(loaded)

      // Load outreach log for this job
      const { data: outData } = await supabase.from('outreach_log').select('id, candidate_id, sent_at, responded').eq('job_id', id)
      const map = {}
      ;(outData ?? []).forEach(r => { map[r.candidate_id] = r })
      setOutreachLog(map)
    } finally {
      setLoadingJob(false)
    }
  }

  async function refreshCandidates() {
    if (!jobId || jobId === 'new') return
    await selectJob(jobId, useTalentPool)
  }

  async function runPoolMatch() {
    if (!activeJob) return
    setPoolMatchLoading(true)
    setPoolMatchProgress({ current: 0, total: 0 })
    addLog('Matching talent pool against job…', 'info')
    try {
      const passed = await triggerTalentPoolMatch(activeJob.id, {
        onProgress: (cur, total) => setPoolMatchProgress({ current: cur, total }),
        onLog: addLog,
      })
      addLog(`Match complete — ${passed} candidate${passed !== 1 ? 's' : ''} passed.`, 'ok')
      await selectJob(activeJob.id, true)
    } catch (err) {
      addLog(`✗ Match error: ${err.message}`, 'err')
    }
    setPoolMatchLoading(false)
  }

  async function moveToScreening(candidateId) {
    setMovingToScreening(prev => new Set([...prev, candidateId]))
    await supabase.from('candidates').update({ source: 'cv_upload' }).eq('id', candidateId)
    setCandidates(prev => prev.map(c => c.id === candidateId ? { ...c, source: 'cv_upload' } : c))
    setMovingToScreening(prev => { const n = new Set(prev); n.delete(candidateId); return n })
  }

  const addLog  = (msg, type = '') => setLog(p => [...p, { id: Date.now() + Math.random(), msg, type }])
  const tsLog   = (msg, type = '') => {
    const ts = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    addLog(`[${ts}] ${msg}`, type)
  }

  // ── Feature 1: Outreach ───────────────────────────────────────────────────
  async function openOutreachModal(candidate) {
    const companyName   = clients.find(c => c.id === clientId)?.company_name ?? ''
    const senderName    = profile?.full_name  || profile?.contact_name || ''
    const senderTitle   = profile?.job_title  || 'Recruiter'
    const senderPhone   = profile?.phone      || ''
    setOutreachModal({ candidate, email: candidate.email ?? '', emailContent: '', subject: '', generating: true, sending: false, sent: false, error: null })
    try {
      const prompt = `Write a professional, personalized recruiter outreach email to a candidate for the following:

Job: ${activeJob?.title ?? ''}
Company: ${companyName}
Candidate: ${candidate.full_name}, ${candidate.candidate_role}, ${candidate.total_years}y experience
Skills: ${(candidate.skills ?? []).join(', ')}
Summary: ${candidate.summary ?? ''}
Sender name: ${senderName || 'the recruiter'}
Sender title: ${senderTitle}${senderPhone ? `\nSender phone: ${senderPhone}` : ''}

Return the subject line first starting with "SUBJECT: ", then a blank line, then the email body (150-200 words). Be warm, specific to their background, and clear about next steps. Sign off with the sender's actual name and title — never use placeholder text like [Your Name].`

      const reply = await callClaude([{ role: 'user', content: prompt }], 'You are a professional recruiter writing personalized outreach emails.', 600)
      const lines = reply.trim().split('\n')
      const subjectLine = lines.find(l => l.startsWith('SUBJECT:'))
      const subject = subjectLine ? subjectLine.replace('SUBJECT:', '').trim() : `Exciting opportunity — ${activeJob?.title ?? 'new role'}`
      const body = lines.filter(l => !l.startsWith('SUBJECT:')).join('\n').trim()
      setOutreachModal(m => ({ ...m, subject, emailContent: body, generating: false }))
    } catch (err) {
      setOutreachModal(m => ({ ...m, generating: false, error: 'AI generation failed: ' + err.message }))
    }
  }

  async function sendOutreach() {
    const { candidate, email, subject, emailContent } = outreachModal
    if (!email.trim()) return
    setOutreachModal(m => ({ ...m, sending: true, error: null }))
    try {
      const { error } = await supabase.functions.invoke('send-outreach-email', {
        body: { to_email: email.trim(), to_name: candidate.full_name, subject, body: emailContent, job_title: activeJob?.title ?? '' },
      })
      if (error) throw new Error(error.message)

      // Log to outreach_log
      const { data: logRow } = await supabase.from('outreach_log').insert({
        candidate_id: candidate.id,
        job_id: activeJob?.id,
        subject,
        email_body: emailContent,
        sent_at: new Date().toISOString(),
        responded: false,
      }).select().single()

      setOutreachLog(m => ({ ...m, [candidate.id]: logRow }))
      setOutreachModal(m => ({ ...m, sending: false, sent: true }))
      addLog(`✉ Outreach sent to ${email.trim()}`, 'ok')
    } catch (err) {
      setOutreachModal(m => ({ ...m, sending: false, error: err.message }))
    }
  }

  async function toggleResponded(candidateId) {
    const existing = outreachLog[candidateId]
    if (!existing) return
    const next = !existing.responded
    await supabase.from('outreach_log').update({ responded: next }).eq('id', existing.id)
    setOutreachLog(m => ({ ...m, [candidateId]: { ...existing, responded: next } }))
  }

  // ── AI interview invite ────────────────────────────────────────────────────
  async function sendAiInterviewInvite() {
    const { candidate, email } = aiInviteModal
    if (!email.trim()) return
    setAiInviteModal(m => ({ ...m, sending: true, error: null }))

    let token = candidate.interview_invite_token
    if (!token) {
      token = crypto.randomUUID()
      const table = candidate._fromPool ? 'job_matches' : 'candidates'
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
      await supabase.from(table).update({ interview_invite_token: token, interview_token_expires_at: expiresAt }).eq('id', candidate.id)
      setCandidates(p => p.map(c => c.id === candidate.id ? { ...c, interview_invite_token: token, interview_token_expires_at: expiresAt } : c))
    }

    const companyName = clients.find(c => c.id === clientId)?.company_name ?? ''
    const { error } = await supabase.functions.invoke('send-ai-interview-invite', {
      body: { email: email.trim(), name: candidate.full_name, job_title: activeJob?.title ?? '', company_name: companyName, token },
    })
    if (error) {
      setAiInviteModal(m => ({ ...m, sending: false, error: error.message }))
    } else {
      setAiInviteModal(m => ({ ...m, sending: false, sent: true }))
      addLog(`✉ AI interview invite sent to ${email.trim()}`, 'ok')
      logAudit(supabase, { actorId: user?.id, actorRole: profile?.user_role ?? 'recruiter', action: 'interview_invited', entityType: 'candidate', entityId: candidate.id, jobId: activeJob?.id, metadata: { candidate_name: candidate.full_name, email: email.trim(), job_title: activeJob?.title } })
    }
  }

  // ── Feature 4: Schedule live interview with 3 time slots ─────────────────
  async function sendScheduleInvite() {
    const { candidate, email, slots } = scheduleModal
    const filledSlots = slots.filter(s => s.trim())
    if (!email.trim() || filledSlots.length === 0) return
    setScheduleModal(m => ({ ...m, sending: true, error: null }))

    const liveToken = candidate.live_interview_token ?? crypto.randomUUID()
    const roomUrl   = candidate.live_room_url ?? `https://meet.jit.si/oneselect-${liveToken}`

    const table = candidate._fromPool ? 'job_matches' : 'candidates'
    await supabase.from(table).update({
      live_interview_token: liveToken,
      live_room_url: roomUrl,
      live_interview_status: 'scheduled',
    }).eq('id', candidate.id)

    // Create interview_schedules record
    const { data: schedRow } = await supabase.from('interview_schedules').insert({
      candidate_id: candidate.id,
      job_id: activeJob?.id,
      proposed_slots: filledSlots,
      status: 'pending',
      candidate_email: email.trim(),
      candidate_name: candidate.full_name,
      room_url: roomUrl,
    }).select().single()

    const { error } = await supabase.functions.invoke('send-schedule-invite', {
      body: {
        mode: 'propose',
        token: schedRow?.confirm_token,
        proposed_slots: filledSlots,
        job_title: activeJob?.title ?? '',
        candidate_email: email.trim(),
        candidate_name: candidate.full_name,
        room_url: roomUrl,
      },
    })

    if (error) {
      setScheduleModal(m => ({ ...m, sending: false, error: error.message }))
    } else {
      setScheduleModal(m => ({ ...m, sending: false, sent: true }))
      addLog(`📅 Schedule invite sent to ${email.trim()}`, 'ok')
      await refreshCandidates()
    }
  }

  // ── Final decision ────────────────────────────────────────────────────────
  async function saveDecision(decision) {
    const { candidate, notes } = decisionModal
    const table = candidate._fromPool ? 'job_matches' : 'candidates'
    const updatePayload = { final_decision: decision, decision_notes: notes, decided_at: new Date().toISOString() }

    // DPDPA: remove raw CV text when candidate is no longer in consideration
    if (decision === 'rejected') updatePayload.raw_text = null

    await supabase.from(table).update(updatePayload).eq('id', candidate.id)
    setDecisionModal(null)
    addLog(`✓ Decision saved: ${candidate.full_name} → ${decision}`, 'ok')
    logAudit(supabase, { actorId: user?.id, actorRole: profile?.user_role ?? 'recruiter', action: `decision_${decision}`, entityType: 'candidate', entityId: candidate.id, jobId: activeJob?.id, metadata: { candidate_name: candidate.full_name, decision, notes } })
    await refreshCandidates()

    const { data: sessionData } = await supabase.auth.getSession() // fix: guard against null session destructure
    const session = sessionData?.session
    const authHeader = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` }

    if (decision === 'hired') {
      openOfferModal({ ...candidate, final_decision: 'hired' })
      // Notify candidate
      if (candidate.email) {
        fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/notify-candidate`, {
          method: 'POST', headers: authHeader,
          body: JSON.stringify({ type: 'hired', candidateEmail: candidate.email, candidateName: candidate.full_name, jobTitle: activeJob?.title }),
        }).catch(() => {})
      }
      // Fire client webhook
      if (activeJob?.id) {
        fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/trigger-webhook`, {
          method: 'POST', headers: authHeader,
          body: JSON.stringify({ jobId: activeJob.id, candidateId: candidate.id, candidateName: candidate.full_name, candidateEmail: candidate.email, jobTitle: activeJob.title, decision }),
        }).catch(() => {})
      }
    }

    if (decision === 'rejected' && candidate.email) {
      // Generate personalised AI feedback paragraph
      let feedbackNotes = notes || ''
      try {
        const feedbackReply = await callClaude([{ role: 'user', content:
          `Write one paragraph of specific, constructive, kind feedback for a candidate rejected for a ${activeJob?.title ?? 'position'} role.
Candidate: ${candidate.full_name}, ${candidate.total_years ?? 0}y experience, skills: ${(candidate.skills ?? []).slice(0, 6).join(', ')}.
Screening score: ${candidate.match_score ?? 'n/a'}/100. Screening reason: ${candidate.match_reason ?? 'n/a'}.
Be specific about why they weren't a fit this time and what might improve their chances elsewhere. 60-80 words. No platitudes.` }],
          'You write honest, specific, encouraging rejection feedback. No generic phrases.', 250)
        feedbackNotes = feedbackReply.trim() + (notes ? `\n\n${notes}` : '')
      } catch { /* feedback generation is best-effort */ }

      fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-rejection-email`, {
        method: 'POST', headers: authHeader,
        body: JSON.stringify({
          candidateName:  candidate.full_name,
          candidateEmail: candidate.email,
          jobTitle:       activeJob?.title,
          companyName:    clients.find(c => c.id === clientId)?.company_name,
          notes:          feedbackNotes,
        }),
      }).catch(() => {})
    }
  }

  async function markLiveComplete(candidate) {
    const table = candidate._fromPool ? 'job_matches' : 'candidates'
    await supabase.from(table).update({ live_interview_status: 'completed' }).eq('id', candidate.id)
    addLog(`✓ Live interview marked complete: ${candidate.full_name}`, 'ok')
    await refreshCandidates()
  }

  async function handleDeleteCandidate() {
    const { candidate } = deleteModal
    setDeleteModal(m => ({ ...m, deleting: true }))
    const table = candidate._fromPool ? 'job_matches' : 'candidates'
    const { error } = await supabase.from(table).delete().eq('id', candidate.id)
    if (error) { addLog(`✗ Delete failed: ${error.message}`, 'err'); setDeleteModal(null); return }
    setCandidates(p => p.filter(c => c.id !== candidate.id))
    addLog(`✓ Removed ${candidate.full_name} from pipeline`, 'ok')
    setDeleteModal(null)
  }

  async function saveNotes() {
    if (!notesModal) return
    setNotesModal(m => ({ ...m, saving: true }))
    const { candidate, text } = notesModal
    const table = candidate._fromPool ? 'job_matches' : 'candidates'
    await supabase.from(table).update({ recruiter_notes: text.trim() || null }).eq('id', candidate.id)
    setCandidates(p => p.map(c => c.id === candidate.id ? { ...c, recruiter_notes: text.trim() || null } : c))
    setNotesModal(null)
  }

  async function handleAddManually() {
    const f = addManuallyModal
    if (!f.full_name.trim()) return
    setAddManuallyModal(m => ({ ...m, saving: true, error: null }))
    try {
      const skillsArr = f.skills.split(',').map(s => s.trim()).filter(Boolean)
      const { data: saved, error } = await supabase.from('candidates').insert({
        job_id:         activeJob.id,
        full_name:      f.full_name.trim(),
        email:          f.email.trim(),
        phone:          f.phone.trim(),
        candidate_role: f.candidate_role.trim(),
        total_years:    parseInt(f.total_years) || 0,
        skills:         skillsArr,
        education:      f.education.trim(),
        summary:        f.summary.trim(),
        linkedin_url:   f.linkedin_url.trim() || null,
        github_url:     f.github_url.trim() || null,
        portfolio_url:  f.portfolio_url.trim() || null,
        source:         'manually_added',
      }).select().single()
      if (error) throw new Error(error.message)
      if (f.addToPool) {
        await supabase.from('talent_pool').insert({
          full_name:      f.full_name.trim(),
          email:          f.email.trim(),
          candidate_role: f.candidate_role.trim(),
          total_years:    parseInt(f.total_years) || 0,
          skills:         skillsArr,
          education:      f.education.trim(),
          summary:        f.summary.trim(),
          availability:   'available',
        })
      }
      setCandidates(p => [...p, { ...saved, _status: 'parsed' }])
      addLog(`✓ ${f.full_name.trim()} added manually`, 'ok')
      setAddManuallyModal(null)
    } catch (err) {
      setAddManuallyModal(m => ({ ...m, saving: false, error: err.message }))
    }
  }

  // ── Feature 5: Offer letter ────────────────────────────────────────────────
  async function openOfferModal(candidate) {
    const companyName = clients.find(c => c.id === clientId)?.company_name ?? ''
    setOfferModal({ candidate, letterContent: '', generating: true, sending: false, sent: false, error: null })
    try {
      const prompt = `Write a professional job offer letter for:
Candidate: ${candidate.full_name}
Role: ${activeJob?.title ?? ''}
Company: ${companyName}
Decision notes: ${candidate.decision_notes ?? 'N/A'}

Write a formal but warm offer letter (350-500 words) including: congratulations opening, role description, next steps (mention signing and returning this letter), and a professional closing. Return only the letter body.`

      const letter = await callClaude([{ role: 'user', content: prompt }], 'You are writing formal employment offer letters.', 1000)
      setOfferModal(m => ({ ...m, letterContent: letter.trim(), generating: false }))
    } catch (err) {
      setOfferModal(m => ({ ...m, generating: false, error: 'AI generation failed: ' + err.message }))
    }
  }

  async function sendOfferLetter() {
    const { candidate, letterContent } = offerModal
    if (!letterContent.trim()) return
    setOfferModal(m => ({ ...m, sending: true, error: null }))
    try {
      const { error } = await supabase.functions.invoke('send-offer-letter', {
        body: {
          candidate_email: candidate.email ?? '',
          candidate_name: candidate.full_name,
          job_title: activeJob?.title ?? '',
          letter_content: letterContent,
        },
      })
      if (error) throw new Error(error.message)

      // Log to offers table
      await supabase.from('offers').insert({
        candidate_id: candidate.id,
        job_id: activeJob?.id,
        letter_content: letterContent,
        sent_at: new Date().toISOString(),
        status: 'sent',
      })

      const table = candidate._fromPool ? 'job_matches' : 'candidates'
      await supabase.from(table).update({ offer_status: 'sent' }).eq('id', candidate.id)

      logAudit(supabase, {
        actorId:    user?.id,
        actorRole:  profile?.user_role ?? 'recruiter',
        action:     'offer_sent',
        entityType: 'candidate',
        entityId:   candidate.id,
        jobId:      activeJob?.id ?? null,
        metadata:   { candidate_name: candidate.full_name, candidate_email: candidate.email, job_title: activeJob?.title },
      })

      setOfferModal(m => ({ ...m, sending: false, sent: true }))
      addLog(`📄 Offer letter sent to ${candidate.email}`, 'ok')
      await refreshCandidates()
    } catch (err) {
      setOfferModal(m => ({ ...m, sending: false, error: err.message }))
    }
  }

  const setForm = (k, v) => setJobForm(f => ({ ...f, [k]: v }))
  const setTech = (v) => { setForm('tech_weight', v); setForm('comm_weight', 100 - v) }

  async function saveJob() {
    addLog(`Creating job: ${jobForm.title}…`, 'info')
    const { data, error } = await supabase.from('jobs').insert({
      recruiter_id: clientId,
      title: jobForm.title,
      experience_years: jobForm.experience_years,
      required_skills: jobForm.required_skills,
      preferred_skills: jobForm.preferred_skills,
      description: jobForm.description,
      tech_weight: jobForm.tech_weight,
      comm_weight: jobForm.comm_weight,
      status: 'active',
    }).select().single()
    if (error) { addLog(`Error: ${error.message}`, 'err'); return }
    addLog(`✓ Job saved (${data.id})`, 'ok')
    setActiveJob(data)
    setClientJobs(p => [data, ...p])
    setJobId(data.id)
  }

  const addFiles = useCallback((incoming) => {
    const valid = Array.from(incoming).filter(isSupported)
    if (!valid.length) return
    setFiles(p => [...p, ...valid.filter(f => !p.some(e => e.file.name === f.name))
      .map(f => ({ id: crypto.randomUUID(), file: f, ext: fileExt(f), status: 'pending', parsed: null, error: '' }))])
  }, [])

  const onDrop = useCallback((e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files) }, [addFiles])
  function patchFile(id, updates) { setFiles(p => p.map(f => f.id === id ? { ...f, ...updates } : f)) }

  async function runFullPipeline() {
    if (!activeJob || !files.filter(f => f.status === 'pending').length) return
    setPipelineRunning(true)
    setPipelinePaused(false)
    runnerStart(activeJob.id)
    setLog([])

    let stopped = false

    try {
    // Mark job as processing
    await supabase.from('jobs').update({ pipeline_status: 'processing' }).eq('id', activeJob.id)

    tsLog('Pipeline started — parsing CVs…', 'info')
    const parsedCandidates = []

    // ── Phase 1: Parse ────────────────────────────────────────────────────
    for (const entry of files.filter(f => f.status === 'pending')) {
      if (await awaitResume()) { tsLog('▣ Pipeline stopped.', 'err'); stopped = true; break }
      patchFile(entry.id, { status: 'parsing' })
      tsLog(`Parsing ${entry.file.name}…`, 'info')
      try {
        let content
        if (entry.ext === 'docx') {
          const arrayBuffer = await entry.file.arrayBuffer()
          const result = await mammoth.extractRawText({ arrayBuffer })
          if (!result.value?.trim()) throw new Error('No text extracted from DOCX')
          content = { kind: 'text', text: result.value }
        } else {
          content = await extractContent(entry.file)
        }
        const msgs = content.kind === 'image'
          ? [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: content.mediaType, data: content.base64 } }, { type: 'text', text: 'Parse this CV image.' }] }]
          : [{ role: 'user', content: `Parse this CV:\n\n${content.text}` }]
        const reply = await callClaude(msgs, CV_PARSE_SYSTEM, 1024)
        const parsed = JSON.parse(reply.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''))

        // Duplicate check — same email already exists for this job
        if (parsed.email) {
          const { data: dup } = await supabase.from('candidates').select('id, full_name').eq('job_id', activeJob.id).ilike('email', parsed.email).maybeSingle()
          if (dup) { tsLog(`⚠ Skipped ${entry.file.name} — ${dup.full_name} already exists for this job`, 'err'); patchFile(entry.id, { status: 'error', error: `Duplicate — ${dup.full_name} already exists` }); continue }
        }

        const { data: saved, error } = await supabase.from('candidates').insert({
          job_id:        activeJob.id,
          full_name:     parsed.name,
          email:         parsed.email ?? '',
          candidate_role:parsed.currentRole ?? '',
          total_years:   parseExperience(parsed.totalYears) ?? 0,
          skills:        parsed.skills ?? [],
          education:     parsed.education ?? '',
          summary:       parsed.summary ?? '',
          highlights:    parsed.highlights ?? [],
          raw_text:      content.kind === 'text' ? content.text : '',
          linkedin_url:  parsed.linkedinUrl ?? null,
          github_url:    parsed.githubUrl ?? null,
          portfolio_url: parsed.portfolioUrl ?? null,
        }).select().single()

        if (error) throw new Error(error.message)
        tsLog(`✓ ${parsed.name} — CV parsed`, 'ok')
        patchFile(entry.id, { status: 'done', parsed })
        const candidate = { ...saved, _status: 'parsed' }
        parsedCandidates.push(candidate)
        setCandidates(p => [...p, candidate])
      } catch (err) {
        tsLog(`✗ ${entry.file.name}: ${err.message}`, 'err')
        patchFile(entry.id, { status: 'error', error: err.message })
      }
    }

    // ── Phase 2: Screen ───────────────────────────────────────────────────
    tsLog(`Screening ${parsedCandidates.length} candidate${parsedCandidates.length !== 1 ? 's' : ''}…`, 'info')
    const system = screeningSystem(activeJob)
    const passedCandidates = []

    for (const c of parsedCandidates) {
      if (await awaitResume()) { tsLog('▣ Pipeline stopped.', 'err'); stopped = true; break }
      setCandidates(p => p.map(x => x.id === c.id ? { ...x, _status: 'screening' } : x))
      tsLog(`Screening ${c.full_name}…`, 'info')
      try {
        const msg = `Name: ${c.full_name}\nRole: ${c.candidate_role}\nYears: ${c.total_years}\nSkills: ${(c.skills ?? []).join(', ')}\nSummary: ${c.summary}`
        const reply = await callClaude([{ role: 'user', content: msg }], system, 512)
        const s = JSON.parse(reply.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''))
        await supabase.from('candidates').update({ match_score: s.matchScore, match_pass: s.pass, match_reason: s.reason, match_rank: s.rank, screened_at: new Date().toISOString(), stage_entered_at: new Date().toISOString() }).eq('id', c.id)
        const updated = { ...c, _status: 'screened', match_score: s.matchScore, match_pass: s.pass, match_reason: s.reason, match_rank: s.rank }
        setCandidates(p => p.map(x => x.id === c.id ? updated : x))
        if (s.pass) {
          passedCandidates.push(updated)
          // Notify shortlisted candidates who applied via the public jobs page
          if (c.email) {
            supabase.functions.invoke('notify-candidate', {
              body: { type: 'shortlisted', candidateEmail: c.email, candidateName: c.full_name, jobTitle: activeJob.title },
            }).catch(() => {})
          }
        }
        tsLog(`✓ ${c.full_name}: ${s.matchScore}/100 → ${s.pass ? 'PASS ✓' : 'FAIL'}`, s.pass ? 'ok' : '')
      } catch (err) {
        tsLog(`✗ ${c.full_name} screen error: ${err.message}`, 'err')
        setCandidates(p => p.map(x => x.id === c.id ? { ...x, _status: 'screened', match_score: 0, match_pass: false } : x))
      }
    }

    // ── Phase 2.5: Real async assessments ────────────────────────────────
    if (assessmentEnabled && passedCandidates.length > 0 && !stopped) {
      tsLog(`Generating assessment questions for ${activeJob.title}…`, 'info')
      try {
        const { questions } = await generateAssessment(activeJob.title, activeJob.required_skills ?? [], callClaude)
        tsLog(`✓ ${questions.length} questions generated — sending to candidates`, 'ok')
        for (const c of passedCandidates) {
          if (await awaitResume()) { tsLog('▣ Pipeline stopped.', 'err'); stopped = true; break }
          if (!c.email) { tsLog(`⚠ No email for ${c.full_name} — skipping assessment`, 'err'); continue }
          try {
            const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString()
            const { data: tokenRow, error: tokenErr } = await supabase.from('assessment_tokens').insert({
              candidate_id: c.id, job_id: activeJob.id, questions, expires_at: expiresAt,
            }).select('token').single()
            if (tokenErr) throw new Error(tokenErr.message)
            const assessmentUrl = `${appUrl}/assessment/${tokenRow.token}`
            await supabase.functions.invoke('send-assessment-invite', {
              body: { email: c.email, name: c.full_name, jobTitle: activeJob.title, assessmentUrl },
            })
            tsLog(`✉ Assessment sent to ${c.full_name}`, 'ok')
          } catch (err) {
            tsLog(`⚠ Assessment invite failed for ${c.full_name}: ${err.message}`, 'err')
          }
        }
      } catch (err) {
        tsLog(`⚠ Assessment generation failed: ${err.message}`, 'err')
      }
    }

    // ── Client approval gate — pause for shortlist review ─────────────────
    if (!stopped) {
      await supabase.from('jobs').update({ pipeline_status: 'pending_client_approval' }).eq('id', activeJob.id)
      const msg = assessmentEnabled
        ? `Screening + assessments complete — ${passedCandidates.length} passed. Review shortlist in Client portal, then run interviews.`
        : `Screening complete — ${passedCandidates.length} candidate${passedCandidates.length !== 1 ? 's' : ''} passed. Review shortlist in Client portal, then run interviews.`
      tsLog(msg, 'ok')
      stopped = true

      // Email client so they don't need to be logged in to know the shortlist is ready
      const clientProfile = clients.find(c => c.id === clientId)
      if (clientProfile?.email && passedCandidates.length > 0) {
        supabase.functions.invoke('notify-client-shortlist', {
          body: {
            clientEmail:    clientProfile.email,
            clientName:     clientProfile.full_name || clientProfile.company_name || null,
            jobTitle:       activeJob.title,
            candidateCount: passedCandidates.length,
          },
        }).catch(() => {})
      }

      await refreshCandidates()
    }

    // ── Phase 3: Run via "Run Interviews →" button (runInterviewsPhase) ───
    if (!stopped) {
      for (const c of passedCandidates) {
        if (await awaitResume()) { tsLog('▣ Pipeline stopped.', 'err'); stopped = true; break }
        tsLog(`Interviewing ${c.full_name}…`, 'info')
        try {
          const result = await runAutomatedInterview(c, activeJob)
          await supabase.from('candidates').update({
            interview_transcript: result.transcript,
            scores: result.scores,
            stage_entered_at: new Date().toISOString(),
          }).eq('id', c.id)
          setCandidates(p => p.map(x => x.id === c.id ? { ...x, interview_transcript: result.transcript, scores: result.scores } : x))
          tsLog(`✓ ${c.full_name}: ${result.scores.overallScore}/100 — ${result.scores.recommendation}`, 'ok')
        } catch (err) {
          tsLog(`✗ ${c.full_name} interview error: ${err.message}`, 'err')
        }
      }
    }

    // ── Phase 4: Mark complete + notify client ─────────────────────────────
    if (!stopped) {
      await supabase.from('jobs').update({ pipeline_status: 'complete' }).eq('id', activeJob.id)
      tsLog(`Pipeline complete — ${parsedCandidates.length} processed, ${passedCandidates.length} passed`, 'ok')

      const clientProfile = clients.find(c => c.id === clientId)
      if (clientProfile?.email) {
        try {
          const topCandidates = [...passedCandidates]
            .sort((a, b) => (b.scores?.overallScore ?? 0) - (a.scores?.overallScore ?? 0))
            .slice(0, 3)
            .map(c => ({
              name:           c.full_name,
              role:           c.candidate_role,
              overallScore:   c.scores?.overallScore ?? 0,
              recommendation: c.scores?.recommendation ?? '',
              matchScore:     c.match_score ?? 0,
            }))

          const { error: emailErr } = await supabase.functions.invoke('send-pipeline-complete', {
            body: {
              clientEmail:     clientProfile.email,
              clientName:      clientProfile.full_name || clientProfile.company_name,
              jobTitle:        activeJob.title,
              totalProcessed:  parsedCandidates.length,
              totalPassed:     passedCandidates.length,
              topCandidates,
            },
          })
          if (emailErr) throw new Error(emailErr.message)
          await supabase.from('jobs').update({ pipeline_status: 'notified' }).eq('id', activeJob.id)
          tsLog(`✉ Client notified — ${clientProfile.email}`, 'ok')
        } catch (err) {
          tsLog(`⚠ Email notification failed: ${err.message}`, 'err')
        }
      }

      await refreshCandidates()
    }

    } finally {
      runnerComplete()
      setPipelineRunning(false)
      setPipelinePaused(false)
    }
  }

  // ── Run interviews for approved shortlist (Phase 3 + 4) ─────────────────
  async function runInterviewsPhase() {
    if (!activeJob || pipelineRunning) return
    setPipelineRunning(true)
    setPipelinePaused(false)
    runnerStart(activeJob.id)
    setLog([])
    let stopped = false
    try {
      await supabase.from('jobs').update({ pipeline_status: 'processing' }).eq('id', activeJob.id)

      const { data: allPassed } = await supabase.from('candidates').select('*').eq('job_id', activeJob.id).eq('match_pass', true)
      const pool = allPassed ?? []
      const hasExplicit = pool.some(c => c.client_approved === true)
      const toInterview = hasExplicit ? pool.filter(c => c.client_approved === true) : pool

      tsLog(`Running interviews for ${toInterview.length} candidate${toInterview.length !== 1 ? 's' : ''}${hasExplicit ? ' (client-approved)' : ''}…`, 'info')

      for (const c of toInterview) {
        if (await awaitResume()) { tsLog('▣ Pipeline stopped.', 'err'); stopped = true; break }
        tsLog(`Interviewing ${c.full_name}…`, 'info')
        try {
          const result = await runAutomatedInterview(c, activeJob)
          await supabase.from('candidates').update({
            interview_transcript: result.transcript,
            scores: result.scores,
            interviewed_at: new Date().toISOString(),
          }).eq('id', c.id)
          setCandidates(p => p.map(x => x.id === c.id ? { ...x, interview_transcript: result.transcript, scores: result.scores } : x))
          tsLog(`✓ ${c.full_name}: ${result.scores.overallScore}/100 — ${result.scores.recommendation}`, 'ok')
        } catch (err) {
          tsLog(`✗ ${c.full_name} interview error: ${err.message}`, 'err')
        }
      }

      if (!stopped) {
        await supabase.from('jobs').update({ pipeline_status: 'complete' }).eq('id', activeJob.id)
        tsLog(`Interviews complete — ${toInterview.length} processed`, 'ok')

        const clientProfile = clients.find(c => c.id === clientId)
        if (clientProfile?.email) {
          try {
            const topCandidates = [...toInterview]
              .sort((a, b) => (b.scores?.overallScore ?? 0) - (a.scores?.overallScore ?? 0))
              .slice(0, 3)
              .map(c => ({ name: c.full_name, role: c.candidate_role, overallScore: c.scores?.overallScore ?? 0, recommendation: c.scores?.recommendation ?? '', matchScore: c.match_score ?? 0 }))
            const { error: emailErr } = await supabase.functions.invoke('send-pipeline-complete', {
              body: { clientEmail: clientProfile.email, clientName: clientProfile.full_name || clientProfile.company_name, jobTitle: activeJob.title, totalProcessed: toInterview.length, totalPassed: toInterview.length, topCandidates },
            })
            if (emailErr) throw new Error(emailErr.message)
            await supabase.from('jobs').update({ pipeline_status: 'notified' }).eq('id', activeJob.id)
            tsLog(`✉ Client notified — ${clientProfile.email}`, 'ok')
          } catch (err) {
            tsLog(`⚠ Email notification failed: ${err.message}`, 'err')
          }
        }

        // In-app notification for client
        if (clientId) {
          supabase.from('notifications').insert({
            recipient_id: clientId,
            type: 'pipeline_complete',
            title: `Pipeline complete — ${activeJob.title}`,
            body: `${toInterview.length} candidate${toInterview.length !== 1 ? 's' : ''} interviewed. Review results in Candidates.`,
            link: '/client/candidates',
          }).catch(() => {})
        }

        await refreshCandidates()
      }
    } finally {
      runnerComplete()
      setPipelineRunning(false)
      setPipelinePaused(false)
    }
  }

  // ── Score submitted real assessments ────────────────────────────────────
  const [scoringAssessments, setScoringAssessments] = useState(false)

  async function scoreAssessmentSubmissions() {
    if (!activeJob) return
    setScoringAssessments(true)
    tsLog('Fetching submitted assessments…', 'info')
    try {
      const { data: tokens } = await supabase
        .from('assessment_tokens')
        .select('*, candidates(id, full_name)')
        .eq('job_id', activeJob.id)
        .not('submitted_at', 'is', null)
        .eq('scored', false)

      if (!tokens?.length) { tsLog('No unscored submissions found.', 'info'); setScoringAssessments(false); return }
      tsLog(`Scoring ${tokens.length} submission${tokens.length !== 1 ? 's' : ''}…`, 'info')

      for (const t of tokens) {
        const name = t.candidates?.full_name ?? 'Candidate'
        try {
          const scored = await scoreAssessment(t.questions, t.answers, activeJob.title, callClaude)
          if (scored) {
            await supabase.from('candidates').update({
              assessment_score: scored.overallScore,
              assessment_data: { questions: t.questions, answers: t.answers, scores: scored.scores, summary: scored.summary },
            }).eq('id', t.candidate_id)
            await supabase.from('assessment_tokens').update({ scored: true }).eq('id', t.id)
            tsLog(`✓ ${name}: assessment ${scored.overallScore}/100`, 'ok')
          }
        } catch (err) {
          tsLog(`⚠ Scoring failed for ${name}: ${err.message}`, 'err')
        }
      }
      tsLog('Assessment scoring complete.', 'ok')
      await refreshCandidates()
    } catch (err) {
      tsLog(`⚠ Error fetching submissions: ${err.message}`, 'err')
    } finally {
      setScoringAssessments(false)
    }
  }

  // ── Derived state ─────────────────────────────────────────────────────────
  const [candidateSearch, setCandidateSearch] = useState('')
  function srch(list) {
    if (!candidateSearch.trim()) return list
    const words = candidateSearch.toLowerCase().split(/\s+/)
    return list.filter(c => {
      const hay = [c.full_name, c.candidate_role, c.email, c.summary, ...(c.skills ?? [])].join(' ').toLowerCase()
      return words.every(w => hay.includes(w))
    })
  }
  const sourcedCandidates  = candidates.filter(c => c.source === 'linkedin')
  const pipelineCandidates = candidates.filter(c => c.source !== 'linkedin')
  const passedCandidates = pipelineCandidates.filter(c => c.match_pass)
  const doneCount      = files.filter(f => f.status === 'done').length
  const pendingCount   = files.filter(f => f.status === 'pending').length
  const screenedCount  = pipelineCandidates.filter(c => c._status === 'screened').length
  const parseProgress  = files.length ? (doneCount / files.length) * 100 : 0
  const screenProgress = pipelineCandidates.length ? (screenedCount / pipelineCandidates.length) * 100 : 0
  const liveInterviewCandidates = passedCandidates.filter(c => c.scores?.overallScore != null)
  const decisionCandidates      = passedCandidates.filter(c => c.live_interview_status === 'completed')
  const clientLabel = (c) => c.company_name || c.full_name || c.email

  function outreachBadge(cId) {
    const o = outreachLog[cId]
    if (!o) return null
    if (o.responded) return <span className="badge badge-green" style={{ fontSize: 9 }}>Responded</span>
    return <span className="badge badge-blue" style={{ fontSize: 9 }}>Outreach Sent</span>
  }

  return (
    <div className="page">
      <div className="page-head">
        <div><h2>Pipeline</h2><p>Run the full AI hiring pipeline for a client</p></div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {candidates.length > 0 && (
            <input
              type="search"
              placeholder="Filter candidates…"
              value={candidateSearch}
              onChange={e => setCandidateSearch(e.target.value)}
              style={{ width: 220, padding: '7px 12px', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 12, fontFamily: 'var(--font-body)' }}
            />
          )}
          {(clientId || candidates.length > 0) && (
            <button
              onClick={clearPipeline}
              style={{ border: '1px solid var(--accent)', color: 'var(--accent)', background: 'none', borderRadius: 'var(--r)', padding: '6px 14px', fontSize: 12, cursor: 'pointer', fontFamily: 'var(--font-body)', whiteSpace: 'nowrap' }}
            >
              Clear &amp; Start Over
            </button>
          )}
        </div>
      </div>

      {/* ── 1 Job Setup ── */}
      <div className="section-card">
        <div className="section-card-head"><h3>1 · Job Setup</h3></div>
        <div className="section-card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="form-grid">
            {!isClient && (
              <div className="field">
                <label>Select Client</label>
                <select value={clientId} onChange={e => setClientId(e.target.value)}>
                  <option value="">— choose client —</option>
                  {clients.map(c => <option key={c.id} value={c.id}>{clientLabel(c)}</option>)}
                </select>
              </div>
            )}
            <div className="field">
              <label>Select Job</label>
              <select value={jobId} disabled={!clientId} onChange={e => selectJob(e.target.value)}>
                <option value="">— choose job —</option>
                {!isClient && <option value="new">+ Create new job</option>}
                {clientJobs.map(j => <option key={j.id} value={j.id}>{j.title}</option>)}
              </select>
            </div>
          </div>

          {jobId === 'new' && !isClient && (
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
              <div className="form-grid">
                <div className="field"><label>Job Title</label><input type="text" value={jobForm.title} placeholder="e.g. Senior Backend Engineer" onChange={e => setForm('title', e.target.value)} /></div>
                <div className="field"><label>Years of Experience</label><input type="number" min={0} value={jobForm.experience_years} onChange={e => setForm('experience_years', +e.target.value)} /></div>
                <div className="field span-2"><label>Required Skills</label><TagInput value={jobForm.required_skills} onChange={v => setForm('required_skills', v)} placeholder="Type and press Enter…" /></div>
                <div className="field span-2"><label>Preferred Skills</label><TagInput value={jobForm.preferred_skills} onChange={v => setForm('preferred_skills', v)} placeholder="Nice-to-have…" /></div>
                <div className="field span-2"><label>Description</label><textarea rows={4} value={jobForm.description} onChange={e => setForm('description', e.target.value)} placeholder="Role responsibilities and context…" /></div>
                <div className="field span-2">
                  <label>Evaluation Weights</label>
                  <div className="weight-sliders">
                    <div className="weight-row"><span>Technical</span><input type="range" min={10} max={90} value={jobForm.tech_weight} onChange={e => setTech(+e.target.value)} /><span className="weight-val">{jobForm.tech_weight}%</span></div>
                    <div className="weight-row"><span>Communication</span><input type="range" min={10} max={90} value={jobForm.comm_weight} onChange={e => { setForm('comm_weight', +e.target.value); setForm('tech_weight', 100 - +e.target.value) }} /><span className="weight-val">{jobForm.comm_weight}%</span></div>
                  </div>
                </div>
              </div>
              <div className="form-actions">
                <button className="btn btn-primary" disabled={!jobForm.title.trim() || !clientId} onClick={saveJob}>Save Job</button>
              </div>
            </div>
          )}

          {activeJob && (
            <div style={{ padding: '10px 14px', background: 'var(--green-d)', borderLeft: '2px solid var(--green)', fontSize: 13, color: 'var(--green)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>✓ Active job: <strong>{activeJob.title}</strong></span>
              {!isClient && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', color: assessmentEnabled ? 'var(--green)' : 'var(--text-3)', fontSize: 12, fontFamily: 'var(--font-mono)' }}>
                  <input type="checkbox" checked={assessmentEnabled} onChange={async e => {
                    const v = e.target.checked
                    setAssessmentEnabled(v)
                    await supabase.from('jobs').update({ assessment_enabled: v }).eq('id', activeJob.id)
                  }} />
                  Include Assessment Step
                </label>
              )}
            </div>
          )}
          {activeJob?.pipeline_status === 'pending_client_approval' && (
            <div style={{ padding: '10px 14px', background: 'rgba(184,146,74,0.07)', borderLeft: '2px solid var(--accent)', fontSize: 13, color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>⏸ Awaiting client shortlist approval — client can Approve/Reject candidates in their portal.</span>
              {!pipelineRunning && (
                <button
                  className="btn btn-primary"
                  style={{ fontSize: 12, padding: '4px 12px', background: 'var(--green)', borderColor: 'var(--green)', whiteSpace: 'nowrap' }}
                  onClick={runInterviewsPhase}
                >▶ Run Interviews →</button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Loading indicator ── */}
      {loadingJob && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '32px 0', color: 'var(--text-3)', fontSize: 13, fontFamily: 'var(--font-mono)' }}>
          <span className="spinner" style={{ width: 16, height: 16 }} />
          Loading pipeline…
        </div>
      )}

      {/* ── LinkedIn Sourced ── */}
      {!loadingJob && activeJob && (
        <div className="section-card">
          <div className="section-card-head">
            <h3>Sourced · LinkedIn</h3>
            <span className="mono text-muted" style={{ fontSize: 11 }}>{sourcedCandidates.length} profile{sourcedCandidates.length !== 1 ? 's' : ''}</span>
          </div>
          {sourcedCandidates.length === 0 ? (
            <div className="empty-state" style={{ color: 'var(--text-3)', fontSize: 13 }}>
              Sourcing in progress… LinkedIn profiles will appear here shortly.
            </div>
          ) : (
            <div className="candidate-list">
              {sourcedCandidates.map(c => {
                const ld       = c.linkedin_data ?? {}
                const skills   = (c.skills ?? []).slice(0, 5)
                const moving   = movingToScreening.has(c.id)
                const headline = ld.headline ?? c.candidate_role ?? ''
                const company  = (ld.experience?.[0]?.company) ?? ''
                const location = ld.location ?? c.location ?? 'India'
                const education = c.education ?? ''
                return (
                  <div key={c.id} className="candidate-row" style={{ cursor: 'default', alignItems: 'flex-start', gap: 12 }}>
                    <div className="c-info" style={{ flex: 1 }}>
                      <div className="c-name" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        {c.full_name}
                        <span className="badge badge-blue" style={{ fontSize: 9 }}>LinkedIn</span>
                        {ld.match_score != null && (
                          <span style={{ fontSize: 10, padding: '1px 6px', background: 'var(--accent)', color: '#fff', borderRadius: 'var(--r)', fontWeight: 600 }}>
                            {ld.match_score}/10
                          </span>
                        )}
                      </div>
                      <div className="c-meta" style={{ marginTop: 2 }}>
                        {headline}{company ? ` · ${company}` : ''}
                      </div>
                      {ld.match_reason && (
                        <div style={{ fontSize: 11, color: 'var(--text-2)', marginTop: 2, fontStyle: 'italic' }}>{ld.match_reason}</div>
                      )}
                      {location && (
                        <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{location}</div>
                      )}
                      {skills.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                          {skills.map(sk => (
                            <span key={sk} style={{ fontSize: 10, padding: '2px 6px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r)', color: 'var(--text-3)' }}>{sk}</span>
                          ))}
                        </div>
                      )}
                      {education && (
                        <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>{education}</div>
                      )}
                    </div>
                    <div className="c-score" style={{ flexShrink: 0, gap: 6, flexDirection: 'column', alignItems: 'flex-end' }}>
                      {c.linkedin_url && (
                        <a
                          href={c.linkedin_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn btn-secondary"
                          style={{ fontSize: 10, padding: '3px 8px', textDecoration: 'none', color: 'var(--text-2)' }}
                        >↗ View Profile</a>
                      )}
                      {!isClient && (
                        <button
                          className="btn btn-primary"
                          style={{ fontSize: 10, padding: '3px 10px' }}
                          disabled={moving}
                          onClick={() => moveToScreening(c.id)}
                        >{moving ? 'Moving…' : '→ Screen'}</button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ── 2 CV Upload — hidden for clients ── */}
      {!loadingJob && activeJob && !isClient && (
        <div className="section-card">
          <div className="section-card-head">
            <h3>{useTalentPool ? '2 · Talent Pool' : '2 · CV Upload'}</h3>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span className="mono text-muted" style={{ fontSize: 11 }}>{pipelineCandidates.length} candidates</span>
              {!useTalentPool && (
                <button
                  className="btn btn-secondary"
                  style={{ fontSize: 11, padding: '4px 10px' }}
                  onClick={() => setAddManuallyModal({ ...EMPTY_MANUAL, saving: false, error: null })}
                >
                  + Add Manually
                </button>
              )}
              <button
                className={`btn ${useTalentPool ? 'btn-primary' : 'btn-secondary'}`}
                style={{ fontSize: 11, padding: '4px 10px' }}
                onClick={() => { const next = !useTalentPool; setUseTalentPool(next); if (jobId && jobId !== 'new') selectJob(jobId, next) }}
              >
                {useTalentPool ? '◎ Pool mode' : '◎ Use Talent Pool'}
              </button>
            </div>
          </div>
          <div className="section-card-body">
            {useTalentPool ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <p style={{ fontSize: 13, color: 'var(--text-2)', margin: 0 }}>Match all available talent pool candidates against this job using AI screening.</p>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <button className="btn btn-primary" disabled={poolMatchLoading} onClick={runPoolMatch}>
                    {poolMatchLoading ? <><span className="spinner" style={{ width: 12, height: 12 }} />{poolMatchProgress.total > 0 ? ` ${poolMatchProgress.current}/${poolMatchProgress.total}` : ' Matching…'}</> : 'Run Pool Match'}
                  </button>
                  {poolMatchLoading && poolMatchProgress.total > 0 && (
                    <div style={{ flex: 1 }}><div className="progress-track"><div className="progress-fill" style={{ width: `${(poolMatchProgress.current / poolMatchProgress.total) * 100}%` }} /></div></div>
                  )}
                </div>
                {passedCandidates.length > 0 && (
                  <div>
                    <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--green)', marginBottom: 8 }}>
                      ✓ {passedCandidates.length} candidate{passedCandidates.length !== 1 ? 's' : ''} passed screening
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {passedCandidates.slice(0, 5).map(c => (
                        <div key={c.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--r)' }}>
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 500 }}>{c.full_name}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{c.candidate_role} · Score {c.match_score}</div>
                          </div>
                          {!c.scores?.overallScore && (
                            <button
                              className="btn btn-primary"
                              style={{ fontSize: 10, padding: '3px 10px', whiteSpace: 'nowrap' }}
                              onClick={() => setAiInviteModal({ candidate: c, email: c.email ?? '', sending: false, sent: false, error: null })}
                            >
                              → AI Interview
                            </button>
                          )}
                          {c.scores?.overallScore && (
                            <span className="badge badge-green" style={{ fontSize: 10 }}>Interviewed</span>
                          )}
                        </div>
                      ))}
                      {passedCandidates.length > 5 && (
                        <div style={{ fontSize: 11, color: 'var(--text-3)', textAlign: 'center', padding: '4px 0' }}>
                          +{passedCandidates.length - 5} more — see section 4 below
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <>
                <div
                  className={`drop-zone${dragging ? ' drag-over' : ''}`}
                  onDrop={onDrop}
                  onDragOver={e => { e.preventDefault(); setDragging(true) }}
                  onDragLeave={() => setDragging(false)}
                  onClick={() => fileInputRef.current.click()}
                >
                  <div className="drop-icon">⬆</div>
                  <p>Drop CVs or <span className="link">browse</span></p>
                  <div className="format-pills">{['PDF','DOCX','TXT','JPG','PNG'].map(f => <span key={f} className="format-pill">{f}</span>)}</div>
                  <input ref={fileInputRef} type="file" accept={ACCEPT_ATTR} multiple style={{ display: 'none' }} onChange={e => { addFiles(e.target.files); e.target.value = '' }} />
                </div>
                {files.length > 0 && (
                  <div className="file-list">
                    <div className="file-list-header">
                      <span>{files.length} file{files.length !== 1 ? 's' : ''}</span>
                      {pipelineRunning && <div style={{ flex: 1 }}><div className="progress-track"><div className="progress-fill" style={{ width: `${parseProgress}%` }} /></div></div>}
                      {pipelineRunning && (
                        <>
                          {pipelinePaused
                            ? <button onClick={runnerResume} style={{ padding: '5px 12px', fontSize: 12, background: 'var(--green)', color: '#fff', border: 'none', borderRadius: 'var(--r)', cursor: 'pointer', fontFamily: 'var(--font-body)' }}>▶ Resume</button>
                            : <button onClick={runnerPause}  style={{ padding: '5px 12px', fontSize: 12, background: 'var(--amber)', color: '#fff', border: 'none', borderRadius: 'var(--r)', cursor: 'pointer', fontFamily: 'var(--font-body)' }}>⏸ Pause</button>
                          }
                          <button onClick={runnerStop} style={{ padding: '5px 12px', fontSize: 12, background: 'var(--red)', color: '#fff', border: 'none', borderRadius: 'var(--r)', cursor: 'pointer', fontFamily: 'var(--font-body)' }}>◼ Stop</button>
                        </>
                      )}
                      <button className="btn btn-primary" style={{ padding: '5px 12px', fontSize: 12 }} disabled={!pendingCount || pipelineRunning || !activeJob} onClick={runFullPipeline}>
                        {pipelineRunning ? <><span className="spinner" style={{ width: 11, height: 11 }} />{pipelinePaused ? ' Paused…' : ' Running Pipeline…'}</> : '▶ Upload & Run Full Pipeline'}
                      </button>
                      {activeJob?.pipeline_status === 'pending_client_approval' && !pipelineRunning && (
                        <button
                          className="btn btn-primary"
                          style={{ padding: '5px 12px', fontSize: 12, background: 'var(--green)', borderColor: 'var(--green)', whiteSpace: 'nowrap' }}
                          onClick={runInterviewsPhase}
                        >
                          ▶ Run Interviews →
                        </button>
                      )}
                    </div>
                    {files.map(f => (
                      <div key={f.id} className="file-row">
                        <div className="file-info">
                          <span className="file-icon">{FORMAT_ICON[f.ext] ?? '📄'}</span>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                              <span className="file-name">{f.file.name}</span>
                              <span className={`badge ${f.ext === 'pdf' ? 'badge-red' : f.ext === 'docx' ? 'badge-blue' : 'badge-amber'}`} style={{ fontSize: 9 }}>{f.ext?.toUpperCase()}</span>
                            </div>
                            {f.parsed && <div className="file-parsed"><strong>{f.parsed.name}</strong> · {f.parsed.currentRole}</div>}
                            {f.status === 'error' && <div className="error-text">⚠ {f.error}</div>}
                          </div>
                        </div>
                        <div className="file-status">
                          {f.status === 'pending' && <span className="badge badge-amber">Pending</span>}
                          {f.status === 'parsing' && <span className="spinner" />}
                          {f.status === 'done'    && <span className="badge badge-green">CV Parsed</span>}
                          {f.status === 'error'   && <span className="badge badge-red">Error</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* ── 3 AI Screening — hidden for clients ── */}
      {!loadingJob && activeJob && pipelineCandidates.length > 0 && !isClient && (
        <div className="section-card">
          <div className="section-card-head">
            <h3>3 · AI Screening</h3>
            {pipelineRunning && screenedCount < pipelineCandidates.length && (
              <div style={{ flex: 1, margin: '0 16px' }}><div className="progress-track"><div className="progress-fill" style={{ width: `${screenProgress}%` }} /></div></div>
            )}
            <span className="mono text-muted" style={{ fontSize: 11 }}>{screenedCount}/{pipelineCandidates.length} screened</span>
          </div>
          <div className="candidate-list">
            {srch([...pipelineCandidates].sort((a, b) => (b.match_score ?? -1) - (a.match_score ?? -1))).map((c, i) => (
              <div key={c.id} className={`candidate-row${c.match_pass === false ? ' dimmed' : ''}`} style={{ cursor: 'default' }}>
                <div className="c-rank">#{i + 1}</div>
                <div className="c-info">
                  <div className="c-name">{c.full_name}{c.source === 'manually_added' && <span className="badge badge-blue" style={{ fontSize: 9, marginLeft: 6 }}>Manual</span>}</div>
                  <div className="c-meta">
                    {c.candidate_role} · {c.total_years}y
                    {daysAgo(c.screened_at) && <span style={{ marginLeft: 6, color: 'var(--text-3)', fontSize: 10, fontFamily: 'var(--font-mono)' }}>screened {daysAgo(c.screened_at)} ago</span>}
                  </div>
                  {c.match_reason && <div style={{ fontSize: 11, color: 'var(--text-2)', marginTop: 3 }}>{c.match_reason}</div>}
                </div>
                <div className="c-score">
                  {c._status === 'screening' && <span className="spinner" />}
                  {c.match_score != null && (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                      <ScoreRing score={c.match_score} size={42} />
                      <AIScoreFeedback candidateId={c.id} jobId={activeJob?.id} score={c.match_score} />
                    </div>
                  )}
                  {c.match_rank && <span className={`badge ${c.match_rank === 'top10' ? 'badge-blue' : c.match_rank === 'strong' ? 'badge-green' : c.match_rank === 'moderate' ? 'badge-amber' : 'badge-red'}`}>{c.match_rank}</span>}
                  {c.match_pass != null && <span className={`badge ${c.match_pass ? 'badge-green' : 'badge-red'}`}>{c.match_pass ? 'Pass' : 'Fail'}</span>}
                  {outreachBadge(c.id)}
                  {outreachLog[c.id]?.responded === false && (
                    <button className="btn btn-secondary" style={{ fontSize: 9, padding: '2px 6px' }} onClick={() => toggleResponded(c.id)}>Mark Responded</button>
                  )}
                  {outreachLog[c.id]?.responded && (
                    <button className="btn btn-secondary" style={{ fontSize: 9, padding: '2px 6px', color: 'var(--text-3)' }} onClick={() => toggleResponded(c.id)}>Undo</button>
                  )}
                  {!outreachLog[c.id] && (
                    <button className="btn btn-secondary" style={{ fontSize: 10, padding: '2px 8px' }} onClick={() => openOutreachModal(c)}>✉ Outreach</button>
                  )}
                  {outreachLog[c.id] && !outreachLog[c.id].responded && (
                    <button className="btn btn-secondary" style={{ fontSize: 10, padding: '2px 8px' }} onClick={() => openOutreachModal(c)}>↻ Resend</button>
                  )}
                  {!isClient && <button className="btn btn-ghost" title="Remove candidate" style={{ padding: '2px 6px', fontSize: 14, color: 'var(--red)', opacity: 0.5 }} onClick={e => { e.stopPropagation(); setDeleteModal({ candidate: c }) }}>🗑</button>}
                </div>
              </div>
            ))}
          </div>
          {screenedCount > 0 && (
            <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--text-3)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Scores not matching your judgment? Use the 👍 👎 buttons above to give feedback and help us improve.</span>
            </div>
          )}
        </div>
      )}

      {/* ── 4 AI Video Interview ── */}
      {!loadingJob && passedCandidates.length > 0 && (
        <div className="section-card">
          <div className="section-card-head">
            <h3>4 · AI Video Interview</h3>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              {activeJob?.assessment_enabled && !isClient && (
                <button
                  className="btn btn-secondary"
                  style={{ fontSize: 11, padding: '4px 10px', whiteSpace: 'nowrap' }}
                  disabled={scoringAssessments || pipelineRunning}
                  onClick={scoreAssessmentSubmissions}
                >
                  {scoringAssessments ? <><span className="spinner" style={{ width: 10, height: 10 }} /> Scoring…</> : '✓ Score Submissions'}
                </button>
              )}
              {!isClient && passedCandidates.filter(c => c.scores?.overallScore != null).length > 0 && (
                <button
                  className="btn btn-secondary"
                  style={{ fontSize: 11, padding: '4px 10px', whiteSpace: 'nowrap' }}
                  disabled={shortlistSummaryLoading}
                  onClick={async () => {
                    setShortlistSummaryLoading(true); setShortlistSummary(null)
                    try {
                      const scored = passedCandidates.filter(c => c.scores?.overallScore != null)
                      const result = await generateShortlistSummary(scored, activeJob)
                      setShortlistSummary(result)
                    } catch {}
                    setShortlistSummaryLoading(false)
                  }}
                >
                  {shortlistSummaryLoading ? <><span className="spinner" style={{ width: 10, height: 10 }} /> Summarising…</> : '✦ Shortlist Summary'}
                </button>
              )}
              {!isClient && (
                <button
                  className="btn btn-secondary"
                  style={{ fontSize: 11, padding: '4px 10px', whiteSpace: 'nowrap' }}
                  disabled={pipelineHealthLoading}
                  onClick={async () => {
                    setPipelineHealthLoading(true); setPipelineHealth(null)
                    try {
                      const result = await diagnosePipelineHealth(activeJob, candidates)
                      setPipelineHealth(result)
                    } catch {}
                    setPipelineHealthLoading(false)
                  }}
                >
                  {pipelineHealthLoading ? <><span className="spinner" style={{ width: 10, height: 10 }} /> Diagnosing…</> : '⚡ Pipeline Health'}
                </button>
              )}
              <span className="mono text-muted" style={{ fontSize: 11 }}>{passedCandidates.length} passed screening</span>
            </div>
          </div>

          {/* Shortlist Summary */}
          {shortlistSummary && (
            <div style={{ margin: '0 0 12px', padding: '14px 16px', background: 'var(--bg)', border: '1px solid var(--border)', borderLeft: '2px solid var(--accent)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--accent)' }}>Shortlist Summary</span>
                <button className="btn btn-ghost" style={{ fontSize: 11, padding: '1px 6px' }} onClick={() => setShortlistSummary(null)}>×</button>
              </div>
              <p style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.7, margin: '0 0 10px' }}>{shortlistSummary.summary}</p>
              {shortlistSummary.topPick && (
                <div style={{ fontSize: 12, color: 'var(--green)', padding: '6px 10px', background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.2)', marginBottom: 6 }}>
                  <strong>Top Pick:</strong> {shortlistSummary.topPick}
                </div>
              )}
              {shortlistSummary.watchOut && (
                <div style={{ fontSize: 12, color: 'var(--amber)', padding: '6px 10px', background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.2)' }}>
                  <strong>Watch out:</strong> {shortlistSummary.watchOut}
                </div>
              )}
            </div>
          )}

          {/* Pipeline Health */}
          {pipelineHealth && (
            <div style={{ margin: '0 0 12px', padding: '14px 16px', background: 'var(--bg)', border: '1px solid var(--border)', borderLeft: `2px solid ${pipelineHealth.urgency === 'Critical' ? 'var(--red)' : pipelineHealth.urgency === 'High' ? 'var(--amber)' : 'var(--accent)'}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-3)' }}>Pipeline Health</span>
                  <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', padding: '2px 8px', background: pipelineHealth.urgency === 'Critical' ? 'rgba(239,68,68,0.1)' : pipelineHealth.urgency === 'High' ? 'rgba(245,158,11,0.1)' : 'rgba(16,185,129,0.1)', border: `1px solid ${pipelineHealth.urgency === 'Critical' ? 'var(--red)' : pipelineHealth.urgency === 'High' ? 'var(--amber)' : 'var(--green)'}`, color: pipelineHealth.urgency === 'Critical' ? 'var(--red)' : pipelineHealth.urgency === 'High' ? 'var(--amber)' : 'var(--green)' }}>{pipelineHealth.urgency}</span>
                  {pipelineHealth.bottleneck && <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-3)' }}>Bottleneck: {pipelineHealth.bottleneck}</span>}
                </div>
                <button className="btn btn-ghost" style={{ fontSize: 11, padding: '1px 6px' }} onClick={() => setPipelineHealth(null)}>×</button>
              </div>
              <p style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.7, margin: '0 0 10px' }}>{pipelineHealth.diagnosis}</p>
              {pipelineHealth.actions?.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {pipelineHealth.actions.map((a, i) => (
                    <div key={i} style={{ fontSize: 12, color: 'var(--text-2)', display: 'flex', gap: 8 }}>
                      <span style={{ color: 'var(--accent)', flexShrink: 0 }}>→</span>{a}
                    </div>
                  ))}
                </div>
              )}
              {pipelineHealth.estimatedTimeToFill && (
                <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>Est. time to fill: {pipelineHealth.estimatedTimeToFill}</div>
              )}
            </div>
          )}
          <div className="candidate-list">
            {srch(passedCandidates).map(c => {
              const hasVideo  = c.video_urls?.length > 0
              const hasScores = !!c.scores?.overallScore
              const rec       = c.scores?.recommendation
              const dot       = slaDot(c)
              return (
                <div key={c.id} className="candidate-row" style={{ cursor: 'default' }}>
                  <div className="c-info">
                    <div className="c-name" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {dot && <span title={dot.title} style={{ width: 8, height: 8, borderRadius: '50%', background: dot.color, flexShrink: 0, display: 'inline-block' }} />}
                      {c.full_name}
                      {c.source === 'manually_added' && <span className="badge badge-blue" style={{ fontSize: 9 }}>Manual</span>}
                    </div>
                    <div className="c-meta">
                      {c.candidate_role} · {c.total_years}y
                      {daysAgo(c.interviewed_at) && <span style={{ marginLeft: 6, color: 'var(--text-3)', fontSize: 10, fontFamily: 'var(--font-mono)' }}>iv {daysAgo(c.interviewed_at)} ago</span>}
                    </div>
                  </div>
                  <div className="c-score" style={{ gap: 6, flexWrap: 'wrap' }}>
                    {!hasVideo && !hasScores && (
                      <>
                        <span className="badge badge-amber">Interview Pending</span>
                        {!isClient && (
                          <button className="btn btn-secondary" style={{ fontSize: 10, padding: '2px 8px' }} onClick={e => { e.stopPropagation(); setAiInviteModal({ candidate: c, email: c.email ?? '', sending: false, sent: false, error: null }) }}>✉ Invite</button>
                        )}
                        {c.interview_invite_token && (
                          <button className="btn btn-secondary" style={{ fontSize: 10, padding: '2px 8px' }} onClick={() => navigator.clipboard.writeText(`${appUrl}/interview/${c.interview_invite_token}`)}>⎘ Copy Link</button>
                        )}
                      </>
                    )}
                    {hasVideo && !hasScores && (
                      <>
                        <span className="badge badge-blue">Interview Submitted</span>
                        <button className="btn btn-secondary" style={{ fontSize: 10, padding: '2px 8px' }} onClick={() => setVideoPlayerTarget(c)}>▶ Watch</button>
                      </>
                    )}
                    {hasScores && (
                      <>
                        <span className="badge badge-green">Interview Completed</span>
                        <span className="mono" style={{ fontSize: 12, fontWeight: 700, color: dimColor(c.scores.overallScore) }}>{c.scores.overallScore}/100</span>
                        {rec && <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: REC_COLOR[rec] ?? 'var(--text-3)' }}>{rec}</span>}
                        {hasVideo && <button className="btn btn-secondary" style={{ fontSize: 10, padding: '2px 8px' }} onClick={() => setVideoPlayerTarget(c)}>▶ Watch</button>}
                      </>
                    )}
                    {!isClient && <button className="btn btn-ghost" title={c.recruiter_notes ? 'Edit notes' : 'Add notes'} style={{ padding: '2px 6px', fontSize: 12, color: c.recruiter_notes ? 'var(--accent)' : 'var(--text-3)', opacity: 0.8 }} onClick={e => { e.stopPropagation(); setNotesModal({ candidate: c, text: c.recruiter_notes ?? '', saving: false }) }}>📝</button>}
                    {!isClient && <button className="btn btn-ghost" title="Remove candidate" style={{ padding: '2px 6px', fontSize: 14, color: 'var(--red)', opacity: 0.5 }} onClick={e => { e.stopPropagation(); setDeleteModal({ candidate: c }) }}>🗑</button>}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── 5 Live Interview ── */}
      {!loadingJob && liveInterviewCandidates.length > 0 && (
        <div className="section-card">
          <div className="section-card-head">
            <h3>5 · Live Interview</h3>
            <span className="mono text-muted" style={{ fontSize: 11 }}>{liveInterviewCandidates.length} candidates</span>
          </div>
          <div className="candidate-list">
            {srch(liveInterviewCandidates).map(c => {
              const liveStatus = c.live_interview_status ?? 'none'
              const scheduled  = liveStatus === 'scheduled'
              const completed  = liveStatus === 'completed'
              return (
                <div key={c.id} className="candidate-row" style={{ cursor: 'default' }}>
                  <div className="c-info">
                    <div className="c-name">{c.full_name}{c.source === 'manually_added' && <span className="badge badge-blue" style={{ fontSize: 9, marginLeft: 6 }}>Manual</span>}</div>
                    <div className="c-meta">{c.candidate_role} · {c.total_years}y</div>
                  </div>
                  <div className="c-score" style={{ gap: 6, flexWrap: 'wrap' }}>
                    {!scheduled && !completed && (
                      <>
                        <span className="badge" style={{ color: 'var(--text-3)', background: 'var(--surface2)' }}>Not Scheduled</span>
                        <button className="btn btn-secondary" style={{ fontSize: 10, padding: '2px 8px' }} onClick={() => setScheduleModal({ candidate: c, email: c.email ?? '', slots: ['', '', ''], sending: false, sent: false, error: null })}>📅 Schedule</button>
                      </>
                    )}
                    {scheduled && !completed && (
                      <>
                        <span className="badge badge-blue">Scheduled</span>
                        <button className="btn btn-primary" style={{ fontSize: 10, padding: '2px 8px' }} onClick={() => setLiveCallModal({ candidate: c })}>🎥 Join Call</button>
                        <button className="btn btn-secondary" style={{ fontSize: 10, padding: '2px 8px' }} onClick={() => markLiveComplete(c)}>✓ Mark Done</button>
                      </>
                    )}
                    {completed && <span className="badge badge-green">Live Done</span>}
                    {!isClient && <button className="btn btn-ghost" title={c.recruiter_notes ? 'Edit notes' : 'Add notes'} style={{ padding: '2px 6px', fontSize: 12, color: c.recruiter_notes ? 'var(--accent)' : 'var(--text-3)', opacity: 0.8 }} onClick={e => { e.stopPropagation(); setNotesModal({ candidate: c, text: c.recruiter_notes ?? '', saving: false }) }}>📝</button>}
                    {!isClient && <button className="btn btn-ghost" title="Remove candidate" style={{ padding: '2px 6px', fontSize: 14, color: 'var(--red)', opacity: 0.5 }} onClick={e => { e.stopPropagation(); setDeleteModal({ candidate: c }) }}>🗑</button>}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── 6 Final Decision ── */}
      {!loadingJob && decisionCandidates.length > 0 && (
        <div className="section-card">
          <div className="section-card-head">
            <h3>6 · Final Decision</h3>
            <span className="mono text-muted" style={{ fontSize: 11 }}>{decisionCandidates.length} candidates</span>
          </div>
          <div className="candidate-list">
            {srch(decisionCandidates).map(c => {
              const decision = c.final_decision
              const offerSent = c.offer_status === 'sent'
              return (
                <div key={c.id} className="candidate-row" style={{ cursor: 'default' }}>
                  <div className="c-info">
                    <div className="c-name">{c.full_name}{c.source === 'manually_added' && <span className="badge badge-blue" style={{ fontSize: 9, marginLeft: 6 }}>Manual</span>}</div>
                    <div className="c-meta">{c.candidate_role} · {c.total_years}y</div>
                    {c.decision_notes && <div style={{ fontSize: 11, color: 'var(--text-2)', marginTop: 3 }}>{c.decision_notes}</div>}
                  </div>
                  <div className="c-score" style={{ gap: 6 }}>
                    {!decision && (
                      <>
                        <span className="badge" style={{ color: 'var(--text-3)', background: 'var(--surface2)' }}>Pending Decision</span>
                        <button className="btn btn-primary" style={{ fontSize: 10, padding: '2px 8px', background: 'var(--green)' }} onClick={() => setDecisionModal({ candidate: c, notes: '' })}>Hire / Reject</button>
                      </>
                    )}
                    {decision === 'hired' && (
                      <>
                        <span className="badge badge-green" style={{ fontSize: 12 }}>✓ Hired</span>
                        {!offerSent && <button className="btn btn-secondary" style={{ fontSize: 10, padding: '2px 8px' }} onClick={() => openOfferModal(c)}>📄 Send Offer</button>}
                        {offerSent && <span className="badge badge-blue" style={{ fontSize: 10 }}>Offer Sent</span>}
                      </>
                    )}
                    {decision === 'rejected' && <span className="badge badge-red" style={{ fontSize: 12 }}>✗ Rejected</span>}
                    {decision && <button className="btn btn-secondary" style={{ fontSize: 10, padding: '2px 8px' }} onClick={() => setDecisionModal({ candidate: c, notes: c.decision_notes ?? '' })}>Edit</button>}
                    {!isClient && <button className="btn btn-ghost" title={c.recruiter_notes ? 'Edit notes' : 'Add notes'} style={{ padding: '2px 6px', fontSize: 12, color: c.recruiter_notes ? 'var(--accent)' : 'var(--text-3)', opacity: 0.8 }} onClick={e => { e.stopPropagation(); setNotesModal({ candidate: c, text: c.recruiter_notes ?? '', saving: false }) }}>📝</button>}
                    {!isClient && <button className="btn btn-ghost" title="Remove candidate" style={{ padding: '2px 6px', fontSize: 14, color: 'var(--red)', opacity: 0.5 }} onClick={e => { e.stopPropagation(); setDeleteModal({ candidate: c }) }}>🗑</button>}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Video Player ── */}
      {videoPlayerTarget && <VideoPlayer candidate={videoPlayerTarget} onClose={() => setVideoPlayerTarget(null)} />}

      {/* ── Outreach Modal (Feature 1) ── */}
      {outreachModal && (
        <div style={MO}>
          <div style={{ ...MB, width: 560 }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Outreach Email</div>
              <div style={{ fontSize: 13, color: 'var(--text-3)' }}>{outreachModal.candidate.full_name} · {outreachModal.candidate.candidate_role}</div>
            </div>
            <div><label style={ML}>Recipient Email</label><input style={MI} value={outreachModal.email} onChange={e => setOutreachModal(m => ({ ...m, email: e.target.value }))} placeholder="candidate@email.com" /></div>
            <div><label style={ML}>Subject</label><input style={MI} value={outreachModal.subject ?? ''} onChange={e => setOutreachModal(m => ({ ...m, subject: e.target.value }))} placeholder="Subject line…" /></div>
            <div>
              <label style={ML}>Email Body {outreachModal.generating && <span style={{ color: 'var(--accent)' }}>· AI drafting…</span>}</label>
              <textarea style={{ ...MI, height: 200, resize: 'vertical', fontFamily: 'var(--font-body)', fontSize: 13, lineHeight: 1.6 }}
                value={outreachModal.emailContent}
                onChange={e => setOutreachModal(m => ({ ...m, emailContent: e.target.value }))}
                placeholder="AI-drafted email will appear here…"
                disabled={outreachModal.generating}
              />
            </div>
            {outreachModal.error && <div style={{ fontSize: 12, color: 'var(--red)' }}>⚠ {outreachModal.error}</div>}
            {outreachModal.sent && <div style={{ fontSize: 12, color: 'var(--green)' }}>✓ Outreach email sent successfully</div>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setOutreachModal(null)}>{outreachModal.sent ? 'Close' : 'Cancel'}</button>
              {!outreachModal.sent && <button className="btn btn-primary" disabled={outreachModal.generating || outreachModal.sending || !outreachModal.emailContent.trim()} onClick={sendOutreach}>
                {outreachModal.sending ? <><span className="spinner" style={{ width: 11, height: 11 }} /> Sending…</> : '✉ Send Outreach'}
              </button>}
            </div>
          </div>
        </div>
      )}

      {/* ── AI Invite Modal ── */}
      {aiInviteModal && (
        <div style={MO}>
          <div style={MB}>
            <div><div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Send AI Interview Invite</div><div style={{ fontSize: 13, color: 'var(--text-3)' }}>{aiInviteModal.candidate.full_name}</div></div>
            <div><label style={ML}>Email</label><input autoFocus style={MI} value={aiInviteModal.email} onChange={e => setAiInviteModal(m => ({ ...m, email: e.target.value, sent: false, error: null }))} onKeyDown={e => { if (e.key === 'Enter' && !aiInviteModal.sending && !aiInviteModal.sent) sendAiInterviewInvite() }} placeholder="candidate@email.com" disabled={aiInviteModal.sending || aiInviteModal.sent} /></div>
            {aiInviteModal.error && <div style={{ fontSize: 12, color: 'var(--red)' }}>⚠ {aiInviteModal.error}</div>}
            {aiInviteModal.sent && <div style={{ fontSize: 12, color: 'var(--green)' }}>✓ Invite sent to {aiInviteModal.email}</div>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setAiInviteModal(null)}>{aiInviteModal.sent ? 'Close' : 'Cancel'}</button>
              {!aiInviteModal.sent && <button className="btn btn-primary" disabled={aiInviteModal.sending || !aiInviteModal.email.trim()} onClick={sendAiInterviewInvite}>{aiInviteModal.sending ? <><span className="spinner" style={{ width: 11, height: 11 }} /> Sending…</> : 'Send Invite'}</button>}
            </div>
          </div>
        </div>
      )}

      {/* ── Schedule Modal (Feature 4) ── */}
      {scheduleModal && (
        <div style={MO}>
          <div style={{ ...MB, width: 500 }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Schedule Live Interview</div>
              <div style={{ fontSize: 13, color: 'var(--text-3)' }}>{scheduleModal.candidate.full_name} — propose 3 time slots</div>
            </div>
            <div><label style={ML}>Candidate Email</label><input style={MI} value={scheduleModal.email} onChange={e => setScheduleModal(m => ({ ...m, email: e.target.value }))} placeholder="candidate@email.com" /></div>
            {[0, 1, 2].map(i => (
              <div key={i}>
                <label style={ML}>Slot {i + 1}</label>
                <input type="datetime-local" style={MI} value={scheduleModal.slots[i]} onChange={e => {
                  const next = [...scheduleModal.slots]; next[i] = e.target.value
                  setScheduleModal(m => ({ ...m, slots: next }))
                }} />
              </div>
            ))}
            {scheduleModal.error && <div style={{ fontSize: 12, color: 'var(--red)' }}>⚠ {scheduleModal.error}</div>}
            {scheduleModal.sent && <div style={{ fontSize: 12, color: 'var(--green)' }}>✓ Schedule invite sent — candidate can confirm a slot</div>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setScheduleModal(null)}>{scheduleModal.sent ? 'Close' : 'Cancel'}</button>
              {!scheduleModal.sent && <button className="btn btn-primary" disabled={scheduleModal.sending || !scheduleModal.email.trim() || !scheduleModal.slots.some(s => s)} onClick={sendScheduleInvite}>
                {scheduleModal.sending ? <><span className="spinner" style={{ width: 11, height: 11 }} /> Sending…</> : '📅 Send Schedule'}
              </button>}
            </div>
          </div>
        </div>
      )}

      {/* ── Decision Modal ── */}
      {decisionModal && (
        <div style={MO}>
          <div style={MB}>
            <div><div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Final Decision</div><div style={{ fontSize: 13, color: 'var(--text-3)' }}>{decisionModal.candidate.full_name}</div></div>
            <div><label style={ML}>Notes (optional)</label><textarea style={{ ...MI, height: 80, resize: 'vertical' }} value={decisionModal.notes} onChange={e => setDecisionModal(m => ({ ...m, notes: e.target.value }))} placeholder="Add notes about this decision…" /></div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setDecisionModal(null)}>Cancel</button>
              <button className="btn btn-secondary" style={{ color: 'var(--red)', borderColor: 'var(--red)' }} onClick={() => saveDecision('rejected')}>✗ Reject</button>
              <button className="btn btn-primary" style={{ background: 'var(--green)' }} onClick={() => saveDecision('hired')}>✓ Hire</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Offer Letter Modal (Feature 5) ── */}
      {offerModal && (
        <div style={MO}>
          <div style={{ ...MB, width: 580 }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Offer Letter</div>
              <div style={{ fontSize: 13, color: 'var(--text-3)' }}>{offerModal.candidate.full_name} · {activeJob?.title}</div>
            </div>
            <div>
              <label style={ML}>Letter Content {offerModal.generating && <span style={{ color: 'var(--accent)' }}>· AI drafting…</span>}</label>
              <textarea
                style={{ ...MI, height: 280, resize: 'vertical', fontFamily: 'var(--font-body)', fontSize: 13, lineHeight: 1.7 }}
                value={offerModal.letterContent}
                onChange={e => setOfferModal(m => ({ ...m, letterContent: e.target.value }))}
                placeholder="AI-generated offer letter will appear here…"
                disabled={offerModal.generating}
              />
            </div>
            {offerModal.error && <div style={{ fontSize: 12, color: 'var(--red)' }}>⚠ {offerModal.error}</div>}
            {offerModal.sent && <div style={{ fontSize: 12, color: 'var(--green)' }}>✓ Offer letter sent as PDF to {offerModal.candidate.email}</div>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setOfferModal(null)}>{offerModal.sent ? 'Close' : 'Cancel'}</button>
              {!offerModal.sent && <button className="btn btn-primary" disabled={offerModal.generating || offerModal.sending || !offerModal.letterContent.trim()} onClick={sendOfferLetter}>
                {offerModal.sending ? <><span className="spinner" style={{ width: 11, height: 11 }} /> Sending…</> : '📄 Send as PDF'}
              </button>}
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Candidate Modal ── */}
      {deleteModal && (
        <div style={MO}>
          <div style={MB}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Remove Candidate</div>
              <div style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.6 }}>
                Are you sure you want to remove <strong>{deleteModal.candidate.full_name}</strong> from this pipeline? This cannot be undone.
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setDeleteModal(null)}>Cancel</button>
              <button
                className="btn btn-primary"
                style={{ background: 'var(--red)', borderColor: 'var(--red)' }}
                disabled={deleteModal.deleting}
                onClick={handleDeleteCandidate}
              >
                {deleteModal.deleting ? <><span className="spinner" style={{ width: 11, height: 11 }} /> Removing…</> : 'Remove'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Recruiter Notes Modal ── */}
      {notesModal && (
        <div style={MO}>
          <div style={{ ...MB, width: 440 }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Recruiter Notes</div>
              <div style={{ fontSize: 13, color: 'var(--text-3)' }}>{notesModal.candidate.full_name} · {notesModal.candidate.candidate_role}</div>
            </div>
            <textarea
              autoFocus
              rows={6}
              style={{ ...MI, resize: 'vertical', lineHeight: 1.6 }}
              value={notesModal.text}
              onChange={e => setNotesModal(m => ({ ...m, text: e.target.value }))}
              placeholder="Phone screen impressions, salary expectations, notice period, red flags…"
            />
            <div style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>Visible to recruiters and admins only. Not shared with the client.</div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setNotesModal(null)}>Cancel</button>
              <button className="btn btn-primary" disabled={notesModal.saving} onClick={saveNotes}>
                {notesModal.saving ? <><span className="spinner" style={{ width: 11, height: 11 }} /> Saving…</> : 'Save Notes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Add Manually Modal ── */}
      {addManuallyModal && (
        <div style={MO}>
          <div style={{ ...MB, width: 500 }}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>Add Candidate Manually</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div><label style={ML}>Full Name *</label><input autoFocus style={MI} value={addManuallyModal.full_name} onChange={e => setAddManuallyModal(m => ({ ...m, full_name: e.target.value }))} placeholder="Jane Smith" /></div>
              <div><label style={ML}>Email</label><input style={MI} value={addManuallyModal.email} onChange={e => setAddManuallyModal(m => ({ ...m, email: e.target.value }))} placeholder="jane@example.com" /></div>
              <div><label style={ML}>Phone (optional)</label><input style={MI} value={addManuallyModal.phone} onChange={e => setAddManuallyModal(m => ({ ...m, phone: e.target.value }))} placeholder="+91 9876543210" /></div>
              <div><label style={ML}>Current Role</label><input style={MI} value={addManuallyModal.candidate_role} onChange={e => setAddManuallyModal(m => ({ ...m, candidate_role: e.target.value }))} placeholder="Senior Engineer" /></div>
              <div><label style={ML}>Years of Experience</label><input type="number" min={0} style={MI} value={addManuallyModal.total_years} onChange={e => setAddManuallyModal(m => ({ ...m, total_years: e.target.value }))} placeholder="5" /></div>
              <div><label style={ML}>Education (optional)</label><input style={MI} value={addManuallyModal.education} onChange={e => setAddManuallyModal(m => ({ ...m, education: e.target.value }))} placeholder="B.Tech Computer Science" /></div>
              <div style={{ gridColumn: 'span 2' }}><label style={ML}>Skills (comma separated)</label><input style={MI} value={addManuallyModal.skills} onChange={e => setAddManuallyModal(m => ({ ...m, skills: e.target.value }))} placeholder="React, Node.js, TypeScript" /></div>
              <div style={{ gridColumn: 'span 2' }}><label style={ML}>Summary (optional)</label><textarea style={{ ...MI, height: 70, resize: 'vertical' }} value={addManuallyModal.summary} onChange={e => setAddManuallyModal(m => ({ ...m, summary: e.target.value }))} placeholder="Brief professional summary…" /></div>
              <div><label style={ML}>LinkedIn URL (optional)</label><input style={MI} value={addManuallyModal.linkedin_url} onChange={e => setAddManuallyModal(m => ({ ...m, linkedin_url: e.target.value }))} placeholder="https://linkedin.com/in/…" /></div>
              <div><label style={ML}>GitHub URL (optional)</label><input style={MI} value={addManuallyModal.github_url} onChange={e => setAddManuallyModal(m => ({ ...m, github_url: e.target.value }))} placeholder="https://github.com/…" /></div>
              <div style={{ gridColumn: 'span 2' }}><label style={ML}>Portfolio / Website (optional)</label><input style={MI} value={addManuallyModal.portfolio_url} onChange={e => setAddManuallyModal(m => ({ ...m, portfolio_url: e.target.value }))} placeholder="https://…" /></div>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-2)', cursor: 'pointer' }}>
              <input type="checkbox" checked={addManuallyModal.addToPool} onChange={e => setAddManuallyModal(m => ({ ...m, addToPool: e.target.checked }))} />
              Also add to master talent pool
            </label>
            {addManuallyModal.error && <div style={{ fontSize: 12, color: 'var(--red)' }}>⚠ {addManuallyModal.error}</div>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setAddManuallyModal(null)}>Cancel</button>
              <button
                className="btn btn-primary"
                disabled={!addManuallyModal.full_name.trim() || addManuallyModal.saving}
                onClick={handleAddManually}
              >
                {addManuallyModal.saving ? <><span className="spinner" style={{ width: 11, height: 11 }} /> Saving…</> : 'Add Candidate'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Live Call Modal ── */}
      {liveCallModal && (
        <div style={{ ...MO, alignItems: 'stretch', padding: 0 }}>
          <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', background: '#000' }}>
            <div style={{ padding: '10px 16px', background: 'rgba(0,0,0,0.9)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.1)', flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ color: '#B8924A', fontFamily: 'monospace', fontSize: 13, letterSpacing: '0.1em' }}>ONE SELECT</span>
                <span style={{ color: 'rgba(255,255,255,0.3)' }}>·</span>
                <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13 }}>{liveCallModal.candidate.full_name} — Live Interview</span>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button className="btn btn-secondary" style={{ fontSize: 11, padding: '4px 12px' }} onClick={() => { markLiveComplete(liveCallModal.candidate); setLiveCallModal(null) }}>✓ End & Mark Done</button>
                <button onClick={() => setLiveCallModal(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.4)', fontSize: 20, padding: '4px 8px' }}>✕</button>
              </div>
            </div>
            <iframe
              src={liveCallModal.candidate.live_room_url ?? `https://meet.jit.si/oneselect-${liveCallModal.candidate.live_interview_token ?? liveCallModal.candidate.id}`}
              style={{ flex: 1, border: 'none', width: '100%' }}
              allow="camera; microphone; fullscreen; display-capture"
              title="Live Interview"
            />
          </div>
        </div>
      )}

      {/* ── Log ── */}
      {log.length > 0 && (
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
    </div>
  )
}

// Modal style constants
const MO = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000 }
const MB = { background: 'var(--surface)', borderRadius: 12, padding: 28, width: 420, display: 'flex', flexDirection: 'column', gap: 16, maxHeight: '90vh', overflowY: 'auto' }
const ML = { fontSize: 11, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-3)', display: 'block', marginBottom: 6 }
const MI = { width: '100%', padding: '9px 12px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13, boxSizing: 'border-box' }
