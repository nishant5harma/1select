import { useState, useRef, useEffect } from 'react'
import { getVideoInterviewTranscript, hasVideoInterviewTranscript } from '../utils/interviewTranscript'

const INTEGRITY_COLOR = (s) => s >= 80 ? 'var(--green)' : s >= 50 ? 'var(--amber)' : 'var(--red)'
const INTEGRITY_LABEL = (s) => s >= 80 ? 'High Integrity' : s >= 50 ? 'Some Concerns' : 'Flagged'

export default function VideoPlayer({ candidate, onClose, initialView = 'video' }) {
  const { full_name, video_urls = [], integrity_score, integrity_flags = [] } = candidate
  const [activeIdx, setActiveIdx] = useState(0)
  const [view, setView] = useState(initialView)
  const videoRef = useRef(null)
  const transcript = getVideoInterviewTranscript(candidate)
  const showSummary = hasVideoInterviewTranscript(candidate)

  useEffect(() => {
    if (videoRef.current && video_urls[activeIdx]?.url) {
      videoRef.current.load()
      videoRef.current.play().catch(() => {})
    }
  }, [activeIdx, view])

  const score = integrity_score ?? 100
  const scoreColor = INTEGRITY_COLOR(score)
  const mono = { fontFamily: 'var(--font-mono)' }

  if (!video_urls.length) return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000 }}>
      <div style={{ background: 'var(--surface)', borderRadius: 12, padding: 40, textAlign: 'center', maxWidth: 360 }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>📹</div>
        <div style={{ fontSize: 15, color: 'var(--text)', marginBottom: 6 }}>No recordings found</div>
        <div style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 20 }}>The video interview for {full_name} has not been completed yet.</div>
        <button className="btn btn-secondary" onClick={onClose}>Close</button>
      </div>
    </div>
  )

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, padding: 20 }}>
      <div style={{ background: 'var(--surface)', borderRadius: 14, width: '100%', maxWidth: 920, maxHeight: '92vh', overflow: 'auto', display: 'flex', flexDirection: 'column' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 24px', borderBottom: '1px solid var(--border2)' }}>
          <div>
            <div style={{ fontSize: 11, ...mono, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-3)', marginBottom: 4 }}>Video Interview</div>
            <div style={{ fontSize: 17, fontWeight: 500, color: 'var(--text)' }}>{full_name}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {showSummary && (
              <div style={{ display: 'flex', gap: 4, background: 'var(--bg)', borderRadius: 8, padding: 3, border: '1px solid var(--border)' }}>
                <button type="button" onClick={() => setView('video')} style={{ padding: '6px 12px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 11, ...mono, background: view === 'video' ? 'var(--accent)' : 'transparent', color: view === 'video' ? '#fff' : 'var(--text-3)' }}>▶ Video</button>
                <button type="button" onClick={() => setView('summary')} style={{ padding: '6px 12px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 11, ...mono, background: view === 'summary' ? 'var(--accent)' : 'transparent', color: view === 'summary' ? '#fff' : 'var(--text-3)' }}>💬 Summary</button>
              </div>
            )}
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: scoreColor }}>{score}</div>
              <div style={{ fontSize: 11, ...mono, color: scoreColor }}>{INTEGRITY_LABEL(score)}</div>
            </div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 22, color: 'var(--text-3)', padding: '4px 8px' }}>✕</button>
          </div>
        </div>

        {view === 'summary' ? (
          <div style={{ padding: 24 }}>
            {transcript.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-3)', fontSize: 13 }}>
                No speech transcript captured for this interview.
              </div>
            ) : (
              <div className="transcript-wrap" style={{ maxHeight: '60vh' }}>
                {transcript.map((msg, i) => (
                  <div key={i} className={`bubble ${msg.role === 'assistant' || msg.role === 'interviewer' ? 'assistant' : 'user'}`}>
                    <div className="bubble-who">{msg.role === 'assistant' || msg.role === 'interviewer' ? 'Question' : 'Candidate'}</div>
                    <div className="bubble-body">{msg.content}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
        /* Body */
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', flex: 1, minHeight: 0 }}>

          {/* Video column */}
          <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ background: '#000', borderRadius: 10, overflow: 'hidden', aspectRatio: '16/9' }}>
              {video_urls[activeIdx]?.url ? (
                <video
                  ref={videoRef}
                  controls
                  style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                  src={video_urls[activeIdx].url}
                />
              ) : (
                <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.3)', fontSize: 13 }}>
                  Upload failed for this question
                </div>
              )}
            </div>

            <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 16px' }}>
              <div style={{ fontSize: 10, ...mono, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-3)', marginBottom: 6 }}>Question {activeIdx + 1}</div>
              <div style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.6 }}>{video_urls[activeIdx]?.q}</div>
            </div>

            {video_urls[activeIdx]?.transcript && (
              <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 16px' }}>
                <div style={{ fontSize: 10, ...mono, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-3)', marginBottom: 6 }}>Candidate answer (transcript)</div>
                <div style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.6 }}>{video_urls[activeIdx].transcript}</div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {video_urls.map((v, i) => (
                <button
                  key={i}
                  onClick={() => setActiveIdx(i)}
                  style={{
                    padding: '6px 14px', borderRadius: 20, border: '1px solid', cursor: 'pointer', fontSize: 12, ...mono,
                    borderColor: i === activeIdx ? 'var(--accent)' : 'var(--border)',
                    background:  i === activeIdx ? 'rgba(99,102,241,0.1)' : 'var(--bg)',
                    color:       i === activeIdx ? 'var(--accent)' : 'var(--text-3)',
                  }}
                >
                  Q{i + 1} {!v.url && '⚠'}
                </button>
              ))}
            </div>
          </div>

          {/* Integrity sidebar */}
          <div style={{ borderLeft: '1px solid var(--border2)', padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ background: 'var(--bg)', borderRadius: 10, padding: '16px', textAlign: 'center', border: `1px solid ${scoreColor}33` }}>
              <div style={{ fontSize: 11, ...mono, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-3)', marginBottom: 10 }}>Integrity Score</div>
              <div style={{ fontSize: 44, fontWeight: 700, color: scoreColor, lineHeight: 1, marginBottom: 4 }}>{score}</div>
              <div style={{ fontSize: 12, ...mono, color: scoreColor }}>{INTEGRITY_LABEL(score)}</div>
              <div style={{ marginTop: 12, height: 4, borderRadius: 2, background: 'var(--border2)', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${score}%`, background: scoreColor, borderRadius: 2, transition: 'width 0.5s' }} />
              </div>
            </div>

            <div>
              <div style={{ fontSize: 11, ...mono, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-3)', marginBottom: 10 }}>
                Flags ({integrity_flags.length})
              </div>
              {integrity_flags.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--green)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>✓</span> No violations detected
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {integrity_flags.map((f, i) => (
                    <div key={i} style={{ fontSize: 11, ...mono, color: 'var(--red)', background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.15)', borderRadius: 6, padding: '6px 10px', lineHeight: 1.4 }}>
                      <div style={{ marginBottom: 2 }}>{f.label || f.type}</div>
                      <div style={{ color: 'rgba(239,68,68,0.5)', fontSize: 10 }}>During Q{(f.q ?? 0) + 1}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {showSummary && (
              <button type="button" className="btn btn-secondary" style={{ fontSize: 11, marginTop: 'auto' }} onClick={() => setView('summary')}>
                💬 View interview summary
              </button>
            )}

            <div style={{ padding: '12px', background: 'var(--bg)', borderRadius: 8, fontSize: 11, ...mono, color: 'var(--text-3)', lineHeight: 1.7 }}>
              <div>{video_urls.length} questions recorded</div>
              <div>{video_urls.filter(v => v.url).length} successfully uploaded</div>
            </div>
          </div>
        </div>
        )}
      </div>
    </div>
  )
}
