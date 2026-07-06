// Deployed with --no-verify-jwt: called from the public /interview/:token page
// which has no authenticated session. Uses SUPABASE_SERVICE_ROLE_KEY internally.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { corsHeaders } from "../_shared/cors.ts"

type JobRow = {
  id?: string
  title?: string
  required_skills?: string[]
  experience_years?: number
  interview_questions?: unknown
}

function defaultInterviewQuestions(job: JobRow | null) {
  const title = job?.title ?? 'this role'
  const skills = (job?.required_skills ?? []).slice(0, 3).join(', ') || 'the required skills'
  return [
    { q: `Tell us about your background and why you're interested in the ${title} role.`, type: 'behavioral', seconds: 90 },
    { q: `Describe a project where you used ${skills}. What was your specific contribution?`, type: 'technical', seconds: 120 },
    { q: `What is the most complex technical problem you've solved in a role similar to ${title}?`, type: 'technical', seconds: 120 },
    { q: `How do you handle conflicting priorities or tight deadlines? Give a concrete example.`, type: 'behavioral', seconds: 90 },
    { q: `Where do you see the biggest gap between your experience and this role, and how would you close it?`, type: 'technical', seconds: 120 },
  ]
}

function resolveInterviewQuestions(job: JobRow | null) {
  const qs = job?.interview_questions
  if (Array.isArray(qs) && qs.length > 0) return qs
  return defaultInterviewQuestions(job)
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { token } = await req.json()
    if (!token) {
      return new Response(JSON.stringify({ error: 'token is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const admin = createClient(supabaseUrl, serviceKey)

    const { data: cRow, error: cErr } = await admin
      .from('candidates')
      .select('id, full_name, email, candidate_role, video_urls, interview_token_expires_at, jobs(id, title, required_skills, experience_years, interview_questions)')
      .eq('interview_invite_token', token)
      .maybeSingle()

    if (cErr) throw new Error(cErr.message)

    if (cRow) {
      const job = cRow.jobs as JobRow | null
      const vUrls = (cRow.video_urls ?? []) as { url?: string | null }[]
      return new Response(JSON.stringify({
        candidate: {
          id: cRow.id,
          full_name: cRow.full_name,
          email: cRow.email,
          candidate_role: cRow.candidate_role,
        },
        job: job ? { ...job, interview_questions: resolveInterviewQuestions(job) } : { title: 'Interview', interview_questions: defaultInterviewQuestions(null) },
        table: 'candidates',
        video_urls: vUrls,
        interview_token_expires_at: cRow.interview_token_expires_at,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const { data: mRow, error: mErr } = await admin
      .from('job_matches')
      .select('id, video_urls, interview_token_expires_at, talent_pool(full_name, email, candidate_role), jobs(id, title, required_skills, experience_years, interview_questions)')
      .eq('interview_invite_token', token)
      .maybeSingle()

    if (mErr) throw new Error(mErr.message)

    if (mRow) {
      const tp = mRow.talent_pool as { full_name?: string; email?: string; candidate_role?: string } | null
      const job = mRow.jobs as JobRow | null
      const vUrls = (mRow.video_urls ?? []) as { url?: string | null }[]
      return new Response(JSON.stringify({
        candidate: {
          id: mRow.id,
          full_name: tp?.full_name ?? '',
          email: tp?.email ?? '',
          candidate_role: tp?.candidate_role ?? '',
        },
        job: job ? { ...job, interview_questions: resolveInterviewQuestions(job) } : { title: 'Interview', interview_questions: defaultInterviewQuestions(null) },
        table: 'job_matches',
        video_urls: vUrls,
        interview_token_expires_at: mRow.interview_token_expires_at,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    return new Response(JSON.stringify({ error: 'Invalid or expired interview link.' }), {
      status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('get-interview-session error:', err)
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
