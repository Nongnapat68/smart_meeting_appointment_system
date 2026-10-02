-- Reminder offsets get an upper bound, and out-of-range offsets are rejected
-- instead of silently skipped.
--
-- create_meeting_with_participants() is what MeetingForm calls (via
-- supabase.rpc) when creating a meeting, so it is the server-side gate for
-- p_reminder_offset_minutes — anyone with a session can call it directly,
-- skipping the form. Before this migration it had no upper bound (an offset
-- of 99999999 minutes put scheduledAt in 1836: already "due", so the next
-- process-due would send it immediately) and it silently dropped offsets
-- <= 0, so the caller never learned why a reminder was missing.
--
-- The bound (1 .. 43200 minutes = 30 days) matches REMINDER_OFFSET_MAX_MINUTES
-- in src/lib/validations.ts, which POST /api/reminders (adding a reminder to
-- an existing meeting) enforces through Zod. The largest preset in the form
-- is 7 days; 30 days leaves room for custom "2 weeks / 1 month before" values.
--
-- The check runs before the Meeting insert, so a bad offset leaves nothing
-- behind. Everything else in the body is unchanged from
-- 20260911170000_create_meeting_with_participants_function.

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
    RAISE EXCEPTION 'ต้องเข้าสู่ระบบก่อนใช้งาน' USING ERRCODE = '28000';
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
  -- Reminder offsets: 1 .. 43200 minutes (30 days) — see header.
  IF p_reminder_offset_minutes IS NOT NULL THEN
    FOREACH v_offset IN ARRAY p_reminder_offset_minutes LOOP
      IF v_offset IS NULL OR v_offset < 1 THEN
        RAISE EXCEPTION 'จำนวนนาทีของการแจ้งเตือนต้องมากกว่า 0' USING ERRCODE = '22023';
      END IF;
      IF v_offset > 43200 THEN
        RAISE EXCEPTION 'แจ้งเตือนล่วงหน้าได้ไม่เกิน 43200 นาที (30 วัน)' USING ERRCODE = '22023';
      END IF;
    END LOOP;
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
      CASE WHEN m."personId" = v_organizer_person_id THEN 'DIRECT' ELSE 'GROUP' END::public."ParticipantSource",
      CASE WHEN m."personId" = v_organizer_person_id THEN NULL ELSE m."groupId" END
    FROM (
      SELECT DISTINCT ON (cgm."personId") cgm."personId", cgm."groupId"
      FROM public."ContactGroupMember" cgm
      WHERE cgm."groupId" = ANY(p_group_ids)
      ORDER BY cgm."personId", array_position(p_group_ids, cgm."groupId")
    ) m
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
  IF p_reminder_offset_minutes IS NOT NULL THEN
    FOREACH v_offset IN ARRAY p_reminder_offset_minutes LOOP
      -- every offset was range-checked above, before the Meeting insert
      INSERT INTO public."Reminder" (id, "meetingId", "scheduledAt", status, "createdAt")
      VALUES (gen_random_uuid()::text, v_meeting_id, p_start_time - (v_offset || ' minutes')::interval, 'PENDING', now());
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
  'Hybrid migration round 1 (Meeting resource): atomic replacement for POST /api/meetings — inserts Meeting, MeetingParticipant (DIRECT/GROUP/EXTERNAL, same precedence as resolveParticipants()), Reminder per offset, and Notification per invited internal user, all in one function body (auto-rollback on any failure). SECURITY DEFINER so a MEMBER organizer can insert Notification rows for other invitees despite the admin-only Notification INSERT policy — safe only because auth.uid() is checked against p_organizer_id (or is_admin()) before anything else runs. See docs/DESIGN_DECISIONS.md.';

REVOKE ALL ON FUNCTION public.create_meeting_with_participants(
  uuid, text, timestamp, timestamp, text, text, text, text, text, text, text[], text[], text[], int[]
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_meeting_with_participants(
  uuid, text, timestamp, timestamp, text, text, text, text, text, text, text[], text[], text[], int[]
) TO authenticated;
