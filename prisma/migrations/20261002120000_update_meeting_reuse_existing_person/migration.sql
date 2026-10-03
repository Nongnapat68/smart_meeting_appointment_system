-- Fixes the external-email step of update_meeting_with_participants()
-- (last replaced in 20261002110000_update_meeting_participants_diff); the
-- rest of the function — meeting fields, _MeetingGroups, the participant
-- diff, authorization — is copied unchanged.
--
-- Step 3a turned each raw external email into a Person id with
--   INSERT ... ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
--   RETURNING id
-- The DO UPDATE never changes anything (it rewrites email with the same
-- value); it only existed so RETURNING would also yield the id of an
-- existing row. But it is still an UPDATE, and this function is SECURITY
-- INVOKER, so Person's "update_unlinked_or_owner_or_admin" RLS policy is
-- checked against the existing row. When the email belongs to a Person that
-- is linked to another user's account, that check fails and the whole save
-- aborts with 42501 "new row violates row-level security policy (USING
-- expression) for table Person".
--
-- Now an email that already belongs to any Person (linked to a user or not)
-- simply reuses that Person as the participant, and its row is never
-- written: look it up first (Person SELECT is open to every signed-in user),
-- and only INSERT a new EXTERNAL Person when there is none. The INSERT uses
-- ON CONFLICT (email) DO NOTHING plus a second lookup, so a concurrent insert
-- of the same email between the two statements still resolves to that row
-- instead of erroring. Matching stays exact (case-sensitive), as before.
--
-- create_meeting_with_participants() has the same DO UPDATE but is SECURITY
-- DEFINER (owner postgres, BYPASSRLS), so it never hit this error and is
-- left as is.

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

    -- 3a. Resolve raw external emails to Person ids. An email that already
    -- belongs to a Person reuses it untouched (no UPDATE, so no RLS check
    -- on someone else's row); otherwise a new EXTERNAL Person is created.
    IF p_external_emails IS NOT NULL THEN
      FOREACH v_email IN ARRAY p_external_emails LOOP
        SELECT id INTO v_person_id FROM public."Person" WHERE email = v_email;
        IF NOT FOUND THEN
          INSERT INTO public."Person" (id, name, email, type, status, "createdAt", "updatedAt")
          VALUES (gen_random_uuid()::text, split_part(v_email, '@', 1), v_email, 'EXTERNAL', 'ACTIVE', now(), now())
          ON CONFLICT (email) DO NOTHING
          RETURNING id INTO v_person_id;
          IF v_person_id IS NULL THEN
            SELECT id INTO v_person_id FROM public."Person" WHERE email = v_email;
          END IF;
        END IF;
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
  'Atomic edit of a meeting: updates Meeting''s editable fields, optionally replaces _MeetingGroups (p_group_ids IS NOT NULL), and — if any participant param is passed — diffs MeetingParticipant against the resolved DIRECT/GROUP/EXTERNAL list: participants still on the list keep their row (source, rsvpStatus, role) untouched, removed ones are deleted, new ones are inserted as PENDING. A GROUP row whose group is no longer invited is re-labelled to the source that now applies, keeping its rsvpStatus/role. An external email that matches an existing Person reuses that Person without writing to it; only unknown emails create a new EXTERNAL Person. SECURITY INVOKER; organizer-or-admin. See 20261002110000_update_meeting_participants_diff and 20261002120000_update_meeting_reuse_existing_person.';
