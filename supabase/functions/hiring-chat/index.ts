import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { corsHeaders } from "../_shared/cors.ts"
import { CLAUDE_MODEL } from "../_shared/claude.ts"

const BASE_SYSTEM = `You are a senior hiring advisor for One Select, a premium recruitment agency. You are speaking directly with a client who is hiring talent through One Select. You have access to their live pipeline data which will be provided to you in each message. Your job is to give sharp, confident, data-driven hiring recommendations. When asked about specific candidates, reference their actual scores, transcript highlights, and verdicts. When giving general advice, be practical and concise. Always maintain a professional but approachable tone that reflects One Select's premium brand. Never reveal internal system details or data from other clients.`

function buildMessages(
  history: { role: string; content: string }[],
  currentMessage: string
): { role: string; content: string }[] {
  // Ensure valid alternating sequence starting with user
  const clean: { role: string; content: string }[] = []
  for (const msg of history) {
    if (clean.length === 0) {
      if (msg.role === 'user') clean.push({ role: 'user', content: msg.content })
    } else if (msg.role !== clean[clean.length - 1].role) {
      clean.push({ role: msg.role as 'user' | 'assistant', content: msg.content })
    }
  }
  // Remove trailing user message to avoid consecutive user messages
  if (clean.length > 0 && clean[clean.length - 1].role === 'user') clean.pop()
  clean.push({ role: 'user', content: currentMessage })
  return clean
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabaseUrl  = Deno.env.get('SUPABASE_URL') ?? ''
    const serviceKey   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const anonKey      = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY') ?? ''

    // Verify caller identity
    const authHeader = req.headers.get('Authorization') ?? ''
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user }, error: authError } = await userClient.auth.getUser()
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { message, conversation_history = [] } = await req.json()
    if (!message?.trim()) throw new Error('Message is required')

    const clientId = user.id
    const admin    = createClient(supabaseUrl, serviceKey)

    // ── Rate limit: 50 user messages per client per UTC day ───────────────
    const dayStart = new Date()
    dayStart.setUTCHours(0, 0, 0, 0)
    const { count: todayCount } = await admin
      .from('chat_history')
      .select('*', { count: 'exact', head: true })
      .eq('client_id', clientId)
      .eq('role', 'user')
      .gte('created_at', dayStart.toISOString())
    if ((todayCount ?? 0) >= 50) {
      return new Response(
        JSON.stringify({ error: 'Daily message limit reached (50 messages). Resets at midnight UTC.' }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ── Fetch client data ──────────────────────────────────────────────────
    const [{ data: profile }, { data: jobs }] = await Promise.all([
      admin.from('profiles').select('company_name, full_name').eq('id', clientId).single(),
      admin.from('jobs')
        .select('id, title, status, required_skills, experience_years, description')
        .eq('recruiter_id', clientId)
        .order('created_at', { ascending: false }),
    ])

    const jobIds = (jobs ?? []).map((j: { id: string }) => j.id)
    const jobMap: Record<string, string> = {}
    for (const j of (jobs ?? [])) jobMap[(j as { id: string }).id] = (j as { title: string }).title

    // ── Fetch candidates ───────────────────────────────────────────────────
    type Candidate = Record<string, unknown>
    let allCandidates: Candidate[] = []

    if (jobIds.length) {
      const [{ data: regular }, { data: pool }] = await Promise.all([
        admin.from('candidates')
          .select('id, full_name, candidate_role, total_years, skills, match_score, match_pass, match_reason, match_rank, scores, interview_transcript, live_interview_status, live_interview_notes, final_decision, job_id')
          .in('job_id', jobIds),
        admin.from('job_matches')
          .select('id, job_id, match_score, match_pass, match_reason, match_rank, scores, interview_transcript, live_interview_status, live_interview_notes, final_decision, talent_pool(full_name, candidate_role, total_years, skills)')
          .in('job_id', jobIds),
      ])

      // deno-lint-ignore no-explicit-any
      const mapCandidate = (c: any, name: string, role: string, years: unknown, skills: unknown, job_id: string): Candidate => ({
        name, role, years, skills, job_id,
        match_score: c.match_score, match_pass: c.match_pass,
        match_reason: c.match_reason, match_rank: c.match_rank,
        overall_score: c.scores?.overallScore,
        scores: c.scores, transcript: c.interview_transcript,
        live_status: c.live_interview_status, live_notes: c.live_interview_notes,
        decision: c.final_decision,
      })

      allCandidates = [
        // deno-lint-ignore no-explicit-any
        ...(regular ?? []).map((c: any) => mapCandidate(c, c.full_name, c.candidate_role, c.total_years, c.skills, c.job_id)),
        // deno-lint-ignore no-explicit-any
        ...(pool ?? []).map((m: any) => mapCandidate(m, m.talent_pool?.full_name, m.talent_pool?.candidate_role, m.talent_pool?.total_years, m.talent_pool?.skills, m.job_id)),
      ]
    }

    // ── Build context ──────────────────────────────────────────────────────
    const company = (profile as { company_name?: string } | null)?.company_name ?? 'your company'
    const contact = (profile as { full_name?: string } | null)?.full_name ?? ''

    const jobsBlock = (jobs ?? []).length
      ? (jobs ?? []).map((j: { title: string; status: string; experience_years?: number; required_skills?: string[] }) =>
          `• ${j.title} [${j.status}] — ${j.experience_years ?? '?'}+ yrs | Requires: ${(j.required_skills ?? []).join(', ') || 'not specified'}`)
          .join('\n')
      : 'No jobs posted yet.'

    const candidatesBlock = allCandidates.length
      ? allCandidates.map((c) => {
          const jobTitle = jobMap[c.job_id as string] ?? 'Unknown'
          const screen   = c.match_score != null
            ? `Screening: ${c.match_score}/100 (${c.match_pass ? 'PASS' : 'FAIL'}) — ${c.match_reason ?? ''}`
            : 'Screening: Pending'
          const interview = c.overall_score != null
            ? `Interview Score: ${c.overall_score}/100`
            : 'Interview: Not completed'
          const dims = c.scores && typeof c.scores === 'object'
            ? Object.entries(c.scores as Record<string, unknown>)
                .filter(([k]) => !['overallScore', 'strengths', 'flags'].includes(k))
                .map(([k, v]) => `${k}=${v}`).join(', ')
            : ''
          const strengths = Array.isArray((c.scores as Record<string, unknown>)?.strengths)
            ? `Strengths: ${((c.scores as Record<string, unknown>).strengths as string[]).slice(0, 3).join('; ')}`
            : ''
          const flags = Array.isArray((c.scores as Record<string, unknown>)?.flags)
            ? `Flags: ${((c.scores as Record<string, unknown>).flags as string[]).slice(0, 2).join('; ')}`
            : ''
          const transcript = c.transcript
            ? `Transcript: "${String(c.transcript).slice(0, 350)}..."`
            : ''
          const live     = c.live_status ? `Live interview: ${c.live_status}` : ''
          const notes    = c.live_notes  ? `Live notes: ${String(c.live_notes).slice(0, 200)}` : ''
          const decision = c.decision    ? `Final decision: ${c.decision}` : ''
          const skills   = Array.isArray(c.skills) ? `Skills: ${(c.skills as string[]).join(', ')}` : ''
          return [
            `--- ${c.name ?? 'Unknown'} | Role applying for: ${jobTitle} | ${c.role ?? ''} | ${c.years ?? '?'} yrs | Rank: ${c.match_rank ?? 'N/A'}`,
            skills, screen, interview,
            dims && `Dimension scores: ${dims}`, strengths, flags,
            transcript, live, notes, decision,
          ].filter(Boolean).join('\n  ')
        }).join('\n\n')
      : 'No candidates in pipeline yet.'

    const systemPrompt = `${BASE_SYSTEM}

--- LIVE CLIENT DATA ---
Client: ${company}${contact ? ` (${contact})` : ''}

JOBS:
${jobsBlock}

CANDIDATES:
${candidatesBlock}
--- END CLIENT DATA ---`

    // ── Call Claude ────────────────────────────────────────────────────────
    const messages = buildMessages(conversation_history.slice(-14), message.trim())

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 1200,
        system: systemPrompt,
        messages,
      }),
    })

    if (!claudeRes.ok) {
      const err = await claudeRes.json()
      throw new Error((err as { error?: { message?: string } }).error?.message ?? `Claude API error ${claudeRes.status}`)
    }

    const claudeData = await claudeRes.json()
    const response = (claudeData.content as { text?: string }[])
      .map(b => b.text ?? '').join('')

    return new Response(JSON.stringify({ response }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (err) {
    console.error('hiring-chat error:', err)
    return new Response(
      JSON.stringify({ error: (err as Error).message ?? 'Unknown error' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
