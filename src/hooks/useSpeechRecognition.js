/**
 * Browser Speech-to-Text (Web Speech API) for live interview answers.
 * Chrome/Edge/Safari — requires HTTPS (localhost OK).
 */
export function isSpeechRecognitionSupported() {
  return typeof window !== 'undefined' &&
    !!(window.SpeechRecognition || window.webkitSpeechRecognition)
}

export function createSpeechRecognizer({ lang = 'en-GB', onUpdate, onError } = {}) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
  if (!SpeechRecognition) return null

  const recognition = new SpeechRecognition()
  recognition.continuous = true
  recognition.interimResults = true
  recognition.lang = lang

  let finalText = ''
  let running = false

  recognition.onresult = (event) => {
    let interim = ''
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const text = event.results[i][0]?.transcript ?? ''
      if (event.results[i].isFinal) finalText += text + ' '
      else interim += text
    }
    onUpdate?.({
      final: finalText.trim(),
      interim: interim.trim(),
      combined: `${finalText}${interim}`.trim(),
    })
  }

  recognition.onerror = (event) => {
    if (event.error === 'no-speech' || event.error === 'aborted') return
    onError?.(event.error)
  }

  recognition.onend = () => {
    running = false
  }

  return {
    start() {
      finalText = ''
      if (running) return
      try {
        recognition.start()
        running = true
      } catch {
        // start() throws if already running — safe to ignore
      }
    },
    stop() {
      try { recognition.stop() } catch { /* ignore */ }
      running = false
      return finalText.trim()
    },
    abort() {
      try { recognition.abort() } catch { /* ignore */ }
      running = false
      finalText = ''
    },
    getText() {
      return finalText.trim()
    },
  }
}
