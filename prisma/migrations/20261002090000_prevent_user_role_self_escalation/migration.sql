-- Closes a privilege-escalation hole in 20260911120000_enable_rls_policies:
-- `GRANT ... UPDATE ON "User" TO authenticated` covers every column, and the
-- "update_self_or_admin" policy lets a user UPDATE their own row — so a
-- MEMBER could run `update "User" set role = 'ADMIN' where id = auth.uid()`
-- through supabase-js and become an admin (is_admin() reads this column, so
-- every RLS policy and every API route's assertOwner() would then pass).
--
-- A column-level REVOKE of UPDATE(role) isn't enough on its own: admins must
-- still be able to change other users' roles through the same client, and
-- column privileges can't express "only when is_admin()". So this guards the
-- role column with a BEFORE UPDATE trigger instead, leaving the existing
-- policy untouched — a MEMBER can still update every other column of their
-- own row (name, phone, title, ...).
--
-- auth.uid() IS NULL means the statement didn't come through PostgREST with
-- a user JWT (e.g. Prisma connecting as postgres from a trusted server route,
-- or a migration/seed) — those paths are already trusted and unaffected.
-- SECURITY INVOKER: is_admin() is itself SECURITY DEFINER, so no extra
-- privilege is needed here.

CREATE OR REPLACE FUNCTION public.prevent_user_role_self_escalation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role
     AND auth.uid() IS NOT NULL
     AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'เฉพาะผู้ดูแลระบบเท่านั้นที่เปลี่ยนบทบาท (role) ของผู้ใช้ได้'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.prevent_user_role_self_escalation() IS
  'Blocks a non-admin authenticated user from changing public."User".role (including their own). Requests without a user JWT (auth.uid() IS NULL, e.g. Prisma as postgres) are unaffected.';

DROP TRIGGER IF EXISTS trg_prevent_user_role_self_escalation ON public."User";
CREATE TRIGGER trg_prevent_user_role_self_escalation
BEFORE UPDATE OF role ON public."User"
FOR EACH ROW
EXECUTE FUNCTION public.prevent_user_role_self_escalation();
