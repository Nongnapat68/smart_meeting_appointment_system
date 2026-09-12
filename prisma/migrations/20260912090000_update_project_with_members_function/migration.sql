-- Function #7 (hybrid migration — Projects resource):
-- update_project_with_members(...) — atomic replacement for the
-- member-replace step of PUT /api/projects/[id]. Prisma's current handler
-- does update Project -> deleteMany ProjectMember -> create new
-- ProjectMember rows as one Prisma call, which Prisma itself sends as a
-- single nested-write request; supabase-js has no equivalent multi-
-- statement transaction primitive for three separate table writes, so
-- doing this straight from the browser would need three round trips with
-- no rollback if the last one failed (e.g. a bogus personId). One
-- function body fixes that the same way create_meeting_with_participants()
-- did for meeting creation: it runs inside the calling statement's own
-- transaction, so any failure (including a ProjectMember_personId_fkey
-- FK violation) rolls back the UPDATE and DELETE that already ran too.
--
-- Note: this is a full-replace RPC, not a partial PATCH — every editable
-- field (name/description/status/startDate/endDate) is required on every
-- call, same shape as create_meeting_with_participants()'s field list.
-- PUT /api/projects/[id] itself is NOT wired to this function this round
-- (no frontend page currently calls it — projects/page.tsx only has
-- list+create, and projects/[id]/page.tsx is a read-only Server
-- Component); this migration adds the function as verified, ready
-- infrastructure for whenever project editing gets a UI and its own
-- hybrid-migration round, mirroring how earlier read-only/single-purpose
-- functions in this file were added ahead of their eventual callers.
--
-- SECURITY INVOKER (unlike create_meeting_with_participants(), which is
-- DEFINER — see docs/DESIGN_DECISIONS.md §5.5, and §5.6 added below for
-- why this one differs): every statement in this body runs as the calling
-- user, so Project's own update_manager_or_admin RLS policy
-- ("managerId" = auth.uid() OR is_admin()) already blocks a non-manager,
-- non-admin caller at the very first UPDATE, before any ProjectMember row
-- is touched. Unlike create_meeting_with_participants() (which must write
-- Notification rows the caller has no RLS permission to write directly),
-- nothing in this function needs to write anything the calling manager
-- couldn't already write themselves one statement at a time — so there is
-- no privilege to bypass, and therefore no separate authorization check
-- to hand-write in the function body either. A blocked UPDATE matches 0
-- rows (RLS filters silently, does not raise), which the `IF NOT FOUND`
-- check below turns into an explicit exception instead of the function
-- silently deleting/reinserting ProjectMember rows for a project it was
-- never allowed to touch in the first place.
--
-- SET search_path = '' — same defense-in-depth as every other function
-- here; every identifier below is schema-qualified (public."Project"
-- etc.) except plain built-ins (now(), gen_random_uuid(), unnest()),
-- which resolve via pg_catalog regardless of search_path.

CREATE OR REPLACE FUNCTION public.update_project_with_members(
  p_project_id text,
  p_name text,
  p_description text,
  p_status text,
  p_start_date timestamp,
  p_end_date timestamp,
  p_member_person_ids text[]
)
RETURNS public."Project"
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_project public."Project";
BEGIN
  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'กรุณากรอกชื่อโปรเจกต์';
  END IF;

  -- ---- 1. Project's own editable fields ----
  UPDATE public."Project"
  SET "name" = p_name,
      "description" = p_description,
      "status" = p_status::public."ProjectStatus",
      "startDate" = p_start_date,
      "endDate" = p_end_date,
      "updatedAt" = now()
  WHERE "id" = p_project_id
  RETURNING * INTO v_project;

  -- update_manager_or_admin blocks a non-manager/non-admin caller here
  -- silently (0 rows, no exception) — surface it explicitly instead of
  -- falling through to touch ProjectMember for a project this caller was
  -- never allowed to edit.
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ไม่พบโปรเจกต์นี้ หรือคุณไม่มีสิทธิ์แก้ไข';
  END IF;

  -- ---- 2. Replace ProjectMember wholesale (empty array = remove all,
  -- not an error — same "no error on empty" contract the request asked
  -- for) ----
  DELETE FROM public."ProjectMember" WHERE "projectId" = p_project_id;

  IF p_member_person_ids IS NOT NULL AND array_length(p_member_person_ids, 1) > 0 THEN
    -- ProjectMember.id has no DB default (Prisma's @default(cuid()) is
    -- client-side-only, same as every other cuid() id in this schema), so
    -- it's generated here explicitly. DISTINCT guards against
    -- @@unique(["projectId","personId"]) if the same id is passed twice.
    -- A personId with no matching Person row hits the
    -- ProjectMember_personId_fkey FK violation (23503) here and the whole
    -- function aborts — the UPDATE and DELETE above roll back with it, so
    -- the project is never left with its old fields but no members, or
    -- new fields but a half-applied member list.
    INSERT INTO public."ProjectMember" ("id", "projectId", "personId")
    SELECT gen_random_uuid()::text, p_project_id, person_id
    FROM (SELECT DISTINCT person_id FROM unnest(p_member_person_ids) AS person_id) d;
  END IF;

  RETURN v_project;
END;
$$;

COMMENT ON FUNCTION public.update_project_with_members(
  text, text, text, text, timestamp, timestamp, text[]
) IS
  'Atomic replacement for PUT /api/projects/[id]''s member-replace step: updates Project''s editable fields, then replaces every ProjectMember row for it with p_member_person_ids in one function body (auto-rollback on any failure, e.g. a bogus personId hitting the ProjectMember_personId_fkey FK violation). Full-replace, not a partial PATCH. SECURITY INVOKER, not DEFINER: Project''s own update_manager_or_admin RLS policy already blocks a non-manager/non-admin caller at the first UPDATE, so no separate authorization check is written into the function body. See docs/DESIGN_DECISIONS.md §5.6.';

REVOKE ALL ON FUNCTION public.update_project_with_members(
  text, text, text, text, timestamp, timestamp, text[]
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_project_with_members(
  text, text, text, text, timestamp, timestamp, text[]
) TO authenticated;
