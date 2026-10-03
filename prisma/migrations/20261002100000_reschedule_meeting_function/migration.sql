-- reschedule_meeting(...) — atomic replacement for the two separate
-- supabase-js writes MeetingActions.tsx's "เลื่อนเวลา" dialog used to make
-- (UPDATE "Meeting" then UPDATE "Reminder"), and a fix for what the second
-- write did: it set every still-PENDING reminder to a fixed "30 minutes
-- before the new start", wiping whatever offsets the organizer had picked
-- (7 days / 1 day / 1 hour before, ...).
--
-- Reminder has no offset column — only scheduledAt — so the offset is kept
-- by shifting each PENDING reminder by exactly how far the meeting moved
-- (new start - old start): "1 day before" stays "1 day before the new start".
-- That makes atomicity matter: if the meeting update committed but the
-- reminder shift didn't, the next reschedule would compute its delta from the
-- already-moved start and the reminders could never be corrected. Doing both
-- in one function body means either both land or neither does. The old start
-- is read under FOR UPDATE so two concurrent reschedules can't both shift
-- reminders from the same stale start.
--
-- SENT/FAILED/CANCELLED reminders are history and are left alone.
--
-- A shifted reminder can land in the past (e.g. "2 days before" when the
-- meeting moves to tomorrow). Those are set to CANCELLED instead of staying
-- PENDING — otherwise the next process-due run would fire them all at once
-- as a burst of late, overlapping reminders.
--
-- Same checks the dialog makes client-side, repeated here because supabase-js
-- callers can skip the UI: organizer-or-admin, end after start, start not in
-- the past. Timestamps are TIMESTAMP (no time zone) holding UTC, like every
-- other column/function in this schema, so "now" is compared as UTC too.
-- A cancelled meeting can't be rescheduled (that would silently flip it back
-- to POSTPONED while its reminders stay cancelled by the BR-14 trigger).
--
-- SECURITY INVOKER: Meeting's update_organizer_or_admin and Reminder's
-- update_meeting_organizer_or_admin RLS policies already gate both writes;
-- the explicit organizer check below only turns a silent 0-row update into
-- a clear error message.

CREATE OR REPLACE FUNCTION public.reschedule_meeting(
  p_meeting_id text,
  p_start_time timestamp,
  p_end_time timestamp
)
RETURNS public."Meeting"
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_organizer_id uuid;
  v_status public."MeetingStatus";
  v_old_start timestamp;
  v_meeting public."Meeting";
BEGIN
  SELECT "organizerId", status INTO v_organizer_id, v_status
  FROM public."Meeting" WHERE id = p_meeting_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ไม่พบการประชุมนี้';
  END IF;
  IF v_organizer_id IS DISTINCT FROM auth.uid() AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'เฉพาะผู้จัดประชุมหรือผู้ดูแลระบบเท่านั้นที่เลื่อนเวลาการประชุมนี้ได้' USING ERRCODE = '42501';
  END IF;
  IF v_status = 'CANCELLED' THEN
    RAISE EXCEPTION 'การประชุมนี้ถูกยกเลิกแล้ว เลื่อนเวลาไม่ได้';
  END IF;
  IF p_start_time IS NULL OR p_end_time IS NULL THEN
    RAISE EXCEPTION 'กรุณากำหนดเวลาเริ่มและเวลาสิ้นสุด';
  END IF;
  IF p_end_time <= p_start_time THEN
    RAISE EXCEPTION 'เวลาสิ้นสุดต้องอยู่หลังเวลาเริ่ม';
  END IF;
  IF p_start_time < (now() AT TIME ZONE 'UTC') THEN
    RAISE EXCEPTION 'เวลาเริ่มต้องไม่เป็นอดีต (ย้อนหลัง)';
  END IF;

  SELECT "startTime" INTO v_old_start
  FROM public."Meeting" WHERE id = p_meeting_id
  FOR UPDATE;

  UPDATE public."Meeting"
  SET "startTime" = p_start_time,
      "endTime" = p_end_time,
      status = 'POSTPONED',
      "updatedAt" = now()
  WHERE id = p_meeting_id
  RETURNING * INTO v_meeting;

  -- SET expressions all read the pre-update row, so status is decided from
  -- the same shifted time scheduledAt is being set to.
  UPDATE public."Reminder"
  SET "scheduledAt" = "scheduledAt" + (p_start_time - v_old_start),
      status = CASE
        WHEN "scheduledAt" + (p_start_time - v_old_start) < (now() AT TIME ZONE 'UTC')
          THEN 'CANCELLED'::public."ReminderStatus"
        ELSE status
      END
  WHERE "meetingId" = p_meeting_id
    AND status = 'PENDING';

  RETURN v_meeting;
END;
$$;

COMMENT ON FUNCTION public.reschedule_meeting(text, timestamp, timestamp) IS
  'Atomically moves a meeting to new start/end (status POSTPONED) and shifts every PENDING Reminder by the same delta, so each reminder keeps its original offset from the meeting start; a shifted reminder that would fall in the past is set to CANCELLED instead. Organizer or admin only; rejects cancelled meetings, end <= start, and a start in the past. SECURITY INVOKER — RLS on Meeting/Reminder gates both writes.';

REVOKE ALL ON FUNCTION public.reschedule_meeting(text, timestamp, timestamp) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reschedule_meeting(text, timestamp, timestamp) TO authenticated;
