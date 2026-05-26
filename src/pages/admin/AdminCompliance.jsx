import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'

// Very simple name-based gender heuristic (approximate, for statistical purposes only)
function inferGender(name) {
  if (!name) return 'unknown'
  const first = name.trim().split(' ')[0].toLowerCase()
  const femaleEndings = ['a', 'ia', 'elle', 'ine', 'een', 'ette', 'isa', 'ara', 'ira', 'ita', 'aya', 'uma', 'eva', 'ana', 'ella', 'ina', 'ina', 'yna']
  const femaleNames = ['mary', 'emma', 'sophie', 'sarah', 'emily', 'jessica', 'lisa', 'rachel', 'laura', 'anna', 'hannah', 'alice', 'claire', 'helen', 'lucy', 'kate', 'natalie', 'victoria', 'charlotte', 'amelia', 'olivia', 'grace', 'eve', 'rose', 'jade', 'zoe', 'priya', 'neha', 'anjali', 'divya', 'pooja', 'kavya', 'shreya', 'riya', 'aisha', 'fatima', 'mia', 'ava', 'isla', 'luna', 'lila']
  const maleNames = ['james', 'john', 'david', 'michael', 'robert', 'william', 'richard', 'thomas', 'mark', 'paul', 'andrew', 'peter', 'chris', 'daniel', 'matthew', 'ryan', 'kevin', 'brian', 'adam', 'ben', 'alex', 'sam', 'tom', 'jack', 'oliver', 'harry', 'george', 'charlie', 'ethan', 'liam', 'noah', 'raj', 'arjun', 'vikram', 'sanjay', 'rohan', 'amit', 'nikhil', 'rahul', 'karan', 'omar', 'ahmed', 'ali', 'hassan']
  if (femaleNames.includes(first)) return 'female'
  if (maleNames.includes(first))   return 'male'
  if (femaleEndings.some(e => first.endsWith(e) && first.length > 3)) return 'female'
  return 'unknown'
}

function Bar({ value, max, color = 'var(--accent)' }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ flex: 1, height: 16, background: 'var(--surface2)', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 4, transition: 'width 0.4s' }} />
      </div>
      <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', width: 32, textAlign: 'right' }}>{value}</span>
    </div>
  )
}

export default function AdminCompliance() {
  const { user } = useAuth()
  const [jobs,          setJobs]          = useState([])
  const [selectedJobId, setSelectedJobId] = useState('')
  const [candidates,    setCandidates]    = useState([])
  const [signing,       setSigning]       = useState(false)
  const [signedDate,    setSignedDate]    = useState(null)
  const [loading,       setLoading]       = useState(true)
  const [loadingCands,  setLoadingCands]  = useState(false)

  useEffect(() => { loadJobs() }, [])

  async function loadJobs() {
    try { // fix: wrap in try/finally so setLoading(false) always fires on query error
    const { data } = await supabase
      .from('jobs')
      .select('id, title, created_at, compliance_signed, profiles(company_name)')
      .order('created_at', { ascending: false })
    setJobs(data ?? [])
    } finally {
      setLoading(false) // fix: always clear loading even when queries fail
    }
  }

  async function selectJob(id) {
    setSelectedJobId(id)
    if (!id) { setCandidates([]); return }
    setLoadingCands(true)
    const { data } = await supabase.from('candidates').select('*').eq('job_id', id)
    setCandidates(data ?? [])
    const job = jobs.find(j => j.id === id)
    setSignedDate(job?.compliance_signed ? new Date().toLocaleDateString() : null)
    setLoadingCands(false)
  }

  async function signOff() {
    if (!selectedJobId) return
    setSigning(true)
    await supabase.from('jobs').update({ compliance_signed: true }).eq('id', selectedJobId)
    setJobs(p => p.map(j => j.id === selectedJobId ? { ...j, compliance_signed: true } : j))
    setSignedDate(new Date().toLocaleDateString())
    setSigning(false)
  }

  const job      = jobs.find(j => j.id === selectedJobId)
  const total    = candidates.length
  const screened = candidates.filter(c => c.match_score != null).length
  const passed   = candidates.filter(c => c.match_pass === true).length
  const interviewed = candidates.filter(c => c.scores?.overallScore != null).length

  // Score distribution
  const scoreBuckets = [
    { label: '81–100', count: candidates.filter(c => c.match_score != null && c.match_score >= 81).length, color: 'var(--green)' },
    { label: '61–80',  count: candidates.filter(c => c.match_score != null && c.match_score >= 61 && c.match_score <= 80).length, color: 'var(--accent)' },
    { label: '41–60',  count: candidates.filter(c => c.match_score != null && c.match_score >= 41 && c.match_score <= 60).length, color: 'var(--amber)' },
    { label: '21–40',  count: candidates.filter(c => c.match_score != null && c.match_score >= 21 && c.match_score <= 40).length, color: 'var(--amber)' },
    { label: '0–20',   count: candidates.filter(c => c.match_score != null && c.match_score <= 20).length, color: 'var(--red)' },
  ]
  const maxBucket = Math.max(...scoreBuckets.map(b => b.count), 1)

  // Experience distribution
  const expBuckets = [
    { label: '0–3 years', count: candidates.filter(c => c.total_years >= 0 && c.total_years <= 3).length },
    { label: '4–7 years', count: candidates.filter(c => c.total_years >= 4 && c.total_years <= 7).length },
    { label: '8+ years',  count: candidates.filter(c => c.total_years >= 8).length },
  ]
  const maxExp = Math.max(...expBuckets.map(b => b.count), 1)
  const avgExp = total > 0 ? (candidates.reduce((s, c) => s + (c.total_years ?? 0), 0) / total).toFixed(1) : '—'
  const minExp = total > 0 ? Math.min(...candidates.map(c => c.total_years ?? 0)) : '—'
  const maxExpVal = total > 0 ? Math.max(...candidates.map(c => c.total_years ?? 0)) : '—'

  // Gender distribution
  const genders = candidates.map(c => inferGender(c.full_name))
  const genderCounts = {
    female:  genders.filter(g => g === 'female').length,
    male:    genders.filter(g => g === 'male').length,
    unknown: genders.filter(g => g === 'unknown').length,
  }
  const passedByGender = {
    female:  candidates.filter((c, i) => c.match_pass && genders[i] === 'female').length,
    male:    candidates.filter((c, i) => c.match_pass && genders[i] === 'male').length,
    unknown: candidates.filter((c, i) => c.match_pass && genders[i] === 'unknown').length,
  }

  if (loading) return <div className="page" style={{ display: 'flex', alignItems: 'center', gap: 10 }}><span className="spinner" /> Loading…</div>

  return (
    <div className="page" id="compliance-report">
      <style dangerouslySetInnerHTML={{ __html: `@media print { .sidebar, .page-head button, .no-print { display: none !important; } body { background: white !important; } .section-card { break-inside: avoid; box-shadow: none !important; border: 1px solid #ccc !important; } }` }} />

      <div className="page-head">
        <div><h2>Compliance</h2><p>Bias audit and AI decision transparency reports</p></div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary no-print" onClick={() => window.print()}>↓ Export as PDF</button>
        </div>
      </div>

      {/* Job selector */}
      <div className="section-card" style={{ marginBottom: 20 }}>
        <div className="section-card-body" style={{ padding: '16px 20px' }}>
          <div className="field" style={{ maxWidth: 400 }}>
            <label style={{ fontSize: 11, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-3)', display: 'block', marginBottom: 6 }}>Select Job for Audit</label>
            <select
              style={{ width: '100%', padding: '9px 12px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13 }}
              value={selectedJobId}
              onChange={e => selectJob(e.target.value)}
            >
              <option value="">— Select a job —</option>
              {jobs.map(j => <option key={j.id} value={j.id}>{j.title} ({j.profiles?.company_name ?? 'Unknown Client'})</option>)}
            </select>
          </div>
        </div>
      </div>

      {loadingCands && <div style={{ textAlign: 'center', padding: 20 }}><span className="spinner" /></div>}

      {selectedJobId && !loadingCands && (
        <>
          {/* Overview */}
          <div className="section-card" style={{ marginBottom: 20 }}>
            <div className="section-card-head"><h3>1. Overview</h3></div>
            <div style={{ padding: '16px 20px' }}>
              <table style={{ fontSize: 13, width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  {[
                    ['Job Title', job?.title ?? '—'],
                    ['Report Date', new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })],
                    ['Total Candidates', total],
                    ['Screened', screened],
                    ['Passed', `${passed} (${screened > 0 ? Math.round(passed/screened*100) : 0}%)`],
                    ['AI Interviewed', interviewed],
                  ].map(([k, v]) => (
                    <tr key={k} style={{ borderBottom: '1px solid var(--border2)' }}>
                      <td style={{ padding: '8px 12px', color: 'var(--text-3)', fontFamily: 'var(--font-mono)', fontSize: 11, width: 180 }}>{k}</td>
                      <td style={{ padding: '8px 12px', fontWeight: 500 }}>{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Score Distribution */}
          <div className="section-card" style={{ marginBottom: 20 }}>
            <div className="section-card-head"><h3>2. Score Distribution</h3></div>
            <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {screened === 0 ? <div style={{ color: 'var(--text-3)', fontSize: 13 }}>No screened candidates yet.</div> : scoreBuckets.map(b => (
                <div key={b.label} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ width: 56, fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-3)' }}>{b.label}</span>
                  <div style={{ flex: 1 }}>
                    <Bar value={b.count} max={maxBucket} color={b.color} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Experience Distribution */}
          <div className="section-card" style={{ marginBottom: 20 }}>
            <div className="section-card-head"><h3>3. Experience Distribution</h3></div>
            <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 8 }}>
                Average: <strong>{avgExp} years</strong> · Range: {minExp}–{maxExpVal} years
              </div>
              {expBuckets.map(b => (
                <div key={b.label} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ width: 80, fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-3)' }}>{b.label}</span>
                  <div style={{ flex: 1 }}>
                    <Bar value={b.count} max={maxExp} color="var(--accent)" />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Gender Inference */}
          <div className="section-card" style={{ marginBottom: 20 }}>
            <div className="section-card-head"><h3>4. Gender Distribution (Approximate)</h3></div>
            <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <p style={{ fontSize: 12, color: 'var(--text-3)', fontStyle: 'italic', margin: 0 }}>
                Note: Gender is estimated from first names using heuristics. This is approximate and for statistical review only — should not be used for individual decisions.
              </p>
              <table style={{ fontSize: 13, borderCollapse: 'collapse', width: '100%' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    {['Group', 'All Candidates', 'Passed', 'Pass Rate'].map(h => (
                      <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', fontWeight: 400 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[['Estimated Female', 'female'], ['Estimated Male', 'male'], ['Indeterminate', 'unknown']].map(([label, key]) => {
                    const count = genderCounts[key]
                    const passedCount = passedByGender[key]
                    const rate = count > 0 ? `${Math.round(passedCount/count*100)}%` : '—'
                    return (
                      <tr key={key} style={{ borderBottom: '1px solid var(--border2)' }}>
                        <td style={{ padding: '8px 12px' }}>{label}</td>
                        <td style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)' }}>{count}</td>
                        <td style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)' }}>{passedCount}</td>
                        <td style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)' }}>{rate}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* AI Transparency */}
          <div className="section-card" style={{ marginBottom: 20 }}>
            <div className="section-card-head"><h3>5. AI Decision Transparency</h3></div>
            <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <table style={{ fontSize: 13, borderCollapse: 'collapse' }}>
                <tbody>
                  {[
                    ['AI Model', 'Claude claude-sonnet-4-6 (Anthropic)'],
                    ['Screening Criteria', 'Job requirements vs candidate profile (skills, experience, role fit)'],
                    ['Decision Basis', 'Automated scoring of skills match, years of experience, and role alignment'],
                    ['Human Oversight', 'Required — all AI decisions reviewed by recruiter before final selection'],
                    ['Data Used', 'Candidate CV text, job description, required skills'],
                    ['Bias Mitigation', 'Criteria limited to professional qualifications and experience only'],
                  ].map(([k, v]) => (
                    <tr key={k} style={{ borderBottom: '1px solid var(--border2)' }}>
                      <td style={{ padding: '8px 12px', color: 'var(--text-3)', fontFamily: 'var(--font-mono)', fontSize: 11, width: 200, verticalAlign: 'top' }}>{k}</td>
                      <td style={{ padding: '8px 12px', lineHeight: 1.5 }}>{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {/* Top passing candidates */}
              {passed > 0 && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Passing Candidates (Top 5)</div>
                  {candidates.filter(c => c.match_pass).slice(0, 5).map(c => (
                    <div key={c.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--border2)', fontSize: 12 }}>
                      <span style={{ flex: 1 }}>{c.full_name}</span>
                      <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>{c.match_score}/100</span>
                      <span style={{ fontSize: 11, color: 'var(--text-3)', flex: 2 }}>{c.match_reason ?? '—'}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Sign Off */}
          <div className="section-card" style={{ marginBottom: 20 }}>
            <div className="section-card-head"><h3>6. Human Oversight Confirmation</h3></div>
            <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              {signedDate ? (
                <div style={{ padding: '12px 16px', background: 'var(--green-d)', border: '1px solid var(--green)', borderRadius: 8, color: 'var(--green)', fontSize: 13 }}>
                  ✓ Signed off on {signedDate} by {user?.email}
                </div>
              ) : (
                <>
                  <label style={{ display: 'flex', gap: 12, cursor: 'pointer', fontSize: 13, lineHeight: 1.6 }}>
                    <input type="checkbox" id="compliance-check" style={{ marginTop: 2 }} />
                    <span>I confirm I have reviewed all AI screening decisions for this role and am satisfied they are fair, non-discriminatory, and based on relevant professional criteria only.</span>
                  </label>
                  <button
                    className="btn btn-primary no-print"
                    disabled={signing}
                    onClick={() => {
                      const cb = document.getElementById('compliance-check')
                      if (!cb?.checked) { alert('Please check the confirmation box first.'); return }
                      signOff()
                    }}
                  >
                    {signing ? <><span className="spinner" style={{ width: 11, height: 11 }} /> Signing…</> : '✓ Sign Off on This Report'}
                  </button>
                </>
              )}
              <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
                Reviewer: {user?.email} · Report generated: {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
