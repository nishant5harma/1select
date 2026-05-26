import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  CartesianGrid, LabelList,
} from 'recharts'

const GOLD   = '#B8924A'
const COLORS = ['#9ca3af', '#B8924A', '#6366f1', '#22c55e', '#10b981']

function pct(num, den) {
  if (!den) return 0
  return Math.round((num / den) * 100)
}

function ConversionCard({ label, rate, color }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '16px 20px', flex: 1, minWidth: 140 }}>
      <div style={{ fontSize: 28, fontWeight: 300, fontFamily: 'var(--font-head)', color: color ?? GOLD, lineHeight: 1 }}>{rate}%</div>
      <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-3)', marginTop: 6 }}>{label}</div>
    </div>
  )
}

export default function AdminAnalytics() {
  const [loading, setLoading]       = useState(true)
  const [clients, setClients]       = useState([])
  const [jobs, setJobs]             = useState([])
  const [clientFilter, setClientFilter] = useState('all')
  const [jobFilter, setJobFilter]   = useState('all')
  const [funnel, setFunnel]         = useState([])
  const [rates, setRates]           = useState({})
  const [recruiterStats, setRecruiterStats] = useState([])

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    try { // fix: wrap in try/finally so setLoading(false) always fires on query error
      const [
        { data: clientData },
        { data: jobData },
        { data: candidateData },
        { data: matchData },
        { data: rcData },
        { data: recruiterData },
      ] = await Promise.all([
        supabase.from('profiles').select('id, full_name, company_name').eq('user_role', 'client').order('company_name'),
        supabase.from('jobs').select('id, title, recruiter_id').eq('status', 'active').order('title'),
        supabase.from('candidates').select('id, job_id, match_score, match_pass, scores, video_urls, live_interview_status, final_decision').limit(2000),
        supabase.from('job_matches').select('id, job_id, match_score, match_pass, scores, video_urls, live_interview_status, final_decision'),
        supabase.from('recruiter_clients').select('recruiter_id, client_id'),
        supabase.from('profiles').select('id, full_name, email').eq('user_role', 'recruiter'),
      ])
      setClients(clientData ?? [])
      setJobs(jobData ?? [])
      compute(clientData ?? [], jobData ?? [], candidateData ?? [], matchData ?? [], rcData ?? [], recruiterData ?? [], 'all', 'all')
    } finally {
      setLoading(false) // fix: always clear loading even when Promise.all fails
    }
  }

  function compute(clientList, jobList, candidates, matches, rcData, recruiters, cFilter, jFilter) {
    let filteredJobIds = jobList.map(j => j.id)
    if (cFilter !== 'all') {
      filteredJobIds = jobList.filter(j => j.recruiter_id === cFilter).map(j => j.id)
    }
    if (jFilter !== 'all') {
      filteredJobIds = [jFilter]
    }

    const all = [
      ...candidates.filter(c => filteredJobIds.includes(c.job_id)),
      ...matches.filter(m => filteredJobIds.includes(m.job_id)),
    ]

    const total      = all.length
    const passed     = all.filter(c => c.match_pass === true).length
    const videoComp  = all.filter(c => c.scores?.overallScore != null || (c.video_urls?.length > 0)).length
    const liveSched  = all.filter(c => c.live_interview_status === 'scheduled' || c.live_interview_status === 'completed').length
    const hired      = all.filter(c => c.final_decision === 'hired').length

    setFunnel([
      { stage: 'CVs Uploaded',     value: total,     color: COLORS[0] },
      { stage: 'Screening Pass',   value: passed,    color: COLORS[1] },
      { stage: 'Video Interview',  value: videoComp, color: COLORS[2] },
      { stage: 'Live Interview',   value: liveSched, color: COLORS[3] },
      { stage: 'Hired',            value: hired,     color: COLORS[4] },
    ])

    setRates({
      cvToScreen:    pct(passed, total),
      screenToVideo: pct(videoComp, passed),
      videoToLive:   pct(liveSched, videoComp),
      liveToHire:    pct(hired, liveSched),
    })

    // Per-recruiter stats
    const recruiterJobMap = {}
    rcData.forEach(rc => {
      const recJobs = jobList.filter(j => j.recruiter_id === rc.client_id)
      if (!recruiterJobMap[rc.recruiter_id]) recruiterJobMap[rc.recruiter_id] = []
      recruiterJobMap[rc.recruiter_id].push(...recJobs.map(j => j.id))
    })

    const stats = recruiters.map(r => {
      const jobIds = recruiterJobMap[r.id] ?? []
      const rc = [
        ...candidates.filter(c => jobIds.includes(c.job_id)),
        ...matches.filter(m => jobIds.includes(m.job_id)),
      ]
      const tot   = rc.length
      const pass  = rc.filter(c => c.match_pass === true).length
      const video = rc.filter(c => c.scores?.overallScore != null || c.video_urls?.length > 0).length
      const hire  = rc.filter(c => c.final_decision === 'hired').length
      return { id: r.id, name: r.full_name || r.email, total: tot, passed: pass, video, hired: hire, passRate: pct(pass, tot), hireRate: pct(hire, tot) }
    }).filter(r => r.total > 0).sort((a, b) => b.total - a.total)

    setRecruiterStats(stats)
  }

  function applyFilters(cFilter, jFilter) {
    setClientFilter(cFilter)
    setJobFilter(jFilter)
    // Re-run compute with current data — we'd need refs or a reload. Simple: just reload.
    loadFiltered(cFilter, jFilter)
  }

  async function loadFiltered(cFilter, jFilter) {
    setLoading(true)
    const [
      { data: jobData },
      { data: candidateData },
      { data: matchData },
      { data: rcData },
      { data: recruiterData },
    ] = await Promise.all([
      supabase.from('jobs').select('id, title, recruiter_id').eq('status', 'active'),
      supabase.from('candidates').select('id, job_id, match_score, match_pass, scores, video_urls, live_interview_status, final_decision').limit(2000),
      supabase.from('job_matches').select('id, job_id, match_score, match_pass, scores, video_urls, live_interview_status, final_decision'),
      supabase.from('recruiter_clients').select('recruiter_id, client_id'),
      supabase.from('profiles').select('id, full_name, email').eq('user_role', 'recruiter'),
    ])
    compute(clients, jobData ?? [], candidateData ?? [], matchData ?? [], rcData ?? [], recruiterData ?? [], cFilter, jFilter)
    setLoading(false)
  }

  const filteredJobs = clientFilter === 'all' ? jobs : jobs.filter(j => j.recruiter_id === clientFilter)

  if (loading) return <div className="page"><span className="spinner" /></div>

  const maxVal = Math.max(...funnel.map(f => f.value), 1)

  return (
    <div className="page">
      <div className="page-head">
        <div><h2>Analytics</h2><p>Pipeline conversion rates across all jobs</p></div>
        <div style={{ display: 'flex', gap: 8 }}>
          <select value={clientFilter} onChange={e => applyFilters(e.target.value, 'all')} style={{ fontSize: 12 }}>
            <option value="all">All Clients</option>
            {clients.map(c => <option key={c.id} value={c.id}>{c.company_name || c.full_name}</option>)}
          </select>
          <select value={jobFilter} onChange={e => applyFilters(clientFilter, e.target.value)} style={{ fontSize: 12 }}>
            <option value="all">All Jobs</option>
            {filteredJobs.map(j => <option key={j.id} value={j.id}>{j.title}</option>)}
          </select>
        </div>
      </div>

      {/* Conversion rate cards */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <ConversionCard label="CV → Screening Pass"   rate={rates.cvToScreen}    color={COLORS[1]} />
        <ConversionCard label="Screen → Video Interview" rate={rates.screenToVideo} color={COLORS[2]} />
        <ConversionCard label="Video → Live Interview" rate={rates.videoToLive}   color={COLORS[3]} />
        <ConversionCard label="Live → Hire"           rate={rates.liveToHire}    color={COLORS[4]} />
      </div>

      {/* Funnel chart */}
      <div className="section-card">
        <div className="section-card-head"><h3>Hiring Funnel</h3></div>
        <div style={{ padding: '8px 20px 20px' }}>
          {/* Visual funnel using CSS */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24 }}>
            {funnel.map((f, i) => (
              <div key={f.stage} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 140, fontSize: 11, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-3)', textAlign: 'right', flexShrink: 0 }}>{f.stage}</div>
                <div style={{ flex: 1, height: 28, background: 'var(--surface2)', borderRadius: 4, overflow: 'hidden', position: 'relative' }}>
                  <div style={{ height: '100%', width: `${(f.value / maxVal) * 100}%`, background: f.color, borderRadius: 4, transition: 'width 0.4s ease', minWidth: f.value > 0 ? 4 : 0 }} />
                </div>
                <div style={{ width: 48, fontSize: 16, fontWeight: 600, fontFamily: 'var(--font-mono)', color: f.color, textAlign: 'right', flexShrink: 0 }}>{f.value}</div>
                {i > 0 && (
                  <div style={{ width: 42, fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', flexShrink: 0 }}>
                    {pct(f.value, funnel[i-1].value)}%
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Recharts bar chart for comparison */}
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={funnel} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="stage" tick={{ fontSize: 10, fontFamily: 'var(--font-mono)', fill: 'var(--text-3)' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fontFamily: 'var(--font-mono)', fill: 'var(--text-3)' }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, fontFamily: 'var(--font-mono)' }}
                cursor={{ fill: 'rgba(255,255,255,0.03)' }}
              />
              <Bar dataKey="value" radius={[4,4,0,0]}>
                {funnel.map((f, i) => <Cell key={i} fill={f.color} />)}
                <LabelList dataKey="value" position="top" style={{ fontSize: 11, fontFamily: 'var(--font-mono)', fill: 'var(--text-2)' }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Per-recruiter table */}
      {recruiterStats.length > 0 && (
        <div className="section-card">
          <div className="section-card-head"><h3>Recruiter Performance</h3></div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['Recruiter','CVs Processed','Screening Pass','Video Done','Hired','Pass Rate','Hire Rate'].map(h => (
                    <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: 10, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-3)', fontWeight: 400 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recruiterStats.map(r => (
                  <tr key={r.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '12px 16px', fontWeight: 500 }}>{r.name}</td>
                    <td style={{ padding: '12px 16px', fontFamily: 'var(--font-mono)' }}>{r.total}</td>
                    <td style={{ padding: '12px 16px', fontFamily: 'var(--font-mono)' }}>{r.passed}</td>
                    <td style={{ padding: '12px 16px', fontFamily: 'var(--font-mono)' }}>{r.video}</td>
                    <td style={{ padding: '12px 16px', fontFamily: 'var(--font-mono)' }}>{r.hired}</td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{ fontFamily: 'var(--font-mono)', color: r.passRate >= 50 ? 'var(--green)' : r.passRate >= 25 ? 'var(--amber)' : 'var(--red)' }}>{r.passRate}%</span>
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{ fontFamily: 'var(--font-mono)', color: r.hireRate >= 20 ? 'var(--green)' : r.hireRate > 0 ? 'var(--amber)' : 'var(--text-3)' }}>{r.hireRate}%</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {funnel[0]?.value === 0 && (
        <div className="section-card">
          <div className="empty-state">No pipeline data yet. Start processing candidates in the Pipeline page.</div>
        </div>
      )}
    </div>
  )
}
