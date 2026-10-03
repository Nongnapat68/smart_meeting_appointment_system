-- N6: the only guard against a past meeting start lived in the browser
-- (MeetingForm.tsx handleSubmit). The frontend calls both of these functions
-- directly through supabase-js, so calling them straight from the console - or
-- from any client that skipped the form - created or moved a meeting into the
-- past. A meeting dated backwards also got reminders whose scheduledAt was
-- already in the past, which process_due_reminders() then picked up on its
-- very next run.
--
-- reschedule_meeting() (20261002100000) has rejected a past start since it was
-- written. These two functions are its create/edit counterparts and had no such
-- check, so both get the same one here, phrased identically:
--
--   IF p_start_time < (now() AT TIME ZONE 'UTC') THEN RAISE EXCEPTION ...
--
-- (now() AT TIME ZONE 'UTC') is what matches the column: "startTime" is
-- TIMESTAMP(3) with no time zone holding a UTC wall-clock value, and now()
-- cast straight to timestamp would use the *server's* zone instead.
--
-- N7 rides along: create_meeting_with_participants() inserted every requested
-- reminder offset as PENDING, so an offset longer than the gap to the meeting
-- start produced a reminder already in the past, which process-due would send
-- immediately - while reschedule_meeting() refuses that same situation by
-- marking the reminder CANCELLED. Create now does the same instead, so the
-- two paths agree.
--
-- N4 rides along: update_meeting_with_participants() never touched Reminder,
-- so saving the edit form with a new time left pending reminders pointing at
-- the old start. It now shifts them by the same delta reschedule_meeting()
-- uses, cancelling any that would land in the past.
--
-- Everything else in all three functions is copied verbatim from the versions
-- they replace (create: 20260911170000, update: 20261002120000 which itself
-- follows 20261002110000) - SECURITY DEFINER/INVOKER, authorization order, the
-- participant diff, the external-email reuse. Nothing else is touched.

-- ---------------------------------------------------------------------------
-- create_meeting_with_participants()
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_meeting_with_participants(
  p_organizer_id uuid,
  p_title text,
  p_start_time timestamp,
  p_end_time timestamp,
  p_description text DEFAULT NULL,
  p_type text DEFAULT 'SINGLE',
  p_status text DEFAULT 'PENDING',
  p_location text DEFAULT NULL,
  p_project_id text DEFAULT NULL,
  p_online_meeting_resource_id text DEFAULT NULL,
  p_participant_person_ids text[] DEFAULT '{}',
  p_group_ids text[] DEFAULT '{}',
  p_external_emails text[] DEFAULT '{}',
  p_reminder_offset_minutes int[] DEFAULT ARRAY[30]
)
RETURNS public."Meeting"
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id uuid;
  v_meeting_id text;
  v_organizer_person_id text;
  v_email text;
  v_person_id text;
  v_offset int;
  v_meeting public."Meeting";
BEGIN
  -- ---- Authorization FIRST, before touching any table (see header) ----
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'กรุณาเข้าสู่ระบบก่อนใช้งาน' USING ERRCODE = '28000';
  END IF;
  IF p_organizer_id IS DISTINCT FROM v_caller_id AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์สร้างการประชุมในนามผู้ใช้อื่น' USING ERRCODE = '42501';
  END IF;

  IF p_title IS NULL OR btrim(p_title) = '' THEN
    RAISE EXCEPTION 'กรุณากรอกหัวข้อการประชุม';
  END IF;
  IF p_end_time <= p_start_time THEN
    RAISE EXCEPTION 'เวลาสิ้นสุดต้องอยู่หลังเวลาเริ่ม';
  END IF;
  -- N6: the same past-start check reschedule_meeting() already had.
  IF p_start_time < (now() AT TIME ZONE 'UTC') THEN
    RAISE EXCEPTION 'เวลาเริ่มต้องเป็นอนาคต ไม่สามารถตั้งเป็นเวลาที่ผ่านมาแล้วได้';
  END IF;

  v_meeting_id := gen_random_uuid()::text;
  SELECT id INTO v_organizer_person_id FROM public."Person" WHERE "userId" = p_organizer_id;

  -- ---- 1. Meeting ----
  INSERT INTO public."Meeting" (
    id, title, description, type, status, "startTime", "endTime", location,
    "createdAt", "updatedAt", "organizerId", "organizerPersonId", "projectId",
    "onlineMeetingResourceId"
  ) VALUES (
    v_meeting_id, p_title, p_description, p_type::public."MeetingType", p_status::public."MeetingStatus",
    p_start_time, p_end_time, p_location, now(), now(), p_organizer_id, v_organizer_person_id,
    p_project_id, p_online_meeting_resource_id
  );

  -- ---- 2. Meeting <-> ContactGroup join rows ("เพิ่มทั้งกลุ่ม") ----
  IF p_group_ids IS NOT NULL AND array_length(p_group_ids, 1) > 0 THEN
    INSERT INTO public."_MeetingGroups" ("A", "B")
    SELECT DISTINCT g, v_meeting_id FROM unnest(p_group_ids) AS g
    ON CONFLICT DO NOTHING;
  END IF;

  -- ---- 3. MeetingParticipant — DIRECT (explicit picks always win; BR-04) ----
  IF p_participant_person_ids IS NOT NULL AND array_length(p_participant_person_ids, 1) > 0 THEN
    INSERT INTO public."MeetingParticipant" (id, "meetingId", "personId", role, "rsvpStatus", source, "sourceGroupId")
    SELECT
      gen_random_uuid()::text, v_meeting_id, pid,
      CASE WHEN pid = v_organizer_person_id THEN 'ORGANIZER' ELSE 'ATTENDEE' END::public."ParticipantRole",
      'PENDING'::public."RsvpStatus",
      'DIRECT'::public."ParticipantSource",
      NULL
    FROM (SELECT DISTINCT pid FROM unnest(p_participant_person_ids) AS pid) d
    ON CONFLICT ("meetingId", "personId") DO NOTHING;
  END IF;

  -- ---- 4. MeetingParticipant — GROUP (first selected group wins per person;
  -- ON CONFLICT DO NOTHING below skips anyone DIRECT already claimed) ----
  IF p_group_ids IS NOT NULL AND array_length(p_group_ids, 1) > 0 THEN
    INSERT INTO public."MeetingParticipant" (id, "meetingId", "personId", role, "rsvpStatus", source, "sourceGroupId")
    SELECT
      gen_random_uuid()::text, v_meeting_id, m."personId",
      CASE WHEN m."personId" = v_organizer_person_id THEN 'ORGANIZER' ELSE 'ATTENDEE' END::public."ParticipantRole",
      'PENDING'::public."RsvpStatus",
      'GROUP'::public."ParticipantSource",
      g."groupId"
    FROM (
      SELECT DISTINCT ON (mp."personId") mp."personId", mg."groupId"
      FROM public."_MeetingGroups" mg
      JOIN public."ContactGroupMember" mp ON mp."groupId" = mg."A"
      WHERE mg."B" = v_meeting_id
      ORDER BY mp."personId", mg."groupId"
    ) g
    ON CONFLICT ("meetingId", "personId") DO NOTHING;
  END IF;

  -- ---- 5. MeetingParticipant — EXTERNAL (upsert Person per raw email,
  -- one at a time, mirroring resolveParticipants()'s prisma upsert loop) ----
  IF p_external_emails IS NOT NULL THEN
    FOREACH v_email IN ARRAY p_external_emails LOOP
      INSERT INTO public."Person" (id, name, email, type, status, "createdAt", "updatedAt")
      VALUES (gen_random_uuid()::text, split_part(v_email, '@', 1), v_email, 'EXTERNAL', 'ACTIVE', now(), now())
      ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
      RETURNING id INTO v_person_id;

      INSERT INTO public."MeetingParticipant" (id, "meetingId", "personId", role, "rsvpStatus", source, "sourceGroupId")
      VALUES (
        gen_random_uuid()::text, v_meeting_id, v_person_id,
        CASE WHEN v_person_id = v_organizer_person_id THEN 'ORGANIZER' ELSE 'ATTENDEE' END::public."ParticipantRole",
        'PENDING'::public."RsvpStatus",
        CASE WHEN v_person_id = v_organizer_person_id THEN 'DIRECT' ELSE 'EXTERNAL' END::public."ParticipantSource",
        NULL
      )
      ON CONFLICT ("meetingId", "personId") DO NOTHING;
    END LOOP;
  END IF;

  -- ---- 6. Reminder — one row per requested offset (FR-10/BR-11) ----
  -- N7: an offset longer than the gap between now and p_start_time puts
  -- scheduledAt in the past, and process_due_reminders() would pick it up on
  -- the next run - emailing "starts soon" about a meeting that already
  -- started. reschedule_meeting() already refuses this same situation by
  -- marking the reminder CANCELLED, so create does the same rather than
  -- inserting a PENDING row that fires instantly. (POST /api/reminders rejects
  -- the equivalent request outright instead - src/app/api/reminders/route.ts.)
  IF p_reminder_offset_minutes IS NOT NULL THEN
    FOREACH v_offset IN ARRAY p_reminder_offset_minutes LOOP
      IF v_offset > 0 THEN
        INSERT INTO public."Reminder" (id, "meetingId", "scheduledAt", status, "createdAt")
        VALUES (
          gen_random_uuid()::text,
          v_meeting_id,
          p_start_time - (v_offset || ' minutes')::interval,
          CASE
            WHEN p_start_time - (v_offset || ' minutes')::interval <= (now() AT TIME ZONE 'UTC')
              THEN 'CANCELLED'::public."ReminderStatus"
            ELSE 'PENDING'::public."ReminderStatus"
          END,
          now()
        );
      END IF;
    END LOOP;
  END IF;

  -- ---- 7. Notification — every invited internal user except the organizer
  -- themselves. THE insert the Notification RLS policy would block for a
  -- MEMBER caller without this function's SECURITY DEFINER. ----
  INSERT INTO public."Notification" (id, "userId", type, title, body, "isRead", "relatedId", "createdAt")
  SELECT gen_random_uuid()::text, p."userId", 'MEETING_INVITE', 'คำเชิญเข้าร่วมประชุมใหม่', p_title, false, v_meeting_id, now()
  FROM public."MeetingParticipant" mp
  JOIN public."Person" p ON p.id = mp."personId"
  WHERE mp."meetingId" = v_meeting_id
    AND p."userId" IS NOT NULL
    AND p."userId" <> p_organizer_id;

  SELECT * INTO v_meeting FROM public."Meeting" WHERE id = v_meeting_id;
  RETURN v_meeting;
END;
$$;

COMMENT ON FUNCTION public.create_meeting_with_participants(
  uuid, text, timestamp, timestamp, text, text, text, text, text, text, text[], text[], text[], int[]
) IS
  'Hybrid migration round 1 (Meeting resource): atomic replacement for POST /api/meetings - inserts Meeting, MeetingParticipant (DIRECT/GROUP/EXTERNAL, same precedence as resolveParticipants()), Reminder per offset, and Notification per invited internal user, all in one function body (auto-rollback on any failure). SECURITY DEFINER so a MEMBER organizer can insert Notification rows for other invitees despite the admin-only Notification INSERT policy - safe only because auth.uid() is checked against p_organizer_id (or is_admin()) before anything else runs. Rejects a start time in the past (N6) and stores a reminder whose offset would land in the past as CANCELLED instead of PENDING (N7). See docs/DESIGN_DECISIONS.md.';

REVOKE ALL ON FUNCTION public.create_meeting_with_participants(
  uuid, text, timestamp, timestamp, text, text, text, text, text, text, text[], text[], text[], int[]
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_meeting_with_participants(
  uuid, text, timestamp, timestamp, text, text, text, text, text, text, text[], text[], text[], int[]
) TO authenticated;

-- ---------------------------------------------------------------------------
-- update_meeting_with_participants() — N6 (past start) and N4 (move the
-- pending reminders with the meeting).
-- ---------------------------------------------------------------------------
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
  v_old_start timestamp;
  v_meeting public."Meeting";
BEGIN
  SELECT "organizerId", "organizerPersonId", "startTime"
  INTO v_organizer_id, v_organizer_person_id, v_old_start
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
  -- N6: same past-start check as create and reschedule. Without it, editing a
  -- meeting's time was the easy way around the create-time guard.
  IF p_start_time < (now() AT TIME ZONE 'UTC') THEN
    RAISE EXCEPTION 'เวลาเริ่มต้องเป็นอนาคต ไม่สามารถตั้งเป็นเวลาที่ผ่านมาแล้วได้';
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

  -- ---- 1b. Reminder (N4): carry still-pending reminders along with the new
  -- start, the same way reschedule_meeting() does. Each shifts by the same
  -- delta as the meeting, so "30 minutes before" stays "30 minutes before";
  -- one that would now land in the past becomes CANCELLED instead of firing
  -- on the next process-due run. SENT/SIMULATED/FAILED/CANCELLED rows are
  -- untouched. ----
  UPDATE public."Reminder"
  SET "scheduledAt" = "scheduledAt" + (p_start_time - v_old_start),
      status = CASE
        WHEN "scheduledAt" + (p_start_time - v_old_start) <= (now() AT TIME ZONE 'UTC')
          THEN 'CANCELLED'::public."ReminderStatus"
        ELSE status
      END
  WHERE "meetingId" = p_meeting_id
    AND status = 'PENDING';

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
  'Atomic edit of a meeting: updates Meeting''s editable fields, shifts still-PENDING reminders by the same delta as the new start (N4), optionally replaces _MeetingGroups (p_group_ids IS NOT NULL), and - if any participant param is passed - diffs MeetingParticipant against the resolved DIRECT/GROUP/EXTERNAL list: participants still on the list keep their row (source, rsvpStatus, role) untouched, removed ones are deleted, new ones are inserted as PENDING. A GROUP row whose group is no longer invited is re-labelled to the source that now applies, keeping its rsvpStatus/role. An external email that matches an existing Person reuses that Person without writing to it. Rejects a start time in the past (N6). SECURITY INVOKER; organizer-or-admin. See 20261002110000, 20261002120000 and 20261003130000.';

REVOKE ALL ON FUNCTION public.update_meeting_with_participants(
  text, text, timestamp, timestamp, text, text, text, text, text, text, text[], text[], text[]
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_meeting_with_participants(
  text, text, timestamp, timestamp, text, text, text, text, text, text, text[], text[], text[]
) TO authenticated;