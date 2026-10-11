-- Final-audit round, Phase 4 (2026-10-11) -- a real Stored Procedure behind
-- the existing reschedule_meeting() RPC, without changing what the UI calls.
--
-- supabase.rpc() (PostgREST) can only call FUNCTIONS, never procedures, so
-- the pattern is:
--
--   private.reschedule_meeting_proc(...)   CREATE PROCEDURE (prokind = 'p')
--     the whole body of the old function, moved verbatim (same checks, same
--     error messages / SQLSTATEs, same Meeting + Reminder writes in the same
--     order). No COMMIT/ROLLBACK inside, so it can run inside the caller's
--     transaction; the updated row comes back through an OUT parameter.
--
--   public.reschedule_meeting(...)         CREATE FUNCTION (prokind = 'f')
--     same name, argument list, return type and EXECUTE grant as before, so
--     MeetingActions.tsx's supabase.rpc("reschedule_meeting", ...) is
--     untouched. It only CALLs the procedure and returns its OUT value.
--
-- Why "private": the schema is not in PostgREST's exposed schemas (public,
-- graphql_public) and anon/authenticated get no USAGE on it, so the
-- procedure cannot be reached directly through the API — only through the
-- wrapper.
--
-- SECURITY: the old function was SECURITY INVOKER and relied on RLS for its
-- two writes. Because authenticated now has no privilege on private.*, the
-- wrapper and the procedure are SECURITY DEFINER (owner postgres, which has
-- BYPASSRLS). This does not widen what a caller can do, because every RLS
-- rule the old version depended on is either always-true for the caller or
-- identical to an explicit check the body already makes BEFORE any write:
--   * Meeting  SELECT  select_all_authenticated            -> USING (true)
--   * Meeting  UPDATE  update_organizer_or_admin           -> organizerId = auth.uid() OR is_admin()
--   * Reminder UPDATE  update_meeting_organizer_or_admin   -> organizer of the meeting OR is_admin()
--   * body:  IF organizerId IS DISTINCT FROM auth.uid() AND NOT is_admin() THEN RAISE 42501
-- So for every caller the explicit check passes exactly when the RLS
-- policies would have, and raises the same 42501 message otherwise; the
-- NOT FOUND message for an unknown id is unchanged because every
-- authenticated user could already see every meeting. auth.uid() still reads
-- the caller's JWT claims (a GUC), so it is unaffected by SECURITY DEFINER.
-- Both objects pin search_path = '' and fully qualify every name.
-- Verified on a scratch copy before/after (same rows, reminders and
-- errors/SQLSTATEs for organizer, admin, participant, outsider, cancelled,
-- past start, end<=start, NULL times, unknown id) — see
-- docs/DESIGN_DECISIONS.md s5.10.

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE PROCEDURE private.reschedule_meeting_proc(
  p_meeting_id text,
  p_start_time timestamp,
  p_end_time timestamp,
  OUT p_meeting public."Meeting"
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $procedure$
DECLARE
  v_organizer_id uuid;
  v_status public."MeetingStatus";
  v_old_start timestamp;
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
  RETURNING * INTO p_meeting;

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
END;
$procedure$;

COMMENT ON PROCEDURE private.reschedule_meeting_proc(text, timestamp, timestamp, public."Meeting") IS
  'Stored procedure behind public.reschedule_meeting(): moves a meeting (status POSTPONED) and shifts its PENDING reminders by the same delta (CANCELLED if the shifted time is already past), in the caller''s transaction. Organizer-or-admin, not cancelled, end after start, start not in the past. Not callable by anon/authenticated directly - only via the public wrapper. See 20261011120000_reschedule_meeting_procedure.';

REVOKE ALL ON PROCEDURE private.reschedule_meeting_proc(text, timestamp, timestamp, public."Meeting") FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.reschedule_meeting(
  p_meeting_id text,
  p_start_time timestamp,
  p_end_time timestamp
)
RETURNS public."Meeting"
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_meeting public."Meeting";
BEGIN
  CALL private.reschedule_meeting_proc(p_meeting_id, p_start_time, p_end_time, v_meeting);
  RETURN v_meeting;
END;
$function$;

COMMENT ON FUNCTION public.reschedule_meeting(text, timestamp, timestamp) IS
  'RPC called by MeetingActions.tsx ("เลื่อนเวลา"). Thin wrapper: CALLs the stored procedure private.reschedule_meeting_proc() and returns the updated Meeting row - same signature, return type and grants as before 20261011120000. SECURITY DEFINER only so it may call into the private schema; the procedure makes the organizer-or-admin check itself (see that migration).';

REVOKE ALL ON FUNCTION public.reschedule_meeting(text, timestamp, timestamp) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reschedule_meeting(text, timestamp, timestamp) TO authenticated;
