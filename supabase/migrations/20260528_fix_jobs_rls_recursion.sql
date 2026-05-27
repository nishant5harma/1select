-- Fix infinite recursion on jobs table
--
-- Root cause: "jobs_select_candidate" queried the candidates and job_matches
-- tables from within a jobs SELECT policy. Both of those tables have their own
-- RLS policies that query jobs back, creating a cycle:
--
--   jobs → jobs_select_candidate → candidates → candidates_select / Recruiters can
--          view own candidates → jobs  (cycle 1)
--
--   jobs → jobs_select_candidate → job_matches → job_matches_select /
--          recruiters_read_own_job_matches → jobs  (cycle 2)
--
-- Candidates can still read all active jobs via the pre-existing
-- public_read_active_jobs and candidates_read_active_jobs policies (status = 'active').
--
-- "Admins read all jobs" had qual = 'true' for ALL operations, silently granting
-- every authenticated user full read/write access to the jobs table.
-- Dropped as a security fix; admin access is covered by "Admins can manage all jobs"
-- and jobs_select_admin / jobs_insert_admin / jobs_update_admin / jobs_delete_admin.

DROP POLICY IF EXISTS "jobs_select_candidate" ON public.jobs;
DROP POLICY IF EXISTS "Admins read all jobs"  ON public.jobs;
