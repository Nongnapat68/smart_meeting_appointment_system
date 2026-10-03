import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api-helpers";
import { isPastDue, parseDbTimestamp } from "@/lib/format";
import type { Meeting } from "@prisma/client";

/**
 * FR-18: One-shot meetings have no accumulated context for AI to draw on, so
 * none of the three AI features (FR-15/16/17) may run against them. Shared
 * by all three route handlers so the guard — and its message — can't drift
 * between them.
 */
export function assertMeetingAllowsAi(meeting: Pick<Meeting, "type">): void {
  if (meeting.type === "SINGLE") {
    throw new ApiError(
      400,
      "การประชุมเดี่ยว (One-shot) ไม่รองรับการใช้ AI เนื่องจากไม่มีบริบทสะสมจากการประชุมอื่น — ใช้ AI ได้เฉพาะการประชุมที่เชื่อมโยงกับโปรเจกต์"
    );
  }
}

export interface MeetingAiContext {
  relatedTasks: { id: string; title: string; status: string; priority: string; dueDate: Date | null }[];
  pastMeetings: { id: string; title: string; startTime: Date }[];
  pastDecisions: { id: string; content: string; meetingTitle: string; decidedAt: Date }[];
  pastNotes: { id: string; content: string; meetingTitle: string; createdAt: Date }[];
  pastResources: { id: string; title: string; url: string; meetingTitle: string }[];
}

// Row shapes inside the JSON get_meeting_context() returns. Timestamps come
// back as zone-less strings (columns are `timestamp`, stored in UTC).
interface ContextJson {
  relatedTasks: { id: string; title: string; status: string; priority: string; dueDate: string | null }[];
  pastMeetings: { id: string; title: string; startTime: string }[];
  pastDecisions: { id: string; content: string; meetingTitle: string; decidedAt: string }[];
  pastNotes: { id: string; content: string; meetingTitle: string; createdAt: string }[];
  pastResources: { id: string; title: string; url: string; meetingTitle: string }[];
}

/**
 * Gathers everything the AI features (FR-15 pre-meeting summary, FR-16
 * pending-issues analysis, FR-17 agenda suggestion) can draw on for a given
 * meeting: related tasks, and — from up to 5 earlier meetings in the same
 * project — decisions, notes, and related resources.
 *
 * FR-13 AC1: the gathering itself is done by the database function
 * public.get_meeting_context() (prisma/migrations/20260911150000_get_meeting_context_function),
 * so all three features see exactly the context the DB layer defines.
 * One-shot meetings (no project) get just their own tasks and no history.
 */
export async function gatherMeetingAiContext(meeting: Pick<Meeting, "id">): Promise<MeetingAiContext> {
  const rows = await prisma.$queryRaw<{ ctx: ContextJson | null }[]>`SELECT public.get_meeting_context(${meeting.id}) AS ctx`;
  const ctx = rows[0]?.ctx;
  if (!ctx) throw new ApiError(404, "ไม่พบการประชุมนี้");

  return {
    relatedTasks: ctx.relatedTasks.map((t) => ({ ...t, dueDate: t.dueDate ? parseDbTimestamp(t.dueDate) : null })),
    pastMeetings: ctx.pastMeetings.map((m) => ({ ...m, startTime: parseDbTimestamp(m.startTime) })),
    pastDecisions: ctx.pastDecisions.map((d) => ({ ...d, decidedAt: parseDbTimestamp(d.decidedAt) })),
    pastNotes: ctx.pastNotes.map((n) => ({ ...n, createdAt: parseDbTimestamp(n.createdAt) })),
    pastResources: ctx.pastResources.map((r) => ({ id: r.id, title: r.title, url: r.url, meetingTitle: r.meetingTitle })),
  };
}

/**
 * FR-16: tasks still open (not started/in progress) whose due date has passed.
 *
 * N5: overdue-ness goes through isPastDue() (Bangkok calendar-date compare)
 * rather than `dueDate < now`. dueDate arrives here already parsed from the
 * DB's midnight-UTC timestamp, so a direct comparison flagged a task due today
 * as overdue from 07:00 onward - the same off-by-seven-hours bug the two task
 * list pages had.
 */
export function splitOverdueTasks(tasks: MeetingAiContext["relatedTasks"], now = new Date()) {
  const overdue = tasks.filter(
    (t) =>
      (t.status === "NOT_STARTED" || t.status === "IN_PROGRESS") &&
      t.dueDate !== null &&
      isPastDue(t.dueDate, now)
  );
  const overdueIds = new Set(overdue.map((t) => t.id));
  const open = tasks.filter((t) => t.status !== "COMPLETED" && !overdueIds.has(t.id));
  return { overdue, open };
}
