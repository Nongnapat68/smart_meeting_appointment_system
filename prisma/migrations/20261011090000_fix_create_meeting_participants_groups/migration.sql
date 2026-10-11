-- B1 (final audit round): create_meeting_with_participants() failed whenever
-- a meeting was created with whole groups (p_group_ids) selected. The GROUP
-- participant step (4) joined "_MeetingGroups" as mg but read mg."groupId" -
-- an implicit Prisma M:N join table holds only "A"/"B" (A -> ContactGroup,
-- B -> Meeting, see init_postgres FK _MeetingGroups_A_fkey/_B_fkey), so the
-- query aborted with `column mg.groupId does not exist`. The outer SELECT also
-- referenced the derived table by the wrong alias (m. vs g.).
--
-- Fix: keep everything else byte-for-byte identical to
-- 20261004120000_meeting_reminder_dedupe (SECURITY DEFINER, search_path='',
-- auth first, N6 past-start check, DIRECT/GROUP/EXTERNAL precedence, FR-10
-- reminder dedup) and correct only this GROUP step: read the group id from
-- "_MeetingGroups"."A", and reference the derived table "g" consistently.
-- Using CREATE OR REPLACE, the signature and existing EXECUTE grants are
-- preserved; REVOKE+GRANT below are re-asserted to match the original ACL.
--
-- Only the function is (re)defined here; the "Reminder" dedup DELETE from
-- 20261004120000 is data cleanup that already ran once and must not repeat.

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
  v_seen_offsets int[] := '{}';
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
      gen_random_uuid()::text, v_meeting_id, g."personId",
      CASE WHEN g."personId" = v_organizer_person_id THEN 'ORGANIZER' ELSE 'ATTENDEE' END::public."ParticipantRole",
      'PENDING'::public."RsvpStatus",
      'GROUP'::public."ParticipantSource",
      g."groupId"
    FROM (
      SELECT DISTINCT ON (mp."personId") mp."personId", mg."A" AS "groupId"
      FROM public."_MeetingGroups" mg
      JOIN public."ContactGroupMember" mp ON mp."groupId" = mg."A"
      WHERE mg."B" = v_meeting_id
      ORDER BY mp."personId", mg."A"
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
  --
  -- FR-10 dedup: v_seen_offsets records the offsets already inserted, so a
  -- repeated value in p_reminder_offset_minutes contributes one reminder, not
  -- two rows at the same instant. Tracked explicitly rather than de-duplicating
  -- the array up front so the loop below, and the order rows are created in,
  -- stay exactly as they were.
  IF p_reminder_offset_minutes IS NOT NULL THEN
    FOREACH v_offset IN ARRAY p_reminder_offset_minutes LOOP
      IF v_offset > 0 AND NOT (v_offset = ANY(v_seen_offsets)) THEN
        v_seen_offsets := array_append(v_seen_offsets, v_offset);
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
  'Hybrid migration round 1 (Meeting resource): atomic replacement for POST /api/meetings - inserts Meeting, MeetingParticipant (DIRECT/GROUP/EXTERNAL, same precedence as resolveParticipants()), Reminder per offset, and Notification per invited internal user, all in one function body (auto-rollback on any failure). SECURITY DEFINER so a MEMBER organizer can insert Notification rows for other invitees despite the admin-only Notification INSERT policy - safe only because auth.uid() is checked against p_organizer_id (or is_admin()) before anything else runs. Rejects a start time in the past (N6) and stores a reminder whose offset would land in the past as CANCELLED instead of PENDING (N7). A repeated offset in p_reminder_offset_minutes creates one reminder, not two (FR-10). See docs/DESIGN_DECISIONS.md.';

REVOKE ALL ON FUNCTION public.create_meeting_with_participants(
  uuid, text, timestamp, timestamp, text, text, text, text, text, text, text[], text[], text[], int[]
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_meeting_with_participants(
  uuid, text, timestamp, timestamp, text, text, text, text, text, text, text[], text[], text[], int[]
) TO authenticated;
