function slugify(text, fallback = 'item') {
  return (text ?? '')
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '') || fallback
}

export function normalizeJobTitle(title) {
  return (title ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

/** True when two role titles refer to the same job (fuzzy match). */
export function jobTitlesMatch(a, b) {
  const na = normalizeJobTitle(a)
  const nb = normalizeJobTitle(b)
  if (!na || !nb) return false
  return na === nb || na.includes(nb) || nb.includes(na)
}

/** Sanitize candidate + role for a safe filename. */
export function interviewMarkdownFilename(candidateName, jobTitle) {
  const nameSlug = slugify(candidateName, 'candidate')
  const jobSlug = slugify(jobTitle, 'role').slice(0, 48)
  const ts = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '-')
  return `${nameSlug}_${jobSlug}_${ts}.md`
}

/** Build markdown Q&A from interview questions + STT transcripts. */
export function buildInterviewMarkdown({ candidateName, jobTitle, questions = [], transcripts = [] }) {
  const lines = [
    `# Interview Transcript — ${candidateName ?? 'Candidate'}`,
    '',
    `**Role:** ${jobTitle ?? 'N/A'}`,
    `**Date:** ${new Date().toLocaleString('en-GB')}`,
    '',
    '---',
    '',
  ]

  questions.forEach((q, i) => {
    const questionText = typeof q === 'string' ? q : q?.q ?? `Question ${i + 1}`
    const answer = (transcripts[i] ?? '').trim() || '*(No speech captured)*'
    lines.push(`## Question ${i + 1}`, '')
    lines.push('**Interviewer:**', '')
    lines.push(questionText, '')
    lines.push('**Candidate:**', '')
    lines.push(answer, '')
    lines.push('---', '')
  })

  return lines.join('\n')
}

export function downloadMarkdownFile(filename, content) {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function extractRoleFromMarkdown(content) {
  const m = content?.match(/\*\*Role:\*\*\s*(.+)/)
  return m?.[1]?.trim() ?? ''
}

export async function saveInterviewMarkdownFile({ candidateName, jobTitle, questions, transcripts }) {
  const content = buildInterviewMarkdown({ candidateName, jobTitle, questions, transcripts })
  const filename = interviewMarkdownFilename(candidateName, jobTitle)

  downloadMarkdownFile(filename, content)

  if (!import.meta.env.DEV) {
    return { ok: true, filename, savedToProject: false, downloaded: true }
  }

  try {
    const res = await fetch('/api/dev/save-interview-md', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename, content }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(json.error ?? 'Save failed')
    return { ok: true, filename, path: json.path, savedToProject: true, downloaded: true }
  } catch (err) {
    return { ok: true, filename, savedToProject: false, downloaded: true, error: err.message }
  }
}

/** Parse saved .md back into chat messages for the recruiter transcript view. */
export function parseInterviewMarkdown(content) {
  if (!content?.trim()) return []
  const messages = []
  const blocks = content.split(/^## Question \d+/m).slice(1)
  for (const block of blocks) {
    const qMatch = block.match(/\*\*Interviewer:\*\*\s*\n+([\s\S]*?)\n+\*\*Candidate:\*\*/)
    const aMatch = block.match(/\*\*Candidate:\*\*\s*\n+([\s\S]*?)(?:\n---|\n*$)/)
    const question = qMatch?.[1]?.trim()
    let answer = aMatch?.[1]?.trim() ?? ''
    if (answer === '*(No speech captured)*') answer = '(No speech captured)'
    if (question) messages.push({ role: 'assistant', content: question, source: 'video' })
    if (question) messages.push({ role: 'user', content: answer || '(No speech captured)', source: 'video' })
  }
  return messages
}

/** Dev: load interview-files transcript for this candidate + job role only. */
export async function fetchDevInterviewTranscript(candidateName, jobTitle) {
  if (!import.meta.env.DEV || !candidateName || !jobTitle) return null
  try {
    const qs = new URLSearchParams({
      name: candidateName,
      jobTitle,
    })
    const res = await fetch(`/api/dev/interview-transcript?${qs}`)
    if (!res.ok) return null
    const json = await res.json()
    if (!json?.content) return null
    return {
      filename: json.filename,
      path: json.path,
      role: json.role ?? extractRoleFromMarkdown(json.content),
      messages: parseInterviewMarkdown(json.content),
    }
  } catch {
    return null
  }
}
