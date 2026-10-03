-- FR-13 AC1: the AI routes (ai-summary, pending-issues, agenda-suggestion)
-- now gather their context by calling get_meeting_context() —
-- src/lib/meeting-ai-context.ts gatherMeetingAiContext() is a thin wrapper
-- that runs it and converts the JSON. Only the function's description
-- changes; its body is untouched.
COMMENT ON FUNCTION public.get_meeting_context(text) IS
  'requirements.md §8.14 / FR-13 (FR-15/16/17) — context for the AI features: related/overdue tasks, and past decisions/notes/resources from up to 5 earlier meetings in the same project, as one JSON blob. Called by the AI routes through src/lib/meeting-ai-context.ts gatherMeetingAiContext().';
