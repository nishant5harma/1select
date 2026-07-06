// Deployed with --no-verify-jwt: called from the public /interview/:token page
// which has no authenticated session. Uses SUPABASE_SERVICE_ROLE_KEY internally.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { corsHeaders } from "../_shared/cors.ts"

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { token, table, video_urls, interview_transcript, integrity_score, integrity_flags } = await req.json()

    if (!token || !table || !['candidates', 'job_matches'].includes(table)) {
      return new Response(JSON.stringify({ error: 'Invalid request' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const admin = createClient(supabaseUrl, serviceKey)

    // Validate token exists
    const { data: row, error: findErr } = await admin
      .from(table)
      .select('id')
      .eq('interview_invite_token', token)
      .maybeSingle()

    if (findErr || !row) {
      return new Response(JSON.stringify({ error: 'Token not found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // Only nullify the token once all uploads succeeded (no null URLs).
    // A partial save (failed uploads) keeps the token so the candidate can retry.
    const allUploaded = Array.isArray(video_urls) && video_urls.length > 0 &&
      video_urls.every((v: { url: string | null }) => v?.url != null)

    const { error: updateErr } = await admin
      .from(table)
      .update({
        video_urls,
        interview_transcript: interview_transcript ?? null,
        integrity_score,
        integrity_flags,
        interviewed_at: new Date().toISOString(),
        ...(allUploaded ? { interview_invite_token: null } : {}),
      })
      .eq('id', row.id)

    if (updateErr) throw new Error(updateErr.message)

    return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (err) {
    console.error('save-interview-recording error:', err)
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})
