// Cal.com webhook receiver — must be deployed with --no-verify-jwt
// Cal.com calls this unauthenticated; we verify by matching booking UIDs.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "content-type",
      },
    })
  }

  try {
    const body = await req.json()
    const triggerEvent: string = body.triggerEvent ?? body.type ?? ""
    const payload             = body.payload ?? body

    const supabaseUrl  = Deno.env.get("SUPABASE_URL") ?? ""
    const serviceKey   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    const db           = createClient(supabaseUrl, serviceKey)

    const bookingUid: string   = payload.uid ?? ""
    const startTime: string    = payload.startTime ?? ""
    const meetingUrl: string   =
      payload.videoCallData?.url ??
      payload.location ??
      payload.metadata?.videoCallUrl ?? ""

    const metadata = payload.metadata ?? {}
    const candidateId: string  = metadata.candidate_id ?? ""
    const jobMatchId: string   = metadata.job_match_id ?? ""
    const jobId: string        = metadata.job_id ?? ""

    if (triggerEvent === "BOOKING_CREATED") {
      // Try to find an existing pending row first (matched by candidate + job)
      let existingId: string | null = null

      if (candidateId || jobMatchId) {
        const col   = candidateId ? "candidate_id" : "job_match_id"
        const val   = candidateId || jobMatchId
        const { data } = await db
          .from("interview_bookings")
          .select("id")
          .eq(col, val)
          .eq("status", "pending")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle()
        existingId = data?.id ?? null
      }

      const update = {
        cal_booking_uid: bookingUid,
        scheduled_at:    startTime || null,
        meeting_link:    meetingUrl || null,
        status:          "confirmed",
      }

      if (existingId) {
        await db.from("interview_bookings").update(update).eq("id", existingId)
      } else {
        // No pending row — insert fresh (covers direct Cal.com bookings)
        await db.from("interview_bookings").insert({
          ...update,
          candidate_id:  candidateId || null,
          job_match_id:  jobMatchId  || null,
          job_id:        jobId       || null,
        })
      }

      // Move candidate to live_interview_scheduled stage
      if (candidateId) {
        await db.from("candidates")
          .update({ live_interview_status: "scheduled", live_room_url: meetingUrl || null })
          .eq("id", candidateId)
      } else if (jobMatchId) {
        await db.from("job_matches")
          .update({ live_interview_status: "scheduled", live_room_url: meetingUrl || null })
          .eq("id", jobMatchId)
      }

    } else if (triggerEvent === "BOOKING_CANCELLED") {
      if (bookingUid) {
        await db.from("interview_bookings")
          .update({ status: "cancelled" })
          .eq("cal_booking_uid", bookingUid)
      }

    } else if (triggerEvent === "BOOKING_RESCHEDULED") {
      if (bookingUid) {
        await db.from("interview_bookings")
          .update({ status: "rescheduled", scheduled_at: startTime || null, meeting_link: meetingUrl || null })
          .eq("cal_booking_uid", bookingUid)
      } else if (candidateId || jobMatchId) {
        const col = candidateId ? "candidate_id" : "job_match_id"
        const val = candidateId || jobMatchId
        await db.from("interview_bookings")
          .update({ status: "rescheduled", scheduled_at: startTime || null, meeting_link: meetingUrl || null })
          .eq(col, val)
          .eq("status", "confirmed")
      }
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { "Content-Type": "application/json" },
    })
  } catch (err) {
    console.error("[cal-webhook]", err)
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    })
  }
})
