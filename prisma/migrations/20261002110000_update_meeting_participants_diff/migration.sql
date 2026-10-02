-- Replaces update_meeting_with_participants()'s participant step (from
-- 20260912100000_update_meeting_with_participants_function) — same signature,
-- same meeting/_MeetingGroups handling, same authorization — with a diff
-- instead of a full replace.
--
-- The old step 3 DELETEd every MeetingParticipant row of the meeting and
-- re-INSERTed the whole list, so every save of the edit form:
--   * reset everyone's rsvpStatus to PENDING (ACCEPTED/DECLINED lost), and
--   * flattened EXTERNAL participants into DIRECT — MeetingForm.tsx keeps
--     every non-GROUP participant (DIRECT and EXTERNAL alike) as a bare Person
--     in `selectedPeople` and sends them all back in p_participant_person_ids,
--     which step 3a always inserted as DIRECT.
--
-- Now the wanted list is resolved exactly as before (DIRECT picks first,
-- then GROUP members — first selected group wins — then raw external emails;
-- the organizer's own Person is always DIRECT) and compared with the rows
-- that already exist:
--   * still wanted  -> the existing row is left untouched: same id, role,
--                      source, sourceGroupId and rsvpStatus;
--   * no longer wanted -> that row is deleted;
--   * newly wanted  -> a new row, rsvpStatus PENDING as usual.
-- One exception to "untouched": a GROUP row whose sourceGroupId is no longer
-- among the meeting's groups (the group was removed from the invite, or was
-- deleted and SetNull'ed) would keep pointing at a group that isn't invited
-- any more. If that person is still wanted some other way (picked directly,
-- or via another selected group) the row is re-created with the source/group
-- that now applies, but its rsvpStatus and role are carried over.
--
-- MeetingParticipant has no UPDATE grant for `authenticated` (only SELECT/
-- INSERT/DELETE, see enable_rls_policies), so that one re-labelling is a
-- delete + insert rather than an UPDATE; the function stays SECURITY INVOKER
-- and every write is still gated by the existing organizer-or-admin RLS
-- policies. Everything runs in one function call, so it is atomic as before.
--
-- Unchanged on purpose: NULL on all three participant params still means
-- "leave participants alone"; the external-email Person upsert is the same
-- statement as before (including its known RLS edge case for an email that
-- belongs to another user's linked Person — a separate finding, not touched
-- here).

CREATE OR REPLACE FUNCTION public.update_meeting_with_participants(
  p_meeting_id text,
  p_title text,
  p_start_time timestamp,
  p_end_time timestamp,
  p_description text DEFAULT NULL,
  p_type text DEFAULT 'SINGLE',
  p_status text DEFAULT 'PENDING',
  p_location text DEFAULT NULL,
  p_project_id text DEFAULT NULL,
  p_online_meeting_resource_id text DEFAULT NULL,
  p_participant_person_ids text[] DEFAULT NULL,
  p_group_ids text[] DEFAULT NULL,
  p_external_emails text[] DEFAULT NULL
)
RETURNS public."Meeting"
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_organizer_id uuid;
  v_organizer_person_id text;
  v_email text;
  v_person_id text;
  v_external_ids text[] := '{}';
  v_groups text[];
  v_wanted jsonb;
  v_relabel jsonb;
  v_meeting public."Meeting";
BEGIN
  SELECT "organizerId", "organizerPersonId" INTO v_organizer_id, v_organizer_person_id
  FROM public."Meeting" WHERE id = p_meeting_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ไม่พบการประชุมนี้';
  END IF;

  IF v_organizer_id IS DISTINCT FROM auth.uid() AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'เฉพาะผู้จัดประชุมหรือผู้ดูแลระบบเท่านั้นที่แก้ไขการประชุมนี้ได้' USING ERRCODE = '42501';
  END IF;

  IF p_title IS NULL OR btrim(p_title) = '' THEN
    RAISE EXCEPTION 'กรุณากรอกหัวข้อการประชุม';
  END IF;
  IF p_end_time <= p_start_time THEN
    RAISE EXCEPTION 'เวลาสิ้นสุดต้องอยู่หลังเวลาเริ่ม';
  END IF;

  -- ---- 1. Meeting's own editable fields (unchanged) ----
  UPDATE public."Meeting"
  SET title = p_title,
      description = p_description,
      type = p_type::public."MeetingType",
      status = p_status::public."MeetingStatus",
      "startTime" = p_start_time,
      "endTime" = p_end_time,
      location = p_location,
      "projectId" = p_project_id,
      "onlineMeetingResourceId" = p_online_meeting_resource_id,
      "updatedAt" = now()
  WHERE id = p_meeting_id;

  -- ---- 2. _MeetingGroups (unchanged): NULL = leave alone ----
  IF p_group_ids IS NOT NULL THEN
    DELETE FROM public."_MeetingGroups" WHERE "B" = p_meeting_id;
    IF array_length(p_group_ids, 1) > 0 THEN
      INSERT INTO public."_MeetingGroups" ("A", "B")
      SELECT DISTINCT g, p_meeting_id FROM unnest(p_group_ids) AS g
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  -- ---- 3. MeetingParticipant — diff against the existing rows ----
  IF p_participant_person_ids IS NOT NULL OR p_group_ids IS NOT NULL OR p_external_emails IS NOT NULL THEN
    v_groups := COALESCE(p_group_ids, '{}');

    -- 3a. Resolve raw external emails to Person ids (same upsert as before).
    IF p_external_emails IS NOT NULL THEN
      FOREACH v_email IN ARRAY p_external_emails LOOP
        INSERT INTO public."Person" (id, name, email, type, status, "createdAt", "updatedAt")
        VALUES (gen_random_uuid()::text, split_part(v_email, '@', 1), v_email, 'EXTERNAL', 'ACTIVE', now(), now())
        ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
        RETURNING id INTO v_person_id;
        v_external_ids := array_append(v_external_ids, v_person_id);
      END LOOP;
    END IF;

    -- 3b. The wanted list, one entry per person: DIRECT > GROUP (first
    -- selected group) > EXTERNAL; the organizer's Person is always DIRECT.
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'pid', w.person_id,
             'src', CASE WHEN w.person_id = v_organizer_person_id THEN 'DIRECT' ELSE w.src END,
             'gid', CASE WHEN w.person_id = v_organizer_person_id THEN NULL ELSE w.gid END
           )), '[]'::jsonb)
    INTO v_wanted
    FROM (
      SELECT DISTINCT ON (c.person_id) c.person_id, c.src, c.gid
      FROM (
        SELECT pid AS person_id, 'DIRECT' AS src, NULL::text AS gid, 1 AS prio, 0 AS pos
        FROM unnest(COALESCE(p_participant_person_ids, '{}')) AS pid
        UNION ALL
        SELECT cgm."personId", 'GROUP', cgm."groupId", 2, array_position(v_groups, cgm."groupId")
        FROM public."ContactGroupMember" cgm
        WHERE cgm."groupId" = ANY(v_groups)
        UNION ALL
        SELECT pid, 'EXTERNAL', NULL, 3, 0
        FROM unnest(v_external_ids) AS pid
      ) c
      ORDER BY c.person_id, c.prio, c.pos
    ) w;

    -- 3c. GROUP rows whose group is no longer invited but whose person is
    -- still wanted: remember rsvp/role so the re-created row keeps them.
    SELECT COALESCE(jsonb_object_agg(mp."personId", jsonb_build_object('rsvp', mp."rsvpStatus", 'role', mp.role)), '{}'::jsonb)
    INTO v_relabel
    FROM public."MeetingParticipant" mp
    WHERE mp."meetingId" = p_meeting_id
      AND mp.source = 'GROUP'
      AND (mp."sourceGroupId" IS NULL OR NOT (mp."sourceGroupId" = ANY(v_groups)))
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_wanted) d WHERE d->>'pid' = mp."personId");

    -- 3d. Remove rows that are no longer wanted, plus the stale-group rows
    -- captured above (re-created in 3e).
    DELETE FROM public."MeetingParticipant" mp
    WHERE mp."meetingId" = p_meeting_id
      AND (
        NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_wanted) d WHERE d->>'pid' = mp."personId")
        OR v_relabel ? mp."personId"
      );

    -- 3e. Insert wanted people who don't have a row (new ones -> PENDING;
    -- re-labelled ones -> their previous rsvp/role). Existing rows are
    -- skipped by ON CONFLICT and so stay exactly as they were.
    INSERT INTO public."MeetingParticipant" (id, "meetingId", "personId", role, "rsvpStatus", source, "sourceGroupId")
    SELECT
      gen_random_uuid()::text, p_meeting_id, d.pid,
      COALESCE(
        (v_relabel -> d.pid ->> 'role'),
        CASE WHEN d.pid = v_organizer_person_id THEN 'ORGANIZER' ELSE 'ATTENDEE' END
      )::public."ParticipantRole",
      COALESCE((v_relabel -> d.pid ->> 'rsvp'), 'PENDING')::public."RsvpStatus",
      d.src::public."ParticipantSource",
      d.gid
    FROM jsonb_to_recordset(v_wanted) AS d(pid text, src text, gid text)
    ON CONFLICT ("meetingId", "personId") DO NOTHING;
  END IF;

  SELECT * INTO v_meeting FROM public."Meeting" WHERE id = p_meeting_id;
  RETURN v_meeting;
END;
$$;

COMMENT ON FUNCTION public.update_meeting_with_participants(
  text, text, timestamp, timestamp, text, text, text, text, text, text, text[], text[], text[]
) IS
  'Atomic edit of a meeting: updates Meeting''s editable fields, optionally replaces _MeetingGroups (p_group_ids IS NOT NULL), and — if any participant param is passed — diffs MeetingParticipant against the resolved DIRECT/GROUP/EXTERNAL list: participants still on the list keep their row (source, rsvpStatus, role) untouched, removed ones are deleted, new ones are inserted as PENDING. A GROUP row whose group is no longer invited is re-labelled to the source that now applies, keeping its rsvpStatus/role. SECURITY INVOKER; organizer-or-admin. See 20261002110000_update_meeting_participants_diff.';
