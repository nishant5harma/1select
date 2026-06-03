// Deployed with verify_jwt = true (default) — caller must be an authenticated client user.
// Allows a client to invite stakeholders (co-viewers) for their own account only.
// Role check: caller must have user_role = 'client' and stakeholder_of must match caller's user ID.
import { FROM_EMAIL } from "../_shared/email.ts"
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { corsHeaders } from "../_shared/cors.ts"

const APP_URL = 'https://www.oneselectai.com'

async function sendEmail(resendKey: string, payload: Record<string, unknown>, recipient: string) {
  const call = () => fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${resendKey}` },
    body: JSON.stringify(payload),
  })
  try {
    const res = await call()
    if (res.ok) return { ok: true }
    await new Promise(r => setTimeout(r, 1000))
    const retry = await call()
    return { ok: retry.ok }
  } catch {
    await new Promise(r => setTimeout(r, 1000))
    try {
      const retry = await call()
      return { ok: retry.ok }
    } catch (e) {
      console.error('invite-stakeholder email error:', e)
      return { ok: false }
    }
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Missing authorization' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  try {
    const { email, name, stakeholder_of } = await req.json()

    if (!email || !stakeholder_of) {
      return new Response(JSON.stringify({ error: 'email and stakeholder_of are required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const resendKey   = Deno.env.get('RESEND_API_KEY') ?? ''

    const admin = createClient(supabaseUrl, serviceKey)

    // Verify caller identity from the JWT
    const callerToken = authHeader.replace('Bearer ', '')
    const { data: { user: callerUser }, error: callerErr } = await admin.auth.getUser(callerToken)
    if (callerErr || !callerUser) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Verify caller is a client
    const { data: callerProfile } = await admin
      .from('profiles')
      .select('user_role, company_name')
      .eq('id', callerUser.id)
      .single()

    if (callerProfile?.user_role !== 'client') {
      return new Response(JSON.stringify({ error: 'Insufficient permissions' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Verify the stakeholder_of field matches the caller's own user ID —
    // a client must only invite stakeholders for their own account.
    if (stakeholder_of !== callerUser.id) {
      return new Response(JSON.stringify({ error: 'stakeholder_of must match your own user ID' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const companyName = callerProfile.company_name ?? ''
    const displayName = name?.trim() || email.split('@')[0]

    // Create the auth user or find existing one
    const internalPassword = crypto.randomUUID() + crypto.randomUUID()
    let userId: string
    let isReInvite = false

    const { data: userData, error: createError } = await admin.auth.admin.createUser({
      email,
      password: internalPassword,
      email_confirm: true,
      user_metadata: { full_name: displayName, role: 'client' },
    })

    if (createError) {
      const alreadyExists =
        createError.message.toLowerCase().includes('already been registered') ||
        createError.message.toLowerCase().includes('already exists') ||
        createError.message.toLowerCase().includes('user already registered')

      if (!alreadyExists) throw new Error('Create user failed: ' + createError.message)

      // Find existing user
      const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 })
      const existing = list?.users?.find((u: { email?: string }) =>
        u.email?.toLowerCase() === email.toLowerCase()
      )
      if (!existing) throw new Error('User already exists but could not be found')

      await admin.auth.admin.updateUserById(existing.id, {
        email_confirm: true,
        user_metadata: { full_name: displayName, role: 'client' },
      })

      userId = existing.id
      isReInvite = true
    } else {
      userId = userData.user.id
    }

    // Upsert profile with stakeholder link
    const { error: profileError } = await admin.from('profiles').upsert({
      id:             userId,
      user_role:      'client',
      email,
      full_name:      displayName,
      company_name:   companyName,
      stakeholder_of: callerUser.id,
      first_login:    true,
    }, { onConflict: 'id' })

    if (profileError) throw new Error('Profile upsert failed: ' + profileError.message)

    // Generate a one-time link
    const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
      type:    isReInvite ? 'magiclink' : 'invite',
      email,
      options: { redirectTo: APP_URL + '/login' },
    })
    if (linkError) throw new Error('Failed to generate invite link: ' + linkError.message)
    const magicLink = linkData.properties?.action_link ?? (APP_URL + '/login')

    const { ok: emailSent } = await sendEmail(resendKey, {
      from:    FROM_EMAIL,
      to:      [email],
      subject: `You've been invited to the ${companyName} portal — One Select`,
      html: `
        <div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;background:#F8F7F4;padding:40px;">
          <div style="text-align:center;padding:32px 0;border-bottom:1px solid #E8E4DC;margin-bottom:32px;">
            <h1 style="font-family:Georgia,serif;color:#B8924A;font-weight:300;letter-spacing:0.15em;font-size:28px;margin:0;">ONE SELECT</h1>
            <p style="color:#9CA3AF;font-size:11px;letter-spacing:0.2em;text-transform:uppercase;margin:8px 0 0;">Strategic Talent Solutions</p>
          </div>
          <div style="background:white;padding:40px;border:1px solid #E8E4DC;">
            <h2 style="font-family:Georgia,serif;color:#2D3748;font-weight:400;font-size:22px;margin:0 0 16px;">Welcome, ${displayName}</h2>
            <p style="color:#6B7280;line-height:1.8;font-size:15px;margin:0 0 24px;">
              You've been invited to view the hiring portal for
              <strong style="color:#2D3748;">${companyName}</strong> on One Select.
              Click the button below to access your portal — no password needed.
            </p>
            <div style="background:#F8F7F4;border:1px solid #E8E4DC;border-left:4px solid #B8924A;padding:16px 24px;margin:24px 0;">
              <p style="margin:0 0 8px;color:#6B7280;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;font-family:monospace;">Your account</p>
              <p style="margin:0;color:#2D3748;font-size:14px;">${email} &mdash; Client Portal (Stakeholder)</p>
            </div>
            <div style="text-align:center;margin:32px 0;">
              <a href="${magicLink}" style="background:#B8924A;color:white;padding:14px 40px;text-decoration:none;font-family:monospace;font-size:12px;letter-spacing:0.1em;text-transform:uppercase;display:inline-block;">ACCESS PORTAL →</a>
            </div>
            <p style="color:#9CA3AF;font-size:13px;line-height:1.6;margin:24px 0 0;padding-top:24px;border-top:1px solid #E8E4DC;">
              This link is valid for 24 hours and can only be used once. After logging in, you can set a permanent password from your account settings.
            </p>
          </div>
          <p style="text-align:center;color:#9CA3AF;font-size:11px;margin-top:24px;letter-spacing:0.08em;">ONE SELECT — STRATEGIC TALENT SOLUTIONS</p>
        </div>
      `,
    }, email)

    return new Response(JSON.stringify({ success: true, userId, emailSent }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('invite-stakeholder error:', err)
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
