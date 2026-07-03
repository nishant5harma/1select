import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { corsHeaders } from "../_shared/cors.ts"
import { CLAUDE_MODEL } from "../_shared/claude.ts"

const RATE_LIMIT    = 30     // max requests
const WINDOW_MS     = 60_000 // per 60 seconds

// DB-backed rate limiter. Uses the rate_limits table so the counter survives
// cold starts and scales across multiple function instances.
async function checkRateLimit(adminClient: ReturnType<typeof createClient>, userId: string): Promise<boolean> {
  const now      = Date.now()
  const windowTs = new Date(Math.floor(now / WINDOW_MS) * WINDOW_MS).toISOString()

  // Prune rows older than 2 windows to keep the table small
  await adminClient
    .from('rate_limits')
    .delete()
    .lt('window_start', new Date(now - WINDOW_MS * 2).toISOString())

  // Upsert: increment counter if row exists, else insert count=1
  const { data, error } = await adminClient.rpc('increment_rate_limit', {
    p_user_id:      userId,
    p_window_start: windowTs,
    p_limit:        RATE_LIMIT,
  })

  if (error) {
    // Fail-open when rate_limits migration isn't applied yet — otherwise all AI calls block.
    console.error('[call-claude] rate_limit rpc error (allowing request):', error.message)
    return true
  }
  return data === true
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabaseUrl   = Deno.env.get('SUPABASE_URL') ?? ''
    const anonKey       = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    const serviceKey    = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const anthropicKey  = Deno.env.get('ANTHROPIC_API_KEY') ?? ''

    if (!anthropicKey) {
      return new Response(JSON.stringify({ error: 'Service unavailable' }), {
        status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Require a valid session — anonymous callers cannot use the AI
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

    // DB-backed rate check (service role to bypass RLS on rate_limits)
    const adminClient = createClient(supabaseUrl, serviceKey)
    const allowed = await checkRateLimit(adminClient, user.id)
    if (!allowed) {
      return new Response(JSON.stringify({ error: 'Rate limit exceeded. Please wait a moment.' }), {
        status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { messages, systemPrompt, maxTokens = 1000 } = await req.json()
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({ error: 'messages array is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: Math.min(maxTokens, 4096),
        ...(systemPrompt ? { system: systemPrompt } : {}),
        messages,
      }),
    })

    if (!claudeRes.ok) {
      const err = await claudeRes.json().catch(() => ({}))
      const msg = (err as { error?: { message?: string } }).error?.message ?? `Claude API error ${claudeRes.status}`
      console.error('[call-claude] anthropic error:', msg)
      return new Response(JSON.stringify({ error: msg }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const data = await claudeRes.json()
    const text = (data.content as { text?: string }[])
      .map(b => b.text ?? '').join('')

    return new Response(JSON.stringify({ text }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (err) {
    const msg = err instanceof Error ? err.message : 'AI service error. Please try again.'
    console.error('call-claude error:', msg)
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
