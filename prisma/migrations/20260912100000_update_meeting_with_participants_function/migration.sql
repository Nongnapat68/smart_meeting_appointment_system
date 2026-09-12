-- Function #8 (hybrid migration — Meeting resource, edit round):
-- update_meeting_with_participants(...) — atomic replacement for
-- PUT /api/meetings/[id]'s multi-step Prisma write (update Meeting fields ->
-- `groups: { set: [...] }` -> `participants: { deleteMany: {}, create: [...] }`),
-- all in one function body so a failure anywhere (e.g. a bogus personId) rolls
-- back the Meeting field update and group replace that already ran too — same
-- reasoning as create_meeting_with_participants() and
-- update_project_with_members() before it.
--
-- Three-way "not sent" vs "sent as empty" handling (mirrors the old handler's
-- own `participantPersonIds !== undefined` check, not a `!= null` check):
-- p_participant_person_ids / p_group_ids / p_external_emails all default to
-- NULL. NULL on all three (i.e. none of them passed at all) means "leave
-- groups and participants alone" — the old handler's `shouldResolveParticipants`
-- gate. Passing any one of them, even as an empty array (`ARRAY[]::text[]`,
-- NOT NULL), means "replace the whole participant list" — including wiping
-- every existing participant if all three come back empty after resolution.
-- p_group_ids specifically double-duties: NULL leaves `_MeetingGroups` alone
-- (mirrors the old `groupIds !== undefined` check gating `groups: { set }`
-- separately from `shouldResolveParticipants`), same as passing `{}` empties it.
--
-- Every other editable field (title/description/type/status/location/
-- startTime/endTime/projectId/onlineMeetingResourceId) is always supplied by
-- this function's one real caller (MeetingForm.tsx sends every field as a
-- decided value on every save, never omits one) so — unlike the participant
-- arrays above — there's no "omitted means keep old value" case to support
-- for them: each is a plain column SET from its parameter every call. This
-- is what "partial update" means here: a single UPDATE touching just
-- Meeting's own columns (not a delete+reinsert of the whole row), contrasted
-- with the full-replace strategy used for groups/participants — not a
-- per-field optional-vs-omitted contract like the three array params above.
--
-- SECURITY INVOKER (unlike create_meeting_with_participants(), which is
-- DEFINER — see docs/DESIGN_DECISIONS.md §5.5, and §5.7 added below for why
-- this one differs): every statement here runs as the calling user. Meeting's
-- own update_organizer_or_admin RLS policy and MeetingParticipant's
-- insert_meeting_organizer_or_admin/delete_meeting_organizer_or_admin
-- policies (plus the same shape on _MeetingGroups) already gate every write
-- this function makes — there is no Notification-style insert the caller
-- lacks direct RLS permission for (update, unlike create, never touches
-- Notification at all), so nothing here needs bypassing. The explicit
-- authorization check at the very top (against the meeting's *existing*
-- organizerId, not a caller-supplied parameter — update can't reassign the
-- organizer) exists to reproduce assertOwner()'s exact error message
-- up front, not because RLS wouldn't otherwise catch a blocked caller.
--
-- One honest edge-case difference from create_meeting_with_participants()
-- worth flagging: the EXTERNAL-email step's `INSERT ... ON CONFLICT (email)
-- DO UPDATE` against Person runs under the caller's own RLS here (INVOKER),
-- not bypassed (DEFINER). Person's insert_all_authenticated policy allows
-- the INSERT side for anyone, and its update_unlinked_or_owner_or_admin
-- policy allows the ON CONFLICT DO UPDATE side for any externally-created
-- Person (userId IS NULL) — the overwhelmingly common case. But if someone
-- types an *existing internal* colleague's email into the external-email
-- field (a Person row with userId set to someone else, not the caller, and
-- the caller isn't admin), that row's UPDATE arm is invisible to the caller
-- under RLS, and Postgres raises a unique-violation-style conflict instead
-- of silently attaching that internal person the way DEFINER's bypassed
-- write would have. This is a pre-existing-shaped edge case (a plausible
-- but unusual input), not a security gap — documented here rather than
-- silently patched over, since fixing it would mean either bypassing
-- Person's own RLS (re-introducing the exact DEFINER trade-off this
-- function was deliberately designed to avoid) or resolving colliding
-- emails to existing Person rows via a SELECT first, neither of which this
-- round's spec called for.
--
-- SET search_path = '' — same defense-in-depth as every other function
-- here; every identifier below is schema-qualified (public."Meeting" etc.)
-- except plain built-ins (now(), gen_random_uuid(), unnest(), ...), which
-- resolve via pg_catalog regardless of search_path.

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
  v_meeting public."Meeting";
BEGIN
  -- ---- Authorization FIRST, against the meeting's EXISTING organizerId
  -- (see header) — before touching any table. ----
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

  -- ---- 1. Meeting's own editable fields — partial update (plain column
  -- SET), not a full-replace the way groups/participants below are ----
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

  -- ---- 2. Meeting <-> ContactGroup join rows — only touched if p_group_ids
  -- was actually passed (NULL = leave alone, matching the old handler's
  -- `groupIds !== undefined` check on `groups: { set: [...] }`) ----
  IF p_group_ids IS NOT NULL THEN
    DELETE FROM public."_MeetingGroups" WHERE "B" = p_meeting_id;
    IF array_length(p_group_ids, 1) > 0 THEN
      INSERT INTO public."_MeetingGroups" ("A", "B")
      SELECT DISTINCT g, p_meeting_id FROM unnest(p_group_ids) AS g
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  -- ---- 3. MeetingParticipant — full replace, ONLY if at least one of the
  -- three participant-related params was actually passed (NULL on all three
  -- = don't touch, matching the old handler's shouldResolveParticipants
  -- check: `participantPersonIds !== undefined || groupIds !== undefined ||
  -- externalEmails !== undefined`). Same DIRECT/GROUP/EXTERNAL resolution
  -- and organizer-always-wins special case as
  -- create_meeting_with_participants()'s steps 3-5. ----
  IF p_participant_person_ids IS NOT NULL OR p_group_ids IS NOT NULL OR p_external_emails IS NOT NULL THEN
    DELETE FROM public."MeetingParticipant" WHERE "meetingId" = p_meeting_id;

    -- ---- 3a. DIRECT (explicit picks always win; BR-04) ----
    IF p_participant_person_ids IS NOT NULL AND array_length(p_participant_person_ids, 1) > 0 THEN
      INSERT INTO public."MeetingParticipant" (id, "meetingId", "personId", role, "rsvpStatus", source, "sourceGroupId")
      SELECT
        gen_random_uuid()::text, p_meeting_id, pid,
        CASE WHEN pid = v_organizer_person_id THEN 'ORGANIZER' ELSE 'ATTENDEE' END::public."ParticipantRole",
        'PENDING'::public."RsvpStatus",
        'DIRECT'::public."ParticipantSource",
        NULL
      FROM (SELECT DISTINCT pid FROM unnest(p_participant_person_ids) AS pid) d
      ON CONFLICT ("meetingId", "personId") DO NOTHING;
    END IF;

    -- ---- 3b. GROUP (first selected group wins per person; ON CONFLICT DO
    -- NOTHING below skips anyone DIRECT already claimed) ----
    IF p_group_ids IS NOT NULL AND array_length(p_group_ids, 1) > 0 THEN
      INSERT INTO public."MeetingParticipant" (id, "meetingId", "personId", role, "rsvpStatus", source, "sourceGroupId")
      SELECT
        gen_random_uuid()::text, p_meeting_id, m."personId",
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

    -- ---- 3c. EXTERNAL (upsert Person per raw email, one at a time,
    -- mirroring resolveParticipants()'s prisma upsert loop — see header for
    -- the RLS edge case this INVOKER version has that create()'s DEFINER
    -- version doesn't) ----
    IF p_external_emails IS NOT NULL THEN
      FOREACH v_email IN ARRAY p_external_emails LOOP
        INSERT INTO public."Person" (id, name, email, type, status, "createdAt", "updatedAt")
        VALUES (gen_random_uuid()::text, split_part(v_email, '@', 1), v_email, 'EXTERNAL', 'ACTIVE', now(), now())
        ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
        RETURNING id INTO v_person_id;

        INSERT INTO public."MeetingParticipant" (id, "meetingId", "personId", role, "rsvpStatus", source, "sourceGroupId")
        VALUES (
          gen_random_uuid()::text, p_meeting_id, v_person_id,
          CASE WHEN v_person_id = v_organizer_person_id THEN 'ORGANIZER' ELSE 'ATTENDEE' END::public."ParticipantRole",
          'PENDING'::public."RsvpStatus",
          CASE WHEN v_person_id = v_organizer_person_id THEN 'DIRECT' ELSE 'EXTERNAL' END::public."ParticipantSource",
          NULL
        )
        ON CONFLICT ("meetingId", "personId") DO NOTHING;
      END LOOP;
    END IF;
  END IF;

  -- ---- 4. No Reminder, no Notification — the old PUT handler never
  -- touched either (only POST /api/meetings did), so neither does this
  -- function. ----

  SELECT * INTO v_meeting FROM public."Meeting" WHERE id = p_meeting_id;
  RETURN v_meeting;
END;
$$;

COMMENT ON FUNCTION public.update_meeting_with_participants(
  text, text, timestamp, timestamp, text, text, text, text, text, text, text[], text[], text[]
) IS
  'Hybrid migration (Meeting resource, edit round): atomic replacement for PUT /api/meetings/[id] — updates Meeting''s editable fields (partial, plain column SET), optionally replaces _MeetingGroups (p_group_ids IS NOT NULL) and optionally replaces MeetingParticipant wholesale via DIRECT/GROUP/EXTERNAL resolution identical to create_meeting_with_participants() (any of the three participant params IS NOT NULL), all in one function body (auto-rollback on any failure). NULL on a participant-related param means "leave as-is"; an empty array means "replace with nothing" — distinct from NULL, mirroring the old handler''s `!== undefined` checks. SECURITY INVOKER, not DEFINER: unlike create, this function never writes a Notification row the caller lacks direct RLS permission for, so Meeting''s update_organizer_or_admin and MeetingParticipant/_MeetingGroups''s organizer-or-admin policies already gate every write here. See docs/DESIGN_DECISIONS.md §5.7.';

REVOKE ALL ON FUNCTION public.update_meeting_with_participants(
  text, text, timestamp, timestamp, text, text, text, text, text, text, text[], text[], text[]
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_meeting_with_participants(
  text, text, timestamp, timestamp, text, text, text, text, text, text, text[], text[], text[]
) TO authenticated;
