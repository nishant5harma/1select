import { supabase } from '../lib/supabase'

export function useScheduling() {
  function getSchedulingLink(recruiterProfile, candidate, job) {
    const username = recruiterProfile?.cal_username
    if (!username) return null
    const slug   = recruiterProfile?.cal_event_type_slug || '30min'
    const params = new URLSearchParams()
    if (candidate?.full_name) params.set('name', candidate.full_name)
    if (candidate?.email)     params.set('email', candidate.email)
    if (job?.title)           params.set('notes', `Job: ${job.title}`)
    // Pass IDs so the cal-webhook can match the booking to the right row
    if (candidate?.id && !candidate._fromPool) params.set('metadata[candidate_id]', candidate.id)
    if (candidate?.id && candidate._fromPool)  params.set('metadata[job_match_id]', candidate.id)
    if (job?.id) params.set('metadata[job_id]', job.id)
    return `https://cal.com/${username}/${slug}?${params.toString()}`
  }

  async function getBookingStatus(candidateId, jobId, isPoolCandidate = false) {
    const col = isPoolCandidate ? 'job_match_id' : 'candidate_id'
    const { data } = await supabase
      .from('interview_bookings')
      .select('*')
      .eq(col, candidateId)
      .eq('job_id', jobId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    return data
  }

  async function loadBookingsForJob(jobId) {
    const { data } = await supabase
      .from('interview_bookings')
      .select('*')
      .eq('job_id', jobId)
    const map = {}
    ;(data ?? []).forEach(b => {
      const key = b.candidate_id || b.job_match_id
      if (key) map[key] = b
    })
    return map
  }

  return { getSchedulingLink, getBookingStatus, loadBookingsForJob }
}
