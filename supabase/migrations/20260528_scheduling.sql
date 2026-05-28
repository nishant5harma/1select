-- Cal.com self-scheduling: store booking intents and confirmed bookings

CREATE TABLE IF NOT EXISTS interview_bookings (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id      UUID        REFERENCES candidates(id)    ON DELETE CASCADE,
  job_match_id      UUID        REFERENCES job_matches(id)   ON DELETE CASCADE,
  job_id            UUID        REFERENCES jobs(id)          ON DELETE SET NULL,
  recruiter_id      UUID        REFERENCES profiles(id)      ON DELETE SET NULL,
  cal_booking_uid   TEXT        UNIQUE,
  cal_event_type_id TEXT,
  scheduled_at      TIMESTAMPTZ,
  duration_minutes  INT         DEFAULT 30,
  meeting_link      TEXT,
  status            TEXT        DEFAULT 'pending',  -- pending | confirmed | cancelled | rescheduled
  created_at        TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT chk_candidate CHECK (candidate_id IS NOT NULL OR job_match_id IS NOT NULL)
);

ALTER TABLE interview_bookings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins and recruiters can manage bookings"
  ON interview_bookings FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND user_role IN ('admin', 'recruiter')
    )
  );

CREATE POLICY "Candidates can view their bookings"
  ON interview_bookings FOR SELECT
  USING (
    candidate_id IN (SELECT id FROM candidates WHERE email = auth.email())
    OR
    job_match_id IN (
      SELECT jm.id FROM job_matches jm
      JOIN talent_pool tp ON tp.id = jm.talent_id
      WHERE tp.candidate_user_id = auth.uid()
    )
  );

-- Per-recruiter Cal.com settings
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS cal_username          TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS cal_event_type_slug   TEXT DEFAULT '30min';
