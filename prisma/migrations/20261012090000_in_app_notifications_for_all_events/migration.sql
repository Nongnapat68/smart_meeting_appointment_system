-- fix4 (2026-10-12) -- in-app notifications (the bell) for every event that
-- "tells someone something", no matter which path made the change: the
-- browser through supabase-js / RPC (auth.uid() = the signed-in user) or the
-- Next.js server through Prisma (no JWT -> auth.uid() is NULL).
--
-- Design (see docs/DESIGN_DECISIONS.md s5.11 for the event -> recipient ->
-- message list):
--   * Every notification is written by an AFTER trigger that calls a
--     SECURITY DEFINER function with search_path = '' in schema "private"
--     (not exposed by PostgREST, no USAGE for anon/authenticated). Recipients
--     are computed here from the database rows only - never taken from the
--     client - and the Notification INSERT policy stays admin-only.
--   * Fail-soft: every trigger body runs inside BEGIN ... EXCEPTION WHEN
--     OTHERS -> RAISE WARNING, and private.notify() does the same per row, so
--     a notification that cannot be written never fails the create /
--     reschedule / cancel / edit / task / comment that caused it.
--   * Idempotent: new column "dedupeKey" + UNIQUE ("userId", "dedupeKey"),
--     every insert is ON CONFLICT DO NOTHING. A retried / repeated /
--     concurrent event therefore yields one row per recipient.
--   * Recipients: accounts only (Person."userId" not null), each account at
--     most once, never the person who made the change (auth.uid(), or the
--     server-side actor set by src/lib/notification-actor.ts), never someone
--     who switched "การแจ้งเตือนในระบบ" off (User."inAppNotifications").
--     Exception: a due reminder also goes to the organizer, as before.
--     External contacts (no account) only ever get the email (stub).
--   * create_meeting_with_participants() no longer writes the invite rows
--     itself (old step 7): the MeetingParticipant trigger below does it for
--     every path, so the two can never both write an invite.
--
-- Additive and compatible with the previous app version still in use:
-- new enum values and a nullable column only; existing columns, policies,
-- triggers and function signatures are unchanged. trg_merge_legacy_notification
-- keeps the old server code (which still writes TASK_ASSIGNED / REMINDER rows
-- itself) from producing a second row next to the trigger's row.
--
-- Rollback: prisma/rollbacks/20261012090000_in_app_notifications_for_all_events.down.sql

-- ---- 1. New notification kinds (additive; ADD VALUE is allowed inside a
-- transaction since PG 12 as long as the value is not used in the same
-- transaction - nothing below uses them outside plpgsql bodies) ----
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'MEETING_REMOVED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'MEETING_NOTE';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'TASK_UPDATED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'TASK_COMMENT';

-- ---- 2. Dedupe key: one row per (recipient, event). NULL for rows written
-- the old way (NULLs never collide in a unique index). Name = Prisma's
-- default for @@unique([userId, dedupeKey]) so schema.prisma stays in sync. ----
ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "dedupeKey" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Notification_userId_dedupeKey_key" ON "Notification"("userId", "dedupeKey");

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

-- ---- 3. Helpers ----

-- Thai date-time text in Asia/Bangkok, same shape as formatDateTime() in
-- src/lib/format.ts: "12 ต.ค. 2569 • 10:00". Columns hold UTC wall clock
-- (timestamp without time zone), hence the double AT TIME ZONE.
CREATE OR REPLACE FUNCTION private.notification_time_text(p_ts timestamp)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT CASE WHEN p_ts IS NULL THEN '-' ELSE
    to_char(b, 'FMDD') || ' ' ||
    (ARRAY['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'])[extract(month FROM b)::int] || ' ' ||
    (extract(year FROM b)::int + 543)::text || ' • ' || to_char(b, 'HH24:MI')
  END
  FROM (SELECT (p_ts AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Bangkok' AS b) x
$$;

-- "12 ต.ค. 2569 • 10:00 - 11:00" (end date repeated only when it is another
-- Bangkok day), like formatDateTimeRange().
CREATE OR REPLACE FUNCTION private.notification_range_text(p_start timestamp, p_end timestamp)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT private.notification_time_text(p_start) || ' - ' ||
    CASE
      WHEN p_end IS NULL THEN '-'
      WHEN ((p_start AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Bangkok')::date
         = ((p_end AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Bangkok')::date
        THEN to_char((p_end AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Bangkok', 'HH24:MI')
      ELSE private.notification_time_text(p_end)
    END
$$;

-- Who made the change: the signed-in user for supabase-js / RPC calls
-- (auth.uid() reads the request JWT), else the user id the Next.js server
-- put in the transaction-local setting smartmeeting.actor_id
-- (src/lib/notification-actor.ts). NULL when neither is known (seed,
-- scripts, the reminder processor) - then nobody is skipped as "actor".
-- The setting cannot be set by a browser: PostgREST exposes no set_config,
-- and auth.uid() wins whenever there is a JWT.
CREATE OR REPLACE FUNCTION private.notification_actor()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_uid uuid;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NOT NULL THEN
    RETURN v_uid;
  END IF;
  RETURN nullif(current_setting('smartmeeting.actor_id', true), '')::uuid;
EXCEPTION WHEN invalid_text_representation THEN
  RETURN NULL;
END;
$$;

-- Every account that is part of a meeting: the organizer plus each
-- participant whose Person is linked to a User. Distinct, never NULL.
CREATE OR REPLACE FUNCTION private.meeting_recipient_ids(p_meeting_id text)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT DISTINCT x.uid FROM (
    SELECT m."organizerId" AS uid FROM public."Meeting" m WHERE m.id = p_meeting_id
    UNION
    SELECT p."userId" FROM public."MeetingParticipant" mp
    JOIN public."Person" p ON p.id = mp."personId"
    WHERE mp."meetingId" = p_meeting_id
  ) x
  WHERE x.uid IS NOT NULL
$$;

-- The one place a notification row is written. Skips: no account, account
-- gone, in-app notifications switched off. ON CONFLICT on the dedupe key
-- makes repeats a no-op (also between two concurrent transactions: the
-- second waits for the first and then does nothing). Errors are swallowed
-- (WARNING) so the caller's own work is never rolled back by this.
-- Returns true when a row was written.
CREATE OR REPLACE FUNCTION private.notify(
  p_user_id uuid,
  p_type text,
  p_title text,
  p_body text,
  p_related_id text,
  p_dedupe_key text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_rows int;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public."User" u WHERE u.id = p_user_id AND u."inAppNotifications") THEN
    RETURN false;
  END IF;
  -- Old app version: PATCH /api/tasks/[id] wrote its own TASK_ASSIGNED row
  -- (no dedupe key) just BEFORE updating the task. Don't add a second one.
  IF p_type = 'TASK_ASSIGNED' AND EXISTS (
    SELECT 1 FROM public."Notification" n
    WHERE n."userId" = p_user_id AND n.type = 'TASK_ASSIGNED' AND n."relatedId" = p_related_id
      AND n."dedupeKey" IS NULL
      AND n."createdAt" >= (now() AT TIME ZONE 'UTC') - interval '2 minutes'
  ) THEN
    RETURN false;
  END IF;

  INSERT INTO public."Notification" (id, "userId", type, title, body, "isRead", "relatedId", "createdAt", "dedupeKey")
  VALUES (gen_random_uuid()::text, p_user_id, p_type::public."NotificationType", p_title, p_body, false,
          p_related_id, now() AT TIME ZONE 'UTC', p_dedupe_key)
  ON CONFLICT ("userId", "dedupeKey") DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'private.notify(%) for user % failed: % (SQLSTATE %)', p_type, p_user_id, SQLERRM, SQLSTATE;
  RETURN false;
END;
$$;

-- ---- 4. Trigger functions ----

-- (a) Someone was added to a meeting -> MEETING_INVITE to that account.
-- Covers create_meeting_with_participants() (every invitee at creation),
-- update_meeting_with_participants() (people added in an edit) and any
-- direct insert. Not for the organizer's own row, the actor, an external
-- contact, or a cancelled / finished meeting. A row that
-- update_meeting_with_participants() deletes and re-inserts in the same
-- transaction only to change its source group is not a new invite: the
-- delete trigger (b) leaves a marker, and the removal notice it wrote is
-- taken back here.
CREATE OR REPLACE FUNCTION private.notify_meeting_participant_added()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user uuid;
  v_meeting record;
  v_actor uuid;
BEGIN
  BEGIN
    SELECT p."userId" INTO v_user FROM public."Person" p WHERE p.id = NEW."personId";
    IF v_user IS NULL THEN
      RETURN NULL; -- external contact: email only
    END IF;

    IF (NEW."meetingId" || '/' || NEW."personId") = ANY (
         string_to_array(current_setting('smartmeeting.removed_participants', true), ',')) THEN
      DELETE FROM public."Notification"
      WHERE "userId" = v_user
        AND "dedupeKey" = 'meeting_removed:' || NEW."meetingId" || ':' || txid_current();
      RETURN NULL; -- same person removed and re-added in this transaction: no change for them
    END IF;

    SELECT m.id, m.title, m.status, m."startTime", m."endTime", m.location, m."organizerId"
    INTO v_meeting
    FROM public."Meeting" m WHERE m.id = NEW."meetingId";
    IF NOT FOUND OR v_meeting.status = 'CANCELLED' OR v_meeting."endTime" <= (now() AT TIME ZONE 'UTC') THEN
      RETURN NULL;
    END IF;

    v_actor := private.notification_actor();
    IF v_user IS NOT DISTINCT FROM v_actor OR v_user IS NOT DISTINCT FROM v_meeting."organizerId" THEN
      RETURN NULL;
    END IF;

    PERFORM private.notify(
      v_user, 'MEETING_INVITE', 'คำเชิญเข้าร่วมประชุมใหม่',
      format('"%s" • %s', v_meeting.title, private.notification_range_text(v_meeting."startTime", v_meeting."endTime"))
        || coalesce(' • ' || nullif(btrim(v_meeting.location), ''), ''),
      v_meeting.id,
      'meeting_invite:' || NEW.id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'notify_meeting_participant_added failed: % (SQLSTATE %)', SQLERRM, SQLSTATE;
  END;
  RETURN NULL;
END;
$$;

-- (b) Someone was taken off a meeting -> MEETING_REMOVED to that account.
-- Same exclusions as (a); a meeting that is being deleted (row already gone)
-- notifies nobody. First records "<meetingId>/<personId>" in the
-- transaction-local setting smartmeeting.removed_participants for (a).
CREATE OR REPLACE FUNCTION private.notify_meeting_participant_removed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user uuid;
  v_meeting record;
  v_actor uuid;
BEGIN
  PERFORM set_config(
    'smartmeeting.removed_participants',
    coalesce(nullif(current_setting('smartmeeting.removed_participants', true), '') || ',', '')
      || OLD."meetingId" || '/' || OLD."personId",
    true);

  BEGIN
    SELECT p."userId" INTO v_user FROM public."Person" p WHERE p.id = OLD."personId";
    IF v_user IS NULL THEN
      RETURN NULL;
    END IF;

    SELECT m.id, m.title, m.status, m."startTime", m."endTime", m."organizerId"
    INTO v_meeting
    FROM public."Meeting" m WHERE m.id = OLD."meetingId";
    IF NOT FOUND OR v_meeting.status = 'CANCELLED' OR v_meeting."endTime" <= (now() AT TIME ZONE 'UTC') THEN
      RETURN NULL;
    END IF;

    v_actor := private.notification_actor();
    IF v_user IS NOT DISTINCT FROM v_actor OR v_user IS NOT DISTINCT FROM v_meeting."organizerId" THEN
      RETURN NULL;
    END IF;

    PERFORM private.notify(
      v_user, 'MEETING_REMOVED', 'คุณถูกนำออกจากการประชุม',
      format('"%s" • %s', v_meeting.title, private.notification_range_text(v_meeting."startTime", v_meeting."endTime")),
      v_meeting.id,
      'meeting_removed:' || OLD."meetingId" || ':' || txid_current());
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'notify_meeting_participant_removed failed: % (SQLSTATE %)', SQLERRM, SQLSTATE;
  END;
  RETURN NULL;
END;
$$;

-- (c) A meeting was cancelled, rescheduled, or had its title / time /
-- location / online-meeting link changed -> everyone in it (organizer +
-- participants with an account) except the actor.
--   * cancel: MEETING_CANCELLED (not for a meeting that had already ended)
--   * time changed (reschedule_meeting() / edit form): MEETING_UPDATED
--     "เลื่อนการประชุม" with old -> new time
--   * other important fields: MEETING_UPDATED "แก้ไขรายละเอียดการประชุม"
--     listing each change old -> new
-- Nothing for a meeting that is (or was already) cancelled, or one whose
-- new end time is in the past. Runs next to trg_cancel_meeting_reminders;
-- the two are independent.
CREATE OR REPLACE FUNCTION private.notify_meeting_changed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now timestamp := now() AT TIME ZONE 'UTC';
  v_actor uuid;
  v_user uuid;
  v_changes text[] := '{}';
  v_time_changed boolean;
  v_old_link text;
  v_new_link text;
  v_title text;
  v_body text;
  v_key text;
BEGIN
  BEGIN
    v_actor := private.notification_actor();

    -- Cancelled
    IF NEW.status = 'CANCELLED' AND OLD.status IS DISTINCT FROM 'CANCELLED' THEN
      IF OLD."endTime" <= v_now THEN
        RETURN NULL; -- already over: nothing to tell
      END IF;
      FOR v_user IN SELECT * FROM private.meeting_recipient_ids(NEW.id) LOOP
        CONTINUE WHEN v_user IS NOT DISTINCT FROM v_actor;
        PERFORM private.notify(
          v_user, 'MEETING_CANCELLED', 'การประชุมถูกยกเลิก',
          format('"%s" • เดิมกำหนด %s', NEW.title, private.notification_range_text(OLD."startTime", OLD."endTime")),
          NEW.id,
          'meeting_cancelled:' || NEW.id);
      END LOOP;
      RETURN NULL;
    END IF;

    IF OLD.status = 'CANCELLED' OR NEW.status = 'CANCELLED' OR NEW."endTime" <= v_now THEN
      RETURN NULL;
    END IF;

    v_time_changed := OLD."startTime" IS DISTINCT FROM NEW."startTime" OR OLD."endTime" IS DISTINCT FROM NEW."endTime";
    IF v_time_changed THEN
      v_changes := v_changes || format('เวลา %s → %s',
        private.notification_range_text(OLD."startTime", OLD."endTime"),
        private.notification_range_text(NEW."startTime", NEW."endTime"));
    END IF;
    IF OLD.title IS DISTINCT FROM NEW.title THEN
      v_changes := v_changes || format('ชื่อ "%s" → "%s"', OLD.title, NEW.title);
    END IF;
    IF coalesce(btrim(OLD.location), '') IS DISTINCT FROM coalesce(btrim(NEW.location), '') THEN
      v_changes := v_changes || format('สถานที่ %s → %s',
        coalesce(nullif(btrim(OLD.location), ''), 'ไม่ระบุ'), coalesce(nullif(btrim(NEW.location), ''), 'ไม่ระบุ'));
    END IF;
    IF OLD."onlineMeetingResourceId" IS DISTINCT FROM NEW."onlineMeetingResourceId" THEN
      SELECT r.name INTO v_old_link FROM public."OnlineMeetingResource" r WHERE r.id = OLD."onlineMeetingResourceId";
      SELECT r.name INTO v_new_link FROM public."OnlineMeetingResource" r WHERE r.id = NEW."onlineMeetingResourceId";
      v_changes := v_changes || format('ลิงก์ประชุมออนไลน์ %s → %s', coalesce(v_old_link, 'ไม่มี'), coalesce(v_new_link, 'ไม่มี'));
    END IF;
    IF cardinality(v_changes) = 0 THEN
      RETURN NULL; -- only whitespace in location changed
    END IF;

    v_title := CASE WHEN v_time_changed THEN 'เลื่อนการประชุม' ELSE 'แก้ไขรายละเอียดการประชุม' END;
    v_body := format('"%s" • %s', NEW.title, array_to_string(v_changes, ' • '));
    -- event = this meeting, this old->new change, this version (updatedAt), this transaction
    v_key := 'meeting_updated:' || NEW.id || ':' || md5(concat_ws('|',
      OLD.title, OLD."startTime", OLD."endTime", OLD.location, OLD."onlineMeetingResourceId",
      NEW.title, NEW."startTime", NEW."endTime", NEW.location, NEW."onlineMeetingResourceId",
      NEW."updatedAt", txid_current()));

    FOR v_user IN SELECT * FROM private.meeting_recipient_ids(NEW.id) LOOP
      CONTINUE WHEN v_user IS NOT DISTINCT FROM v_actor;
      PERFORM private.notify(v_user, 'MEETING_UPDATED', v_title, v_body, NEW.id, v_key);
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'notify_meeting_changed failed: % (SQLSTATE %)', SQLERRM, SQLSTATE;
  END;
  RETURN NULL;
END;
$$;

-- (d) A due reminder left PENDING -> REMINDER to the organizer and every
-- participant with an account (the organizer is a recipient here even if
-- they caused it). "Due" = its own scheduledAt has arrived and was not just
-- moved by this same UPDATE (reschedule/edit shift reminders and cancel the
-- ones that would land in the past - those are covered by (c)).
--   SENT / SIMULATED -> "แจ้งเตือนการประชุม: ... จะเริ่มเวลา ..."
--   FAILED           -> same, noting that the reminder email failed
--   CANCELLED        -> meeting already started (processor too late): "การประชุมเริ่มแล้ว";
--                       meeting still ahead (someone cancelled a due reminder by
--                       hand): "ยกเลิกการแจ้งเตือน", not to that person;
--                       meeting cancelled / completed / ended: nothing (already
--                       told by (c), or no longer relevant)
-- One row per (reminder, account) via the key 'reminder:<id>', so two
-- processors (or a retry) can never double it.
CREATE OR REPLACE FUNCTION private.notify_reminder_due()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now timestamp := now() AT TIME ZONE 'UTC';
  v_meeting record;
  v_actor uuid;
  v_user uuid;
  v_title text;
  v_body text;
BEGIN
  BEGIN
    IF OLD."scheduledAt" > v_now OR NEW."scheduledAt" IS DISTINCT FROM OLD."scheduledAt" THEN
      RETURN NULL; -- not a due reminder
    END IF;

    SELECT m.id, m.title, m.status, m."startTime", m."endTime" INTO v_meeting
    FROM public."Meeting" m WHERE m.id = NEW."meetingId";
    IF NOT FOUND OR v_meeting.status IN ('CANCELLED', 'COMPLETED') OR v_meeting."endTime" <= v_now THEN
      RETURN NULL;
    END IF;

    IF NEW.status = 'CANCELLED' THEN
      IF v_meeting."startTime" <= v_now THEN
        v_title := 'การประชุมเริ่มแล้ว';
        v_body := format('"%s" เริ่มเมื่อ %s (ระบบส่งการแจ้งเตือนล่วงหน้าไม่ทันเวลา)',
          v_meeting.title, private.notification_time_text(v_meeting."startTime"));
      ELSE
        v_title := 'ยกเลิกการแจ้งเตือนการประชุม';
        v_body := format('"%s" จะเริ่มเวลา %s', v_meeting.title, private.notification_time_text(v_meeting."startTime"));
        v_actor := private.notification_actor();
      END IF;
    ELSE
      v_title := 'แจ้งเตือนการประชุม';
      v_body := format('"%s" จะเริ่มเวลา %s', v_meeting.title, private.notification_time_text(v_meeting."startTime"))
        || CASE WHEN NEW.status = 'FAILED' THEN ' (ส่งอีเมลแจ้งเตือนไม่สำเร็จ)' ELSE '' END;
    END IF;

    FOR v_user IN SELECT * FROM private.meeting_recipient_ids(NEW."meetingId") LOOP
      CONTINUE WHEN v_actor IS NOT NULL AND v_user = v_actor;
      PERFORM private.notify(v_user, 'REMINDER', v_title, v_body, NEW."meetingId", 'reminder:' || NEW.id);
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'notify_reminder_due failed: % (SQLSTATE %)', SQLERRM, SQLSTATE;
  END;
  RETURN NULL;
END;
$$;

-- (e) Action items (Task):
--   INSERT with an assignee account            -> TASK_ASSIGNED to the assignee
--   assignee changed                           -> TASK_ASSIGNED to the new one,
--                                                 TASK_UPDATED to the previous one
--   status changed                             -> TASK_UPDATED to the creator, the
--                                                 assignee and the linked meeting's organizer
-- never to the actor (on INSERT the actor is the creator when nothing else
-- says otherwise). The key carries updatedAt + transaction so the same
-- change is written once, while a later, separate change is a new event.
CREATE OR REPLACE FUNCTION private.notify_task_changed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid;
  v_actor_name text;
  v_new_assignee uuid;
  v_old_assignee uuid;
  v_version text;
  v_user uuid;
  v_task_text text;
BEGIN
  BEGIN
    v_actor := private.notification_actor();
    v_new_assignee := coalesce(NEW."assigneeId",
      (SELECT p."userId" FROM public."Person" p WHERE p.id = NEW."assigneePersonId"));
    v_task_text := format('"%s"', NEW.title)
      || coalesce(' • กำหนดส่ง ' || to_char(NEW."dueDate", 'FMDD') || ' '
           || (ARRAY['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'])[extract(month FROM NEW."dueDate")::int]
           || ' ' || (extract(year FROM NEW."dueDate")::int + 543)::text, '');

    IF TG_OP = 'INSERT' THEN
      v_actor := coalesce(v_actor, NEW."createdById");
      IF v_new_assignee IS NOT NULL AND v_new_assignee IS DISTINCT FROM v_actor THEN
        PERFORM private.notify(v_new_assignee, 'TASK_ASSIGNED', 'คุณได้รับมอบหมายงานใหม่', v_task_text, NEW.id,
          'task_assigned:' || NEW.id || ':' || v_new_assignee);
      END IF;
      RETURN NULL;
    END IF;

    v_version := coalesce(to_char(NEW."updatedAt", 'YYYYMMDDHH24MISSMS'), '') || ':' || txid_current();
    v_old_assignee := coalesce(OLD."assigneeId",
      (SELECT p."userId" FROM public."Person" p WHERE p.id = OLD."assigneePersonId"));
    SELECT u.name INTO v_actor_name FROM public."User" u WHERE u.id = v_actor;

    IF v_new_assignee IS DISTINCT FROM v_old_assignee THEN
      IF v_new_assignee IS NOT NULL AND v_new_assignee IS DISTINCT FROM v_actor THEN
        PERFORM private.notify(v_new_assignee, 'TASK_ASSIGNED', 'คุณได้รับมอบหมายงานใหม่', v_task_text, NEW.id,
          'task_assigned:' || NEW.id || ':' || v_new_assignee || ':' || v_version);
      END IF;
      IF v_old_assignee IS NOT NULL AND v_old_assignee IS DISTINCT FROM v_actor THEN
        PERFORM private.notify(v_old_assignee, 'TASK_UPDATED', 'งานถูกมอบหมายให้ผู้อื่นแล้ว',
          format('"%s" ไม่ได้อยู่ในความรับผิดชอบของคุณแล้ว', NEW.title)
            || coalesce(' (โดย ' || v_actor_name || ')', ''),
          NEW.id, 'task_unassigned:' || NEW.id || ':' || v_old_assignee || ':' || v_version);
      END IF;
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status THEN
      FOR v_user IN
        SELECT DISTINCT x.uid FROM (
          SELECT NEW."createdById" AS uid
          UNION SELECT v_new_assignee
          UNION SELECT m."organizerId" FROM public."Meeting" m WHERE m.id = NEW."meetingId"
        ) x WHERE x.uid IS NOT NULL
      LOOP
        CONTINUE WHEN v_user IS NOT DISTINCT FROM v_actor;
        PERFORM private.notify(v_user, 'TASK_UPDATED', 'สถานะงานเปลี่ยน',
          format('"%s": %s → %s', NEW.title,
            CASE OLD.status WHEN 'NOT_STARTED' THEN 'ยังไม่เริ่ม' WHEN 'IN_PROGRESS' THEN 'กำลังดำเนินการ' ELSE 'เสร็จสิ้น' END,
            CASE NEW.status WHEN 'NOT_STARTED' THEN 'ยังไม่เริ่ม' WHEN 'IN_PROGRESS' THEN 'กำลังดำเนินการ' ELSE 'เสร็จสิ้น' END)
            || coalesce(' (โดย ' || v_actor_name || ')', ''),
          NEW.id, 'task_status:' || NEW.id || ':' || NEW.status || ':' || v_version);
      END LOOP;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'notify_task_changed failed: % (SQLSTATE %)', SQLERRM, SQLSTATE;
  END;
  RETURN NULL;
END;
$$;

-- (f) New comment on a task -> TASK_COMMENT to the task's creator and
-- assignee, except the comment's author.
CREATE OR REPLACE FUNCTION private.notify_task_comment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_author uuid;
  v_author_name text;
  v_task record;
  v_user uuid;
BEGIN
  BEGIN
    v_author := coalesce(NEW."authorId", private.notification_actor());
    SELECT u.name INTO v_author_name FROM public."User" u WHERE u.id = v_author;
    SELECT t.id, t.title, t."createdById",
           coalesce(t."assigneeId", (SELECT p."userId" FROM public."Person" p WHERE p.id = t."assigneePersonId")) AS assignee
    INTO v_task
    FROM public."Task" t WHERE t.id = NEW."taskId";
    IF NOT FOUND THEN
      RETURN NULL;
    END IF;

    FOR v_user IN
      SELECT DISTINCT x.uid FROM (SELECT v_task."createdById" AS uid UNION SELECT v_task.assignee) x WHERE x.uid IS NOT NULL
    LOOP
      CONTINUE WHEN v_user IS NOT DISTINCT FROM v_author;
      PERFORM private.notify(v_user, 'TASK_COMMENT', 'ความคิดเห็นใหม่ในงาน',
        format('%s: "%s" • งาน "%s"', coalesce(v_author_name, 'ผู้ใช้'),
          CASE WHEN char_length(NEW.content) > 80 THEN left(NEW.content, 80) || '…' ELSE NEW.content END,
          v_task.title),
        v_task.id, 'task_comment:' || NEW.id);
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'notify_task_comment failed: % (SQLSTATE %)', SQLERRM, SQLSTATE;
  END;
  RETURN NULL;
END;
$$;

-- (g) New meeting note (MeetingNote) or decision (Decision) -> MEETING_NOTE
-- to everyone in the meeting except its author. Minutes are usually written
-- after the meeting, so a finished meeting still notifies; a cancelled one
-- does not. The author column differs per table, so the row is read as jsonb.
CREATE OR REPLACE FUNCTION private.notify_meeting_minutes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row jsonb := to_jsonb(NEW);
  v_author uuid;
  v_meeting record;
  v_user uuid;
  v_is_decision boolean := TG_TABLE_NAME = 'Decision';
  v_content text;
BEGIN
  BEGIN
    v_author := coalesce(
      (v_row ->> CASE WHEN v_is_decision THEN 'decidedById' ELSE 'authorId' END)::uuid,
      private.notification_actor());
    SELECT m.id, m.title, m.status INTO v_meeting FROM public."Meeting" m WHERE m.id = v_row ->> 'meetingId';
    IF NOT FOUND OR v_meeting.status = 'CANCELLED' THEN
      RETURN NULL;
    END IF;
    v_content := v_row ->> 'content';

    FOR v_user IN SELECT * FROM private.meeting_recipient_ids(v_meeting.id) LOOP
      CONTINUE WHEN v_user IS NOT DISTINCT FROM v_author;
      PERFORM private.notify(v_user, 'MEETING_NOTE',
        CASE WHEN v_is_decision THEN 'มติที่ประชุมใหม่' ELSE 'บันทึกการประชุมใหม่' END,
        format('"%s": %s', v_meeting.title,
          CASE WHEN char_length(v_content) > 80 THEN left(v_content, 80) || '…' ELSE v_content END),
        v_meeting.id,
        CASE WHEN v_is_decision THEN 'decision:' ELSE 'meeting_note:' END || (v_row ->> 'id'));
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'notify_meeting_minutes failed: % (SQLSTATE %)', SQLERRM, SQLSTATE;
  END;
  RETURN NULL;
END;
$$;

-- (h) Compatibility with the previous app version only. Old server code
-- still writes its own TASK_ASSIGNED rows (POST /api/tasks, after the task
-- insert) and REMINDER rows (process-due, in the same transaction as the
-- reminder update) without a dedupe key - by then the triggers above already
-- wrote the same notice. Drop the trigger's copy and keep the old row (the
-- old code reads back what it inserted, so its row must stay). The current
-- code writes no such rows, so this never fires for it.
CREATE OR REPLACE FUNCTION private.merge_legacy_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  BEGIN
    DELETE FROM public."Notification" n
    WHERE n."userId" = NEW."userId"
      AND n.type = NEW.type
      AND n."relatedId" IS NOT DISTINCT FROM NEW."relatedId"
      AND (
        (NEW.type = 'REMINDER' AND n."dedupeKey" LIKE 'reminder:%'
          AND n."createdAt" = (now() AT TIME ZONE 'UTC')::timestamp(3))         -- same transaction
        OR
        (NEW.type = 'TASK_ASSIGNED' AND n."dedupeKey" LIKE 'task_assigned:%'
          AND n."createdAt" >= (now() AT TIME ZONE 'UTC') - interval '2 minutes')
      );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'merge_legacy_notification failed: % (SQLSTATE %)', SQLERRM, SQLSTATE;
  END;
  RETURN NEW;
END;
$$;

-- ---- 5. create_meeting_with_participants(): identical to
-- 20261011090000_fix_create_meeting_participants_groups except that the old
-- step 7 (INSERT the MEETING_INVITE rows) is gone - trigger (a) on
-- MeetingParticipant now writes them as each participant row is inserted,
-- with the meeting time in the text and a dedupe key. Keeping step 7 would
-- invite everyone twice. Same signature, return type, SECURITY DEFINER and
-- grants, so the app (old and new versions) calls it unchanged. ----
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

  -- ---- 7. Notification: written by trigger trg_notify_meeting_participant_added
  -- (private.notify_meeting_participant_added) for every participant row
  -- inserted in steps 3-5 - each invited account except the organizer. ----

  SELECT * INTO v_meeting FROM public."Meeting" WHERE id = v_meeting_id;
  RETURN v_meeting;
END;
$$;

COMMENT ON FUNCTION public.create_meeting_with_participants(
  uuid, text, timestamp, timestamp, text, text, text, text, text, text, text[], text[], text[], int[]
) IS
  'Hybrid migration round 1 (Meeting resource): atomic replacement for POST /api/meetings - inserts Meeting, MeetingParticipant (DIRECT/GROUP/EXTERNAL, same precedence as resolveParticipants()) and Reminder per offset, all in one function body (auto-rollback on any failure); the invite Notification rows come from trigger trg_notify_meeting_participant_added on MeetingParticipant (since 20261012090000). SECURITY DEFINER, safe only because auth.uid() is checked against p_organizer_id (or is_admin()) before anything else runs. Rejects a start time in the past (N6) and stores a reminder whose offset would land in the past as CANCELLED instead of PENDING (N7). A repeated offset in p_reminder_offset_minutes creates one reminder, not two (FR-10). See docs/DESIGN_DECISIONS.md.';

REVOKE ALL ON FUNCTION public.create_meeting_with_participants(
  uuid, text, timestamp, timestamp, text, text, text, text, text, text, text[], text[], text[], int[]
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_meeting_with_participants(
  uuid, text, timestamp, timestamp, text, text, text, text, text, text, text[], text[], text[], int[]
) TO authenticated;

-- ---- 6. Triggers (all AFTER ... FOR EACH ROW except the legacy merge) ----

DROP TRIGGER IF EXISTS trg_notify_meeting_participant_added ON public."MeetingParticipant";
CREATE TRIGGER trg_notify_meeting_participant_added
AFTER INSERT ON public."MeetingParticipant"
FOR EACH ROW
EXECUTE FUNCTION private.notify_meeting_participant_added();

DROP TRIGGER IF EXISTS trg_notify_meeting_participant_removed ON public."MeetingParticipant";
CREATE TRIGGER trg_notify_meeting_participant_removed
AFTER DELETE ON public."MeetingParticipant"
FOR EACH ROW
EXECUTE FUNCTION private.notify_meeting_participant_removed();

DROP TRIGGER IF EXISTS trg_notify_meeting_changed ON public."Meeting";
CREATE TRIGGER trg_notify_meeting_changed
AFTER UPDATE OF title, "startTime", "endTime", location, "onlineMeetingResourceId", status ON public."Meeting"
FOR EACH ROW
WHEN (
  OLD.title IS DISTINCT FROM NEW.title
  OR OLD."startTime" IS DISTINCT FROM NEW."startTime"
  OR OLD."endTime" IS DISTINCT FROM NEW."endTime"
  OR OLD.location IS DISTINCT FROM NEW.location
  OR OLD."onlineMeetingResourceId" IS DISTINCT FROM NEW."onlineMeetingResourceId"
  OR (NEW.status = 'CANCELLED' AND OLD.status IS DISTINCT FROM 'CANCELLED')
)
EXECUTE FUNCTION private.notify_meeting_changed();

DROP TRIGGER IF EXISTS trg_notify_reminder_due ON public."Reminder";
CREATE TRIGGER trg_notify_reminder_due
AFTER UPDATE OF status ON public."Reminder"
FOR EACH ROW
WHEN (OLD.status = 'PENDING' AND NEW.status <> 'PENDING')
EXECUTE FUNCTION private.notify_reminder_due();

DROP TRIGGER IF EXISTS trg_notify_task_changed ON public."Task";
CREATE TRIGGER trg_notify_task_changed
AFTER INSERT OR UPDATE OF "assigneeId", "assigneePersonId", status ON public."Task"
FOR EACH ROW
EXECUTE FUNCTION private.notify_task_changed();

DROP TRIGGER IF EXISTS trg_notify_task_comment ON public."TaskComment";
CREATE TRIGGER trg_notify_task_comment
AFTER INSERT ON public."TaskComment"
FOR EACH ROW
EXECUTE FUNCTION private.notify_task_comment();

DROP TRIGGER IF EXISTS trg_notify_meeting_note ON public."MeetingNote";
CREATE TRIGGER trg_notify_meeting_note
AFTER INSERT ON public."MeetingNote"
FOR EACH ROW
EXECUTE FUNCTION private.notify_meeting_minutes();

DROP TRIGGER IF EXISTS trg_notify_decision ON public."Decision";
CREATE TRIGGER trg_notify_decision
AFTER INSERT ON public."Decision"
FOR EACH ROW
EXECUTE FUNCTION private.notify_meeting_minutes();

DROP TRIGGER IF EXISTS trg_merge_legacy_notification ON public."Notification";
CREATE TRIGGER trg_merge_legacy_notification
BEFORE INSERT ON public."Notification"
FOR EACH ROW
-- server connections only (the old code is Prisma); a browser (anon/authenticated)
-- can never make it delete anything
WHEN (NEW."dedupeKey" IS NULL AND NEW.type IN ('TASK_ASSIGNED', 'REMINDER') AND current_user NOT IN ('anon', 'authenticated'))
EXECUTE FUNCTION private.merge_legacy_notification();

-- ---- 7. Nobody but the owner may call the helpers directly (the private
-- schema already has no USAGE for anon/authenticated; this is belt and
-- braces). Firing a trigger does not need EXECUTE on its function. ----
REVOKE ALL ON FUNCTION private.notification_time_text(timestamp) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.notification_range_text(timestamp, timestamp) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.notification_actor() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.meeting_recipient_ids(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.notify(uuid, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.notify_meeting_participant_added() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.notify_meeting_participant_removed() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.notify_meeting_changed() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.notify_reminder_due() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.notify_task_changed() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.notify_task_comment() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.notify_meeting_minutes() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.merge_legacy_notification() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION private.notify(uuid, text, text, text, text, text) IS
  'fix4: the single writer of in-app notifications for the triggers of 20261012090000 - skips no-account / in-app-off users, dedupes on ("userId","dedupeKey"), never raises (WARNING instead).';
COMMENT ON FUNCTION private.notify_meeting_participant_added() IS 'fix4 trigger fn: MEETING_INVITE when an account is added to a meeting (create or edit).';
COMMENT ON FUNCTION private.notify_meeting_participant_removed() IS 'fix4 trigger fn: MEETING_REMOVED when an account is taken off a meeting.';
COMMENT ON FUNCTION private.notify_meeting_changed() IS 'fix4 trigger fn: MEETING_CANCELLED / MEETING_UPDATED (reschedule, title, location, online link) to everyone in the meeting except the actor.';
COMMENT ON FUNCTION private.notify_reminder_due() IS 'fix4 trigger fn: REMINDER to organizer + participant accounts whenever a due reminder leaves PENDING (SENT/SIMULATED/FAILED/CANCELLED).';
COMMENT ON FUNCTION private.notify_task_changed() IS 'fix4 trigger fn: TASK_ASSIGNED / TASK_UPDATED on task insert, reassignment and status change.';
COMMENT ON FUNCTION private.notify_task_comment() IS 'fix4 trigger fn: TASK_COMMENT to the task creator and assignee except the author.';
COMMENT ON FUNCTION private.notify_meeting_minutes() IS 'fix4 trigger fn: MEETING_NOTE for a new MeetingNote or Decision, to everyone in the meeting except the author.';
COMMENT ON FUNCTION private.merge_legacy_notification() IS 'fix4 trigger fn: keeps the previous app version from duplicating TASK_ASSIGNED / REMINDER rows the triggers already wrote.';
COMMENT ON FUNCTION private.notification_time_text(timestamp) IS 'fix4: UTC timestamp -> Thai text in Asia/Bangkok, same shape as formatDateTime() ("12 ต.ค. 2569 • 10:00").';
COMMENT ON FUNCTION private.notification_range_text(timestamp, timestamp) IS 'fix4: start/end -> Thai range text in Asia/Bangkok, like formatDateTimeRange().';
COMMENT ON FUNCTION private.notification_actor() IS 'fix4: who made the change - auth.uid() (browser JWT) or the server-set transaction setting smartmeeting.actor_id; NULL when unknown.';
COMMENT ON FUNCTION private.meeting_recipient_ids(text) IS 'fix4: organizer + participant accounts of a meeting, distinct, never NULL (external contacts excluded).';
