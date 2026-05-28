import { FROM_EMAIL } from "../_shared/email.ts"
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { corsHeaders } from "../_shared/cors.ts"

async function sendEmail(resendKey: string, payload: Record<string, unknown>, recipient: string) {
  const call = () => fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${resendKey}` },
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
    try { const retry = await call(); return { ok: retry.ok } } catch { return { ok: false } }
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })

  try {
    const { email, name, job_title, company_name, scheduling_link } = await req.json()
    const resendKey = Deno.env.get("RESEND_API_KEY") ?? ""

    const companyStr = company_name ? ` at <strong style="color:#2D3748;">${company_name}</strong>` : ""

    const { ok: emailSent } = await sendEmail(resendKey, {
      from: FROM_EMAIL,
      to: [email],
      subject: `Schedule your interview for ${job_title}${company_name ? ` at ${company_name}` : ""}`,
      html: `
        <div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;background:#F8F7F4;padding:40px;">
          <div style="text-align:center;padding:32px 0;border-bottom:1px solid #E8E4DC;margin-bottom:32px;">
            <h1 style="font-family:Georgia,serif;color:#B8924A;font-weight:300;letter-spacing:0.15em;font-size:28px;margin:0;">ONE SELECT</h1>
            <p style="color:#9CA3AF;font-size:11px;letter-spacing:0.2em;text-transform:uppercase;margin:8px 0 0;">Strategic Talent Solutions</p>
          </div>
          <div style="background:white;padding:40px;border:1px solid #E8E4DC;">
            <h2 style="font-family:Georgia,serif;color:#2D3748;font-weight:400;font-size:22px;margin:0 0 16px;">Hi ${name},</h2>
            <p style="color:#6B7280;line-height:1.8;font-size:15px;margin:0 0 24px;">
              Congratulations — you've been shortlisted for a <strong style="color:#2D3748;">live interview</strong>
              for the <strong style="color:#2D3748;">${job_title}</strong> position${companyStr}.
            </p>
            <p style="color:#6B7280;line-height:1.8;font-size:15px;margin:0 0 24px;">
              Please choose a time that works for you using the link below. The slot you pick will be confirmed immediately — no back-and-forth needed.
            </p>
            <div style="text-align:center;margin:32px 0;">
              <a href="${scheduling_link}" style="background:#B8924A;color:white;padding:14px 40px;text-decoration:none;font-family:monospace;font-size:12px;letter-spacing:0.1em;text-transform:uppercase;display:inline-block;">CHOOSE YOUR INTERVIEW SLOT →</a>
            </div>
            <div style="background:#F8F7F4;border:1px solid #E8E4DC;border-left:4px solid #B8924A;padding:16px 20px;margin:24px 0;">
              <p style="margin:0 0 6px;color:#6B7280;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;font-family:monospace;">Scheduling link</p>
              <a href="${scheduling_link}" style="color:#B8924A;font-size:13px;word-break:break-all;">${scheduling_link}</a>
            </div>
            <p style="color:#9CA3AF;font-size:13px;line-height:1.6;margin:24px 0 0;padding-top:24px;border-top:1px solid #E8E4DC;">
              Once you select a slot, you'll receive a calendar invite with the video call link. Ensure you're in a quiet, well-lit space with camera and microphone ready.
            </p>
          </div>
          <p style="text-align:center;color:#9CA3AF;font-size:11px;margin-top:24px;letter-spacing:0.08em;">ONE SELECT — STRATEGIC TALENT SOLUTIONS</p>
        </div>
      `,
    }, email)

    return new Response(JSON.stringify({ success: emailSent }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  } catch (err) {
    console.error("[send-cal-invite]", err)
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }
})
