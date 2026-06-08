-- =============================================================================
-- Option A: Explicit recruiter-controlled client visibility
--
-- Previously candidates became visible to clients as soon as AI screening ran
-- (match_pass IS NOT NULL). This migration upgrades that to a deliberate
-- recruiter action: the recruiter must explicitly set shared_with_client = true
-- before a candidate appears in the client portal.
--
-- Changes:
--   1. Add shared_with_client column to candidates (default false)
--   2. Update candidates_select_client RLS to require shared_with_client = true
--   3. Update candidates_update_client RLS to require shared_with_client = true
-- =============================================================================

-- 1. Add column
ALTER TABLE public.candidates
  ADD COLUMN IF NOT EXISTS shared_with_client boolean NOT NULL DEFAULT false;

-- 2. Tighten client SELECT: must be explicitly shared by recruiter
DROP POLICY IF EXISTS "candidates_select_client" ON public.candidates;
CREATE POLICY "candidates_select_client" ON public.candidates
  FOR SELECT USING (
    get_my_role() = 'client'
    AND is_recruiter_job(job_id)
    AND match_pass IS NOT NULL
    AND shared_with_client = true
  );

-- 3. Tighten client UPDATE: can only update candidates that are visible to them
DROP POLICY IF EXISTS "candidates_update_client" ON public.candidates;
CREATE POLICY "candidates_update_client" ON public.candidates
  FOR UPDATE USING (
    get_my_role() = 'client'
    AND is_recruiter_job(job_id)
    AND match_pass IS NOT NULL
    AND shared_with_client = true
  );
