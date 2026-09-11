-- Trigger #5 (BR-14): fills the "0 triggers" gap in the system. When
-- Meeting.status transitions to 'CANCELLED' from any other value, every
-- still-PENDING Reminder of that meeting is auto-cancelled.
--
-- This is the one commit that touches existing TypeScript business logic:
-- src/app/api/meetings/[id]/cancel/route.ts used to do this as a second,
-- separate updateMany() right after the meeting status update. That call
-- is removed here - the trigger now owns the cascade, so the route is left
-- doing only the meeting status update.
--
-- SECURITY INVOKER (default) - Prisma always connects as a role with
-- BYPASSRLS, so table-level RLS doesn't gate this either way today; kept
-- as invoker rather than definer since there's no cross-RLS need to hide.

CREATE OR REPLACE FUNCTION public.cancel_meeting_reminders()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status = 'CANCELLED' AND OLD.status IS DISTINCT FROM 'CANCELLED' THEN
    UPDATE public."Reminder"
    SET status = 'CANCELLED'
    WHERE "meetingId" = NEW.id
      AND status = 'PENDING';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.cancel_meeting_reminders() IS
  'BR-14: when Meeting.status transitions to CANCELLED, auto-cancels every still-PENDING Reminder for that meeting. Fired by trg_cancel_meeting_reminders. Replaces the updateMany() previously in src/app/api/meetings/[id]/cancel/route.ts.';

DROP TRIGGER IF EXISTS trg_cancel_meeting_reminders ON public."Meeting";
CREATE TRIGGER trg_cancel_meeting_reminders
AFTER UPDATE OF status ON public."Meeting"
FOR EACH ROW
WHEN (NEW.status = 'CANCELLED' AND OLD.status IS DISTINCT FROM 'CANCELLED')
EXECUTE FUNCTION public.cancel_meeting_reminders();
