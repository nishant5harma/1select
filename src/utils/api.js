import { supabase } from '../lib/supabase'

// All Claude calls are proxied through a Supabase edge function so the API
// key is never exposed in the browser bundle.
export async function callClaude(messages, systemPrompt, maxTokens = 1000) {
  const { data: sessionData } = await supabase.auth.getSession()
  const token = sessionData?.session?.access_token

  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/call-claude`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ messages, systemPrompt, maxTokens }),
    }
  )

  let data
  try {
    data = await res.json()
  } catch {
    throw new Error(`AI request failed (HTTP ${res.status}). Check Supabase call-claude deployment.`)
  }

  if (!res.ok || data.error) {
    const msg = data.error || `API error ${res.status}`
    if (res.status === 503) throw new Error('AI not configured: set ANTHROPIC_API_KEY in Supabase Edge Function secrets.')
    if (res.status === 401) throw new Error('Not logged in — refresh the page and sign in again.')
    if (res.status === 429) throw new Error(msg)
    throw new Error(msg)
  }

  if (!data.text) throw new Error('AI returned an empty response.')
  return data.text
}

// Generates 5 video interview questions for a job. Called from AdminPipeline
// when sending an AI interview invite so questions are pre-saved to the job
// record — the public interview page has no auth session and cannot call
// callClaude() directly (call-claude requires a valid user JWT).
export function defaultInterviewQuestions(job) {
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

/** Questions for the public interview page — never calls Claude (no auth session). */
export function resolveInterviewQuestions(job) {
  if (Array.isArray(job?.interview_questions) && job.interview_questions.length > 0) {
    return job.interview_questions
  }
  return defaultInterviewQuestions(job)
}

export async function generateInterviewQuestions(job) {
  const sys = `Generate exactly 5 video interview questions for a ${job.title} role.
Required skills: ${(job.required_skills || []).join(', ')}
Experience: ${job.experience_years || 0}+ years

Return ONLY a valid JSON array (no markdown):
[{"q":"question text","type":"technical|behavioral","seconds":90}]

Rules: 3 technical (120 seconds each), 2 behavioral (90 seconds each). Be specific and role-relevant.`

  try {
    const reply = await callClaude([{ role: 'user', content: 'Generate.' }], sys, 700)
    const clean = reply.trim().replace(/^```(?:json)?\s*/i, '').replace(/```[\s]*$/m, '').trim()
    return JSON.parse(clean)
  } catch {
    return defaultInterviewQuestions(job)
  }
}

/** Score a video interview transcript (STT Q&A) — overallScore is 0–10. Uses Claude via call-claude. */
export async function scoreVideoInterview(candidate, job, transcriptMessages = []) {
  const pairs = []
  for (let i = 0; i < transcriptMessages.length; i++) {
    const m = transcriptMessages[i]
    if (m.role === 'assistant' || m.role === 'interviewer') {
      const answer = transcriptMessages[i + 1]
      if (answer && (answer.role === 'user' || answer.role === 'candidate')) {
        pairs.push({ question: m.content, answer: answer.content })
        i++
      }
    }
  }

  const qaBlock = pairs.map((p, i) =>
    `Q${i + 1}: ${p.question}\nA${i + 1}: ${p.answer}`
  ).join('\n\n')

  const systemPrompt = `You are an expert technical recruiter scoring a VIDEO interview.
The transcript comes from speech-to-text and may be imperfect — judge intent and substance, not transcription quality.

Job: ${job?.title ?? 'Unknown'}
Required skills: ${(job?.required_skills ?? []).join(', ') || 'N/A'}
Experience: ${job?.experience_years ?? '?'} years
Candidate: ${candidate?.full_name ?? 'Unknown'} — ${candidate?.candidate_role ?? ''}

Return ONLY valid JSON (no markdown):
{
  "overallScore": 6.5,
  "recommendation": "Strong Hire|Hire|Borderline|Reject",
  "summary": "2-3 sentence overall assessment",
  "strengths": ["strength 1", "strength 2"],
  "weaknesses": ["weakness 1"],
  "perQuestion": [
    {"question": "...", "score": 7, "feedback": "one sentence"}
  ]
}

Rules: overallScore is 0–10 (one decimal). Score answers against the job requirements, not the CV alone.`

  const reply = await callClaude(
    [{ role: 'user', content: `Score this video interview transcript:\n\n${qaBlock || 'No answers captured.'}` }],
    systemPrompt,
    2000,
  )
  const clean = reply.trim().replace(/^```(?:json)?\s*/i, '').replace(/```[\s]*$/m, '').trim()
  try {
    return JSON.parse(clean)
  } catch {
    throw new Error('AI response was not valid JSON. Deploy the latest call-claude function and try again.')
  }
}

// NOTE: scores below are generated from CV data via a simulated interview — they
// are NOT derived from the candidate's video responses. Label accordingly in UI.
export async function runAutomatedInterview(candidate, jobDef) {
  const systemPrompt = `You are simulating a job interview.
You will play both the interviewer and the candidate.
The candidate's background: ${candidate.summary}
Their experience: ${(candidate.highlights ?? []).join(', ')}
Their skills: ${(candidate.skills ?? []).join(', ')}

Generate a realistic 5-question interview where:
- You ask a question as the interviewer
- You answer it as the candidate would based on their CV
- Make answers specific to their actual experience

Return ONLY valid JSON:
{
  "transcript": [
    {"role": "interviewer", "content": "question text"},
    {"role": "candidate", "content": "answer based on their CV"}
  ],
  "scores": {
    "technicalAbility": 0,
    "communication": 0,
    "roleFit": 0,
    "problemSolving": 0,
    "experienceRelevance": 0,
    "overallScore": 0,
    "recommendation": "Strong Hire|Hire|Borderline|Reject",
    "confidence": "High|Medium|Low",
    "insight": "3-4 sentence narrative",
    "strengths": ["strength 1", "strength 2"],
    "flags": [],
    "bestAnswer": "quote the strongest simulated answer",
    "highlights": ["3 strongest signals from this interview"],
    "redFlags": ["specific concern with evidence from transcript"],
    "skillsVerification": {
      "verified": ["skill proven in transcript"],
      "questionable": ["skill claimed but not demonstrated"],
      "notDemonstrated": ["required skill not shown"]
    },
    "candidatePersona": "IC|Tech Lead|Engineering Manager",
    "offerProbability": 0
  }
}`

  const result = await callClaude([{
    role: 'user',
    content: `Job: ${jobDef.title}, ${jobDef.experience_years}+ years.
Required: ${(jobDef.required_skills ?? []).join(', ')}.
Candidate: ${candidate.full_name}, ${candidate.candidate_role}.
CV Summary: ${candidate.summary}
Highlights: ${(candidate.highlights ?? []).join('; ')}
Skills: ${(candidate.skills ?? []).join(', ')}`
  }], systemPrompt, 3000)

  const parsed = JSON.parse(result.replace(/```json|```/g, '').trim())
  return parsed
}

export async function analyzeCandidate(candidate, job) {
  const systemPrompt = `You are an expert recruiter analyst. Analyze the candidate's CV and interview data against the job requirements.

Return ONLY valid JSON:
{
  "careerTrajectory": "2-3 sentence arc describing their progression",
  "persona": "IC|Tech Lead|Engineering Manager",
  "skillsGapNarrative": "2-3 sentence analysis of fit vs gaps",
  "topStrengths": ["strength 1", "strength 2", "strength 3"],
  "developmentAreas": ["gap 1", "gap 2"],
  "hiringRisk": "Low|Medium|High",
  "hiringRiskReason": "one sentence"
}`

  const result = await callClaude([{
    role: 'user',
    content: `Job: ${job?.title ?? 'Unknown'} (${job?.experience_years ?? '?'}+ yrs)
Required skills: ${(job?.required_skills ?? []).join(', ')}

Candidate: ${candidate.full_name}
Role: ${candidate.candidate_role}
Summary: ${candidate.summary}
Skills: ${(candidate.skills ?? []).join(', ')}
Experience highlights: ${(candidate.highlights ?? []).join('; ')}
Overall score: ${candidate.scores?.overallScore ?? 'N/A'}
Interview flags: ${(candidate.scores?.flags ?? []).join('; ') || 'none'}`
  }], systemPrompt, 1200)

  return JSON.parse(result.replace(/```json|```/g, '').trim())
}

export async function generateReengagementEmail(candidate, job) {
  const systemPrompt = `You are a recruiter writing a brief, warm re-engagement message to a candidate who started but did not complete their video interview. Keep it under 120 words. Be encouraging, not pushy.

Return ONLY valid JSON:
{
  "subject": "email subject line",
  "body": "email body"
}`

  const result = await callClaude([{
    role: 'user',
    content: `Candidate: ${candidate.full_name}
Role applied for: ${job?.title ?? 'the role'}
Company: ${job?.company_name ?? 'our client'}
Days since applied: ${candidate.created_at ? Math.floor((Date.now() - new Date(candidate.created_at)) / 86400000) : 'unknown'}`
  }], systemPrompt, 400)

  return JSON.parse(result.replace(/```json|```/g, '').trim())
}

export async function generateReferenceQuestions(candidate) {
  const systemPrompt = `You are a senior recruiter preparing tailored reference check questions for a candidate. Generate exactly 5 questions that probe the specific red flags and claims from their interview. Be specific and behavioural.

Return ONLY valid JSON:
{
  "questions": [
    {"question": "...", "rationale": "why this question matters"}
  ]
}`

  const scores = candidate.scores ?? {}
  const result = await callClaude([{
    role: 'user',
    content: `Candidate: ${candidate.full_name}
Role: ${candidate.candidate_role}
Interview red flags: ${(scores.redFlags ?? scores.flags ?? []).join('; ') || 'none noted'}
Questionable skills: ${(scores.skillsVerification?.questionable ?? []).join(', ') || 'none'}
Recommendation: ${scores.recommendation ?? 'N/A'}
Insight: ${scores.insight ?? 'N/A'}`
  }], systemPrompt, 800)

  return JSON.parse(result.replace(/```json|```/g, '').trim())
}

export async function analyzeJDQuality(jd) {
  const systemPrompt = `You are a talent acquisition expert. Score this job description on three dimensions, each 0-100. Be critical and specific.

Return ONLY valid JSON:
{
  "clarity": 0,
  "clarityFeedback": "one sentence",
  "realism": 0,
  "realismFeedback": "one sentence",
  "competitiveness": 0,
  "competitivenessFeedback": "one sentence",
  "overallScore": 0,
  "topSuggestion": "the single most impactful improvement"
}`

  const result = await callClaude([{
    role: 'user',
    content: `Title: ${jd.title}
Experience required: ${jd.experience_years ?? '?'} years
Required skills: ${(jd.required_skills ?? []).join(', ')}
Preferred skills: ${(jd.preferred_skills ?? []).join(', ')}
Salary: ${jd.salary_min ?? '?'} – ${jd.salary_max ?? '?'} ${jd.salary_currency ?? ''}
Description: ${jd.description ?? ''}`
  }], systemPrompt, 600)

  return JSON.parse(result.replace(/```json|```/g, '').trim())
}

export async function generateShortlistSummary(candidates, job) {
  const systemPrompt = `You are a senior recruiter writing a concise executive briefing for a client. Summarise the shortlisted candidates in exactly 150 words. Be direct and commercial — no filler.

Return ONLY valid JSON:
{
  "summary": "150-word briefing",
  "topPick": "candidate name and one-line reason",
  "watchOut": "one risk or caveat for the client"
}`

  const candidateSummaries = candidates.map((c, i) =>
    `${i + 1}. ${c.full_name} — ${c.candidate_role}, score ${c.scores?.overallScore ?? 'N/A'}/10, recommendation: ${c.scores?.recommendation ?? 'N/A'}. ${c.scores?.insight ?? ''}`
  ).join('\n')

  const result = await callClaude([{
    role: 'user',
    content: `Role: ${job?.title ?? 'Unknown'} for ${job?.company_name ?? 'client'}
Required skills: ${(job?.required_skills ?? []).join(', ')}

Shortlisted candidates:
${candidateSummaries}`
  }], systemPrompt, 600)

  return JSON.parse(result.replace(/```json|```/g, '').trim())
}

export async function diagnosePipelineHealth(job, candidates) {
  const systemPrompt = `You are a recruitment pipeline analyst. Diagnose why this role may be stalling and recommend concrete actions.

Return ONLY valid JSON:
{
  "diagnosis": "2-3 sentence assessment of the pipeline health",
  "bottleneck": "Sourcing|Screening|Interview Completion|Client Feedback|Offer",
  "actions": ["action 1", "action 2", "action 3"],
  "urgency": "Low|Medium|High|Critical",
  "estimatedTimeToFill": "e.g. 2-3 weeks with correct action"
}`

  const staged = { sourced: 0, screened: 0, interviewed: 0, shortlisted: 0, offered: 0 }
  for (const c of candidates) {
    const s = c.pipeline_stage ?? c.status ?? ''
    if (s === 'sourced')     staged.sourced++
    if (s === 'screened')    staged.screened++
    if (s === 'interview')   staged.interviewed++
    if (s === 'shortlisted') staged.shortlisted++
    if (s === 'offered')     staged.offered++
  }

  const result = await callClaude([{
    role: 'user',
    content: `Role: ${job?.title ?? 'Unknown'} (open ${job?.created_at ? Math.floor((Date.now() - new Date(job.created_at)) / 86400000) : '?'} days)
Required skills: ${(job?.required_skills ?? []).join(', ')}
Experience: ${job?.experience_years ?? '?'}+ years
Salary range: ${job?.salary_min ?? '?'}–${job?.salary_max ?? '?'} ${job?.salary_currency ?? ''}

Pipeline stages:
- Sourced: ${staged.sourced}
- Screened: ${staged.screened}
- Interviewed: ${staged.interviewed}
- Shortlisted: ${staged.shortlisted}
- Offered: ${staged.offered}
- Total candidates: ${candidates.length}
- Avg score: ${candidates.filter(c => c.scores?.overallScore).length > 0
    ? (candidates.reduce((s, c) => s + (c.scores?.overallScore ?? 0), 0) / candidates.filter(c => c.scores?.overallScore).length).toFixed(1)
    : 'N/A'}`
  }], systemPrompt, 700)

  return JSON.parse(result.replace(/```json|```/g, '').trim())
}
