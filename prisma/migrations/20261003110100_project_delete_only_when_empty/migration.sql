-- A project can only be deleted while nothing is linked to it.
--
-- Meeting.projectId and Task.projectId were ON DELETE SET NULL, so deleting a
-- project silently detached every meeting and task from it: the meetings
-- stayed, but the project they were the history of (BR-06/BR-17, FR-06) and
-- the continuity get_meeting_context() builds the AI context from were lost.
-- The delete feature is for a project created by mistake, so the rule is
-- "empty projects only": RESTRICT makes Postgres itself refuse the DELETE
-- (SQLSTATE 23503) while any meeting or task still points at the project,
-- whichever client issues it. Meetings/tasks have to be moved off or deleted
-- first, deliberately, one by one.
--
-- ProjectMember stays ON DELETE CASCADE: membership rows mean nothing once
-- the project is gone. Who may delete is unchanged (RLS
-- "delete_manager_or_admin" on Project).

ALTER TABLE public."Meeting" DROP CONSTRAINT "Meeting_projectId_fkey";
ALTER TABLE public."Meeting" ADD CONSTRAINT "Meeting_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES public."Project"(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE public."Task" DROP CONSTRAINT "Task_projectId_fkey";
ALTER TABLE public."Task" ADD CONSTRAINT "Task_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES public."Project"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
