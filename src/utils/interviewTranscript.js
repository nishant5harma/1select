/** Build chat-style transcript from video interview answers (STT). */
export function buildTranscriptFromVideoUrls(videoUrls = []) {
  const messages = []
  for (const entry of videoUrls) {
    if (!entry?.q) continue
    messages.push({ role: 'assistant', content: entry.q, source: 'video' })
    const answer = entry?.transcript?.trim()
    messages.push({
      role: 'user',
      content: answer || '(No speech captured)',
      source: 'video',
    })
  }
  return messages
}

/** Prefer stored interview_transcript; fall back to video_urls STT fields. */
export function getVideoInterviewTranscript(candidate) {
  const stored = candidate?.interview_transcript
  if (Array.isArray(stored) && stored.some(m => m?.source === 'video')) {
    return stored.filter(m => m?.source === 'video')
  }
  return buildTranscriptFromVideoUrls(candidate?.video_urls ?? [])
}

export function hasVideoInterviewTranscript(candidate) {
  if (candidate?.video_urls?.some(v => v?.q)) return true
  return getVideoInterviewTranscript(candidate).length > 0
}
