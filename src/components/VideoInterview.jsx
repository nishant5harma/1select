import { useState, useEffect, useRef, useCallback } from 'react'
import { resolveInterviewQuestions } from '../utils/api'
import { buildTranscriptFromVideoUrls } from '../utils/interviewTranscript'
import { saveInterviewMarkdownFile } from '../utils/interviewMarkdown'
import { createSpeechRecognizer, isSpeechRecognitionSupported } from '../hooks/useSpeechRecognition'
import { supabase } from '../lib/supabase'

// ── Stage constants ───────────────────────────────────────────────────────────
const S = {
  SETUP:        'setup',
  DEVICE_CHECK: 'device_check',
  LOADING:      'loading',
  READY:        'ready',
  COUNTDOWN:    'countdown',
  RECORDING:    'recording',
  BETWEEN:      'between',
  UPLOADING:    'uploading',
  DONE:         'done',
  ERROR:        'error',
}

// ── Integrity penalties ───────────────────────────────────────────────────────
const PENALTY = { tab_switch: 15, window_blur: 5, right_click: 3, screenshot: 10, copy: 3 }

// ── Best supported mime type ──────────────────────────────────────────────────
function bestMime() {
  const types = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4']
  return types.find(t => { try { return MediaRecorder.isTypeSupported(t) } catch { return false } }) || 'video/webm'
}

// ── Upload one blob to Supabase Storage ───────────────────────────────────────
async function uploadBlob(blob, matchId, idx) {
  const ext = (blob.type || '').includes('mp4') ? 'mp4' : 'webm'
  const path = `${matchId}/q${idx}_${Date.now()}.${ext}`
  const { error } = await supabase.storage
    .from('video-interviews')
    .upload(path, blob, { contentType: blob.type || 'video/webm', upsert: true })
  if (error) throw new Error(error.message)
  const { data: { publicUrl } } = supabase.storage.from('video-interviews').getPublicUrl(path)
  return publicUrl
}

// ── Timer ring SVG ────────────────────────────────────────────────────────────
function TimerRing({ seconds, total, size = 64 }) {
  const r = size / 2 - 5
  const circ = 2 * Math.PI * r
  const pct = total > 0 ? seconds / total : 1
  const fill = pct * circ
  const color = pct > 0.5 ? 'var(--green)' : pct > 0.2 ? 'var(--amber)' : 'var(--red)'
  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="5"/>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth="5"
          strokeDasharray={`${fill} ${circ}`} strokeLinecap="round" transform={`rotate(-90 ${size/2} ${size/2})`}/>
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-mono)', fontSize: size * 0.28, fontWeight: 700, color }}>
        {seconds}
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function VideoInterview({ job, candidate, matchId, isFromPool, onClose, onComplete, onSave }) {
  const [stage,          setStage]          = useState(S.SETUP)
  const [questions,      setQuestions]      = useState([])
  const [currentQ,       setCurrentQ]       = useState(0)
  const [timeLeft,       setTimeLeft]       = useState(0)
  const [countdown,      setCountdown]      = useState(3)
  const [uploadProgress, setUploadProgress] = useState([])  // 'pending'|'uploading'|'done'|'error'
  const [warning,        setWarning]        = useState('')
  const [error,          setError]          = useState('')
  const [errorMsg,       setErrorMsg]       = useState('')
  const [retryFn,        setRetryFn]        = useState(null)
  const [camOk,          setCamOk]          = useState(false)
  const [micLevel,       setMicLevel]       = useState(0)
  const [liveTranscript, setLiveTranscript] = useState('')
  const [sttSupported,   setSttSupported]   = useState(false)
  const [devMdPath,      setDevMdPath]      = useState(null)

  // Refs — values needed in callbacks without causing re-renders
  const videoRef      = useRef(null)   // <video> element for camera preview
  const streamRef     = useRef(null)   // MediaStream
  const recorderRef   = useRef(null)   // MediaRecorder
  const chunksRef     = useRef([])     // chunks for current question
  const blobsRef      = useRef([])     // final blobs per question
  const transcriptsRef = useRef([])    // STT text per question
  const sttRef        = useRef(null)   // active SpeechRecognition session
  const violationsRef = useRef([])     // anti-cheating events
  const currentQRef   = useRef(0)      // mirrors currentQ for callbacks
  const stageRef      = useRef(S.SETUP)
  const timerRef      = useRef(null)
  const warnTimerRef  = useRef(null)
  const audioCtxRef   = useRef(null)
  const micRafRef     = useRef(null)

  // Keep refs in sync
  useEffect(() => { currentQRef.current = currentQ }, [currentQ])
  useEffect(() => { stageRef.current = stage }, [stage])
  useEffect(() => { setSttSupported(isSpeechRecognitionSupported()) }, [])

  function stopSpeechRecognition() {
    if (!sttRef.current) return ''
    const text = sttRef.current.stop() || sttRef.current.getText() || ''
    sttRef.current = null
    setLiveTranscript('')
    return text.trim()
  }

  function startSpeechRecognition() {
    if (!sttSupported) return
    sttRef.current?.abort()
    setLiveTranscript('')
    const rec = createSpeechRecognizer({
      lang: 'en-GB',
      onUpdate: ({ combined }) => setLiveTranscript(combined),
    })
    if (!rec) return
    sttRef.current = rec
    rec.start()
  }

  // ── Camera setup ──────────────────────────────────────────────────────────
  async function initCamera() {
    setError('')
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Camera access requires a secure (HTTPS) connection and a modern browser. Please check your browser settings and try again.')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        videoRef.current.muted = true
      }
      setCamOk(true)
      startMicMonitor(stream)
      setStage(S.DEVICE_CHECK)
    } catch (e) {
      setError(e.name === 'NotAllowedError'
        ? 'Camera and microphone access is required for the video interview. Please allow access and try again.'
        : 'Could not start camera: ' + e.message)
    }
  }

  function startMicMonitor(stream) {
    try {
      const ctx = new AudioContext()
      audioCtxRef.current = ctx
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      ctx.createMediaStreamSource(stream).connect(analyser)
      const buf = new Uint8Array(analyser.frequencyBinCount)
      const tick = () => {
        analyser.getByteFrequencyData(buf)
        const avg = buf.reduce((a, b) => a + b, 0) / buf.length
        setMicLevel(Math.min(100, Math.round(avg * 2.2)))
        micRafRef.current = requestAnimationFrame(tick)
      }
      tick()
    } catch { /* silently ignore if AudioContext unavailable */ }
  }

  function stopMicMonitor() {
    if (micRafRef.current) cancelAnimationFrame(micRafRef.current)
    audioCtxRef.current?.close().catch(() => {})
    setMicLevel(0)
  }

  async function confirmDevices() {
    stopMicMonitor()
    setStage(S.LOADING)
    try {
      const customQs = resolveInterviewQuestions(job)
      setQuestions(customQs)
      setUploadProgress(customQs.map(() => 'pending'))
      setStage(S.READY)
    } catch {
      setErrorMsg('Could not load interview questions. Please try again.')
      setRetryFn(() => confirmDevices)
      setStage(S.ERROR)
    }
  }

  // Attach stream to video element when stage changes (a new <video> element may have mounted)
  useEffect(() => {
    if (videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current
      videoRef.current.muted = true
    }
  }, [stage])

  // ── Cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      clearTimeout(timerRef.current)
      clearTimeout(warnTimerRef.current)
      sttRef.current?.abort()
      recorderRef.current?.stop()
      streamRef.current?.getTracks().forEach(t => t.stop())
      if (micRafRef.current) cancelAnimationFrame(micRafRef.current)
      audioCtxRef.current?.close().catch(() => {})
    }
  }, [])

  // ── Anti-cheating monitors ────────────────────────────────────────────────
  const flag = useCallback((type, label) => {
    if (stageRef.current !== S.RECORDING && stageRef.current !== S.BETWEEN) return
    violationsRef.current.push({ type, label, q: currentQRef.current, time: new Date().toISOString() })
    setWarning(label)
    clearTimeout(warnTimerRef.current)
    warnTimerRef.current = setTimeout(() => setWarning(''), 3500)
  }, [])

  useEffect(() => {
    const onVis  = () => { if (document.hidden)    flag('tab_switch',  '⚠ Tab switch detected') }
    const onBlur = () => {                          flag('window_blur', '⚠ Window focus lost') }
    const onCtx  = (e) => {e.preventDefault();     flag('right_click', '⚠ Right-click blocked') }
    const onKey  = (e) => {
      if (e.key === 'PrintScreen')                  flag('screenshot',  '⚠ Screenshot attempt detected')
      if ((e.ctrlKey || e.metaKey) && e.key === 'c') flag('copy',      '⚠ Copy attempt blocked')
    }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('blur', onBlur)
    document.addEventListener('contextmenu', onCtx)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('contextmenu', onCtx)
      document.removeEventListener('keydown', onKey)
    }
  }, [flag])

  // ── Timer countdown ───────────────────────────────────────────────────────
  useEffect(() => {
    if (stage !== S.RECORDING) return
    if (timeLeft <= 0) { handleStopAnswer(); return }
    timerRef.current = setTimeout(() => setTimeLeft(t => t - 1), 1000)
    return () => clearTimeout(timerRef.current)
  }, [stage, timeLeft])

  // ── Countdown 3-2-1 ──────────────────────────────────────────────────────
  useEffect(() => {
    if (stage !== S.COUNTDOWN) return
    if (countdown <= 0) { beginRecording(); return }
    timerRef.current = setTimeout(() => setCountdown(c => c - 1), 1000)
    return () => clearTimeout(timerRef.current)
  }, [stage, countdown])

  // ── Handlers ─────────────────────────────────────────────────────────────

  function startCountdown() {
    setCountdown(3)
    setStage(S.COUNTDOWN)
  }

  function beginRecording() {
    if (!streamRef.current) return
    const mime = bestMime()
    const mr = new MediaRecorder(streamRef.current, mime ? { mimeType: mime } : {})
    chunksRef.current = []
    mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
    mr.start(500)
    recorderRef.current = mr
    setTimeLeft(questions[currentQRef.current]?.seconds ?? 120)
    startSpeechRecognition()
    setStage(S.RECORDING)
  }

  async function handleStopAnswer() {
    clearTimeout(timerRef.current)
    setStage(S.BETWEEN)

    const transcript = stopSpeechRecognition()
    transcriptsRef.current[currentQRef.current] = transcript

    // Finalize recording
    await new Promise(resolve => {
      const mr = recorderRef.current
      if (!mr || mr.state === 'inactive') { resolve(); return }
      mr.onstop = resolve
      mr.stop()
    })
    const mime = recorderRef.current?.mimeType || 'video/webm'
    blobsRef.current[currentQRef.current] = new Blob(chunksRef.current, { type: mime })

    const nextQ = currentQRef.current + 1
    if (nextQ < questions.length) {
      // Pause 3 seconds then move to next question countdown
      timerRef.current = setTimeout(() => {
        setCurrentQ(nextQ)
        setCountdown(3)
        setStage(S.COUNTDOWN)
      }, 3000)
    } else {
      // All done — upload
      timerRef.current = setTimeout(() => startUpload(), 1500)
    }
  }

  async function startUpload() {
    setStage(S.UPLOADING)
    const urls = []
    const prog = questions.map(() => 'pending')
    setUploadProgress([...prog])

    for (let i = 0; i < questions.length; i++) {
      prog[i] = 'uploading'
      setUploadProgress([...prog])
      try {
        const url = await uploadBlob(blobsRef.current[i], matchId, i)
        urls.push({
          q: questions[i].q,
          url,
          transcript: transcriptsRef.current[i]?.trim() ?? '',
        })
        prog[i] = 'done'
      } catch {
        urls.push({
          q: questions[i].q,
          url: null,
          transcript: transcriptsRef.current[i]?.trim() ?? '',
        })
        prog[i] = 'error'
      }
      setUploadProgress([...prog])
    }

    const interview_transcript = buildTranscriptFromVideoUrls(urls)

    // Calculate integrity score
    const deductions = violationsRef.current.reduce((s, v) => s + (PENALTY[v.type] || 5), 0)
    const integrityScore = Math.max(0, 100 - deductions)

    // Save to DB
    const update = {
      video_urls: urls,
      interview_transcript,
      integrity_score: integrityScore,
      integrity_flags: violationsRef.current,
      interviewed_at: new Date().toISOString(),
    }
    try {
      if (onSave) {
        await onSave(update)
      } else {
        const table = isFromPool ? 'job_matches' : 'candidates'
        await supabase.from(table).update(update).eq('id', matchId)
      }
    } catch {
      setErrorMsg('Upload failed. Please check your connection and try again.')
      setRetryFn(() => startUpload)
      setStage(S.ERROR)
      return
    }

    const mdResult = await saveInterviewMarkdownFile({
      candidateName: candidate.full_name,
      jobTitle: job?.title,
      questions,
      transcripts: transcriptsRef.current,
    })
    if (mdResult.savedToProject) setDevMdPath(mdResult.path)

    setStage(S.DONE)
    onComplete({ video_urls: urls, interview_transcript, integrity_score: integrityScore, integrity_flags: violationsRef.current })
  }

  // ── Shared dark overlay styles ────────────────────────────────────────────
  const overlay = {
    position: 'fixed', inset: 0, background: '#0a0a0f', zIndex: 2000,
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    color: '#fff', fontFamily: 'var(--font-body)',
  }
  const mono = { fontFamily: 'var(--font-mono)' }

  const integrityScore = Math.max(0, 100 - violationsRef.current.reduce((s, v) => s + (PENALTY[v.type] || 5), 0))

  // ── SETUP ─────────────────────────────────────────────────────────────────
  if (stage === S.SETUP) return (
    <div style={overlay}>
      <button onClick={() => { streamRef.current?.getTracks().forEach(t => t.stop()); onClose() }}
        style={{ position: 'absolute', top: 24, right: 28, background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.4)', fontSize: 22 }}>✕</button>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 40, maxWidth: 860, width: '100%', padding: '0 40px' }}>
        {/* Camera preview */}
        <div style={{ aspectRatio: '4/3', background: '#111', borderRadius: 12, overflow: 'hidden', position: 'relative' }}>
          <video ref={videoRef} autoPlay playsInline muted
            style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)', display: camOk ? 'block' : 'none' }} />
          {!camOk && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.3)', gap: 10 }}>
              <div style={{ fontSize: 40 }}>📷</div>
              <div style={{ fontSize: 13 }}>Camera preview</div>
            </div>
          )}
        </div>

        {/* Instructions */}
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 20 }}>
          <div>
            <div style={{ fontSize: 11, ...mono, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'rgba(255,255,255,0.35)', marginBottom: 6 }}>Video Interview</div>
            <h2 style={{ fontSize: 22, fontWeight: 300, margin: '0 0 6px', fontFamily: 'var(--font-head)' }}>{job?.title ?? 'Interview'}</h2>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>{candidate.full_name} · {candidate.candidate_role}</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[
              ['5 questions', 'Mix of technical and behavioral'],
              ['90–120 seconds', 'Per question — timer visible'],
              ['Recorded & monitored', 'Tab switches and focus loss are flagged'],
              ['One take', 'No pausing or re-recording'],
            ].map(([title, desc]) => (
              <div key={title} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)', marginTop: 5, flexShrink: 0 }} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'rgba(255,255,255,0.85)' }}>{title}</div>
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>{desc}</div>
                </div>
              </div>
            ))}
          </div>
          {error && <div style={{ fontSize: 12, color: 'var(--red)', background: 'rgba(239,68,68,0.1)', padding: '10px 14px', borderRadius: 8, lineHeight: 1.5 }}>{error}</div>}
          <button
            onClick={initCamera}
            style={{ padding: '13px 24px', borderRadius: 8, background: 'var(--accent)', color: '#0F0F0F', border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 500 }}
          >Allow Camera & Start →</button>
        </div>
      </div>
    </div>
  )

  // ── DEVICE CHECK ─────────────────────────────────────────────────────────
  if (stage === S.DEVICE_CHECK) return (
    <div style={overlay}>
      <button onClick={() => { stopMicMonitor(); streamRef.current?.getTracks().forEach(t => t.stop()); onClose() }}
        style={{ position: 'absolute', top: 24, right: 28, background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.4)', fontSize: 22 }}>✕</button>

      <div style={{ maxWidth: 460, width: '100%', padding: '0 32px', display: 'flex', flexDirection: 'column', gap: 22 }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 10, ...mono, textTransform: 'uppercase', letterSpacing: '0.16em', color: 'rgba(255,255,255,0.35)', marginBottom: 8 }}>Device Check</div>
          <h2 style={{ fontWeight: 300, fontSize: 22, margin: 0 }}>Camera &amp; Microphone</h2>
          <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)', marginTop: 8, lineHeight: 1.6 }}>Confirm you can see yourself clearly and the mic bar moves when you speak.</p>
        </div>

        <div style={{ aspectRatio: '16/9', background: '#111', borderRadius: 10, overflow: 'hidden' }}>
          <video ref={videoRef} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }} />
        </div>

        <div>
          <div style={{ fontSize: 11, ...mono, color: 'rgba(255,255,255,0.35)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Microphone Level</div>
          <div style={{ height: 8, background: 'rgba(255,255,255,0.08)', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${micLevel}%`, background: micLevel < 5 ? 'var(--red)' : micLevel < 30 ? 'var(--amber)' : 'var(--green)', borderRadius: 4, transition: 'width 0.07s ease, background 0.3s' }} />
          </div>
          {micLevel < 4 && (
            <p style={{ fontSize: 11, color: 'var(--amber)', marginTop: 6, margin: '6px 0 0' }}>No audio detected — speak to test your mic</p>
          )}
        </div>

        <button onClick={confirmDevices}
          style={{ padding: '13px 0', background: 'var(--accent)', color: '#0F0F0F', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 14, ...mono, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          Camera &amp; Mic Working — Continue →
        </button>
      </div>
    </div>
  )

  // ── LOADING ───────────────────────────────────────────────────────────────
  if (stage === S.LOADING) return (
    <div style={overlay}>
      <span className="spinner" style={{ width: 40, height: 40, borderColor: 'rgba(255,255,255,0.15)', borderTopColor: 'var(--accent)', borderWidth: 3 }} />
      <div style={{ marginTop: 20, fontSize: 14, color: 'rgba(255,255,255,0.5)' }}>Preparing your interview…</div>
    </div>
  )

  // ── READY ─────────────────────────────────────────────────────────────────
  if (stage === S.READY) return (
    <div style={overlay}>
      {/* Small camera PiP */}
      <div style={{ position: 'absolute', top: 24, right: 24, width: 140, height: 100, borderRadius: 10, overflow: 'hidden', border: '2px solid rgba(255,255,255,0.1)' }}>
        <video ref={videoRef} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }} />
      </div>
      <button onClick={() => { streamRef.current?.getTracks().forEach(t => t.stop()); onClose() }}
        style={{ position: 'absolute', top: 24, left: 28, background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.3)', fontSize: 22 }}>✕</button>

      <div style={{ maxWidth: 520, textAlign: 'center', padding: '0 32px' }}>
        <div style={{ fontSize: 11, ...mono, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'rgba(255,255,255,0.35)', marginBottom: 14 }}>Ready to begin</div>
        <h2 style={{ fontSize: 24, fontWeight: 300, fontFamily: 'var(--font-head)', margin: '0 0 10px' }}>You have {questions.length} questions</h2>
        <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)', marginBottom: 32, lineHeight: 1.7 }}>
          Answer each question naturally and concisely. Stay in this window throughout. The recording starts after a 3-second countdown per question.
          {sttSupported && ' Your spoken answers will be transcribed automatically.'}
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 32, textAlign: 'left' }}>
          {questions.map((q, i) => (
            <div key={i} style={{ display: 'flex', gap: 12, padding: '10px 14px', background: 'rgba(255,255,255,0.04)', borderRadius: 8 }}>
              <span style={{ ...mono, fontSize: 11, color: 'var(--accent)', minWidth: 18 }}>Q{i+1}</span>
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', lineHeight: 1.5 }}>{q.q}</span>
              <span style={{ ...mono, fontSize: 10, color: 'rgba(255,255,255,0.25)', flexShrink: 0, marginTop: 2 }}>{q.seconds}s</span>
            </div>
          ))}
        </div>
        <button onClick={startCountdown}
          style={{ padding: '14px 40px', borderRadius: 8, background: 'var(--accent)', color: '#0F0F0F', border: 'none', cursor: 'pointer', fontSize: 15, fontWeight: 500 }}>
          Begin Interview →
        </button>
      </div>
    </div>
  )

  // ── COUNTDOWN ─────────────────────────────────────────────────────────────
  if (stage === S.COUNTDOWN) return (
    <div style={overlay}>
      <div style={{ position: 'absolute', top: 24, right: 24, width: 140, height: 100, borderRadius: 10, overflow: 'hidden', border: '2px solid rgba(255,255,255,0.1)' }}>
        <video ref={videoRef} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }} />
      </div>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 11, ...mono, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'rgba(255,255,255,0.3)', marginBottom: 16 }}>
          Question {currentQ + 1} of {questions.length}
        </div>
        <div style={{ fontSize: 120, fontWeight: 700, color: countdown <= 1 ? 'var(--red)' : '#fff', lineHeight: 1, marginBottom: 16, transition: 'color 0.3s' }}>
          {countdown > 0 ? countdown : '●'}
        </div>
        <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.4)' }}>Recording starts…</div>
      </div>
    </div>
  )

  // ── RECORDING ─────────────────────────────────────────────────────────────
  if (stage === S.RECORDING) {
    const q = questions[currentQ]
    const totalSecs = q?.seconds ?? 120
    return (
      <div style={{ ...overlay, justifyContent: 'flex-end' }}>
        {/* Full-screen camera */}
        <video ref={videoRef} autoPlay playsInline muted
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }} />
        {/* Dark gradient at bottom */}
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.1) 40%, transparent 60%)' }} />

        {/* Top bar */}
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, padding: '20px 28px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#ef4444', animation: 'pulse 1.5s infinite' }} />
            <span style={{ ...mono, fontSize: 12, color: 'rgba(255,255,255,0.7)' }}>REC · Q{currentQ + 1}/{questions.length}</span>
          </div>
          <TimerRing seconds={timeLeft} total={totalSecs} size={60} />
        </div>

        {/* Violation warning */}
        {warning && (
          <div style={{ position: 'absolute', top: 80, left: '50%', transform: 'translateX(-50%)', background: 'rgba(239,68,68,0.95)', color: '#fff', padding: '10px 20px', borderRadius: 8, fontSize: 13, fontWeight: 500, zIndex: 10, whiteSpace: 'nowrap' }}>
            {warning}
          </div>
        )}

        {/* Live caption bar */}
        {sttSupported && (
          <div style={{
            position: 'absolute',
            bottom: 140,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 'min(92%, 720px)',
            background: 'rgba(0,0,0,0.88)',
            border: '2px solid rgba(184,146,74,0.55)',
            borderRadius: 10,
            padding: '14px 22px',
            zIndex: 5,
            textAlign: 'center',
            boxShadow: '0 8px 32px rgba(0,0,0,0.45)',
          }}>
            <div style={{ fontSize: 9, ...mono, color: '#B8924A', marginBottom: 8, letterSpacing: '0.14em', textTransform: 'uppercase' }}>
              Live caption
            </div>
            <div style={{ fontSize: 17, color: liveTranscript ? '#fff' : 'rgba(255,255,255,0.45)', lineHeight: 1.55, fontWeight: liveTranscript ? 400 : 300 }}>
              {liveTranscript || 'Speak now — your words will appear here…'}
            </div>
          </div>
        )}

        {/* Question overlay */}
        <div style={{ position: 'relative', width: '100%', padding: '0 32px 32px', zIndex: 1 }}>
          <div style={{ fontSize: 10, ...mono, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'rgba(255,255,255,0.45)', marginBottom: 8 }}>
            {q?.type === 'technical' ? 'Technical Question' : 'Behavioral Question'}
          </div>
          <div style={{ fontSize: 18, fontWeight: 400, color: '#fff', lineHeight: 1.5, marginBottom: 20, maxWidth: 700 }}>
            {q?.q}
          </div>
          <button
            onClick={handleStopAnswer}
            style={{ padding: '10px 24px', borderRadius: 8, background: 'rgba(255,255,255,0.15)', color: '#fff', border: '1px solid rgba(255,255,255,0.25)', cursor: 'pointer', fontSize: 13, backdropFilter: 'blur(8px)' }}
          >Done answering →</button>
        </div>
      </div>
    )
  }

  // ── BETWEEN ───────────────────────────────────────────────────────────────
  if (stage === S.BETWEEN) {
    const isLast = currentQ >= questions.length - 1
    return (
      <div style={overlay}>
        <div style={{ position: 'absolute', top: 24, right: 24, width: 140, height: 100, borderRadius: 10, overflow: 'hidden', border: '2px solid rgba(255,255,255,0.1)' }}>
          <video ref={videoRef} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }} />
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>✓</div>
          <h3 style={{ fontFamily: 'var(--font-head)', fontWeight: 300, fontSize: 22, margin: '0 0 8px' }}>Answer saved</h3>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)' }}>
            {isLast ? 'Processing your final answer…' : `Question ${currentQ + 2} of ${questions.length} coming up…`}
          </div>
        </div>
      </div>
    )
  }

  // ── UPLOADING ─────────────────────────────────────────────────────────────
  if (stage === S.UPLOADING) return (
    <div style={overlay}>
      <div style={{ maxWidth: 400, width: '100%', padding: '0 32px' }}>
        <h3 style={{ fontFamily: 'var(--font-head)', fontWeight: 300, fontSize: 22, margin: '0 0 6px', textAlign: 'center' }}>Submitting your interview</h3>
        <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', textAlign: 'center', marginBottom: 32 }}>Uploading your video answers…</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {questions.map((q, i) => {
            const st = uploadProgress[i]
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 28, height: 28, borderRadius: '50%', border: `2px solid ${st === 'done' ? 'var(--green)' : st === 'error' ? 'var(--red)' : 'rgba(255,255,255,0.15)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  {st === 'done'      && <span style={{ color: 'var(--green)', fontSize: 14 }}>✓</span>}
                  {st === 'error'     && <span style={{ color: 'var(--red)', fontSize: 12 }}>✗</span>}
                  {st === 'uploading' && <span className="spinner" style={{ width: 12, height: 12, borderColor: 'rgba(255,255,255,0.15)', borderTopColor: '#fff', borderWidth: 2 }} />}
                  {st === 'pending'   && <span style={{ ...mono, fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>{i+1}</span>}
                </div>
                <div>
                  <div style={{ fontSize: 12, color: st === 'done' ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.35)', lineHeight: 1.3 }}>
                    {q.q.slice(0, 60)}{q.q.length > 60 ? '…' : ''}
                  </div>
                  <div style={{ fontSize: 10, ...mono, color: st === 'done' ? 'var(--green)' : st === 'error' ? 'var(--red)' : st === 'uploading' ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.2)' }}>
                    {st === 'done' ? 'uploaded' : st === 'error' ? 'failed' : st === 'uploading' ? 'uploading…' : 'waiting'}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )

  // ── DONE ─────────────────────────────────────────────────────────────────
  if (stage === S.DONE) {
    const scoreColor = integrityScore >= 80 ? 'var(--green)' : integrityScore >= 50 ? 'var(--amber)' : 'var(--red)'
    const scoreLabel = integrityScore >= 80 ? 'High Integrity' : integrityScore >= 50 ? 'Some Concerns' : 'Flagged'
    return (
      <div style={overlay}>
        <div style={{ maxWidth: 500, width: '100%', padding: '0 32px', textAlign: 'center' }}>
          <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'rgba(34,197,94,0.12)', border: '2px solid rgba(34,197,94,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px', fontSize: 28 }}>✓</div>
          <h2 style={{ fontFamily: 'var(--font-head)', fontWeight: 300, fontSize: 26, margin: '0 0 8px' }}>Interview Complete</h2>
          <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)', marginBottom: 28, lineHeight: 1.6 }}>
            All {questions.length} answers have been recorded and submitted.
          </p>

          <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '18px 20px', marginBottom: 16, textAlign: 'left' }}>
            <div style={{ fontSize: 10, ...mono, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'rgba(255,255,255,0.25)', marginBottom: 14 }}>What happens next</div>
            {[
              'A recruiter reviews your responses — typically within 2 business days',
              'You\'ll receive an email update regardless of the outcome',
              'If progressed, your recruiter will reach out to discuss next steps',
            ].map((step, i) => (
              <div key={i} style={{ display: 'flex', gap: 12, marginBottom: i < 2 ? 10 : 0, alignItems: 'flex-start' }}>
                <div style={{ width: 18, height: 18, borderRadius: '50%', background: 'var(--accent-d)', border: '1px solid var(--accent-d2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 10, ...mono, color: 'var(--accent)', marginTop: 1 }}>{i + 1}</div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', lineHeight: 1.6 }}>{step}</div>
              </div>
            ))}
          </div>

          <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, padding: '14px 18px', marginBottom: 24, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontSize: 11, ...mono, color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Integrity</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 20, fontWeight: 700, color: scoreColor }}>{integrityScore}</span>
              <span style={{ fontSize: 12, color: scoreColor }}>{scoreLabel}</span>
            </div>
          </div>

          {devMdPath && import.meta.env.DEV && (
            <div style={{ background: 'rgba(184,146,74,0.12)', border: '1px solid rgba(184,146,74,0.35)', borderRadius: 8, padding: '12px 16px', marginBottom: 20, fontSize: 11, ...mono, color: 'rgba(255,255,255,0.65)', lineHeight: 1.6 }}>
              Transcript saved to <strong style={{ color: '#B8924A' }}>{devMdPath}</strong>
            </div>
          )}

          <button onClick={() => { streamRef.current?.getTracks().forEach(t => t.stop()); onClose() }}
            style={{ padding: '13px 32px', borderRadius: 8, background: 'var(--accent)', color: '#0F0F0F', border: 'none', cursor: 'pointer', fontSize: 14 }}>
            Close
          </button>
        </div>
      </div>
    )
  }

  // ── ERROR ─────────────────────────────────────────────────────────────────
  if (stage === S.ERROR) return (
    <div style={overlay}>
      <div style={{ maxWidth: 440, width: '100%', padding: '0 32px', textAlign: 'center' }}>
        <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'rgba(239,68,68,0.12)', border: '2px solid rgba(239,68,68,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px', fontSize: 24, color: 'var(--red)' }}>✗</div>
        <h2 style={{ fontFamily: 'var(--font-head)', fontWeight: 300, fontSize: 22, margin: '0 0 10px' }}>Something went wrong</h2>
        <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)', marginBottom: 28, lineHeight: 1.6 }}>{errorMsg}</p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
          {retryFn && (
            <button
              onClick={() => retryFn()}
              style={{ padding: '11px 28px', borderRadius: 8, background: 'var(--accent)', color: '#0F0F0F', border: 'none', cursor: 'pointer', fontSize: 13 }}
            >
              Retry
            </button>
          )}
          <button
            onClick={() => { streamRef.current?.getTracks().forEach(t => t.stop()); onClose() }}
            style={{ padding: '11px 28px', borderRadius: 8, background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.6)', border: '1px solid rgba(255,255,255,0.12)', cursor: 'pointer', fontSize: 13 }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )

  return null
}
