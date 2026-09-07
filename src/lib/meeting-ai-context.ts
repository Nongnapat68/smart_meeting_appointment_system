import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api-helpers";
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

/**
 * Gathers everything the AI features (FR-15 pre-meeting summary, FR-16
 * pending-issues analysis, FR-17 agenda suggestion) can draw on for a given
 * meeting: related tasks, and — from past meetings in the same project —
 * decisions, notes, and related resources. Centralized here (instead of
 * duplicated per route) so all three features see the exact same context
 * and stay in sync as more entities are added.
 *
 * Falls back to the meeting's own tasks (and no past-meeting history) when
 * it isn't linked to a project, same as the original FR-15 behavior.
 */
export async function gatherMeetingAiContext(
  meeting: Pick<Meeting, "id" | "projectId" | "startTime">
): Promise<MeetingAiContext> {
  const [relatedTasksRaw, pastMeetingsRaw] = await Promise.all([
    meeting.projectId
      ? prisma.task.findMany({
          where: { projectId: meeting.projectId },
          orderBy: { dueDate: "asc" },
          take: 20,
        })
      : prisma.task.findMany({ where: { meetingId: meeting.id }, take: 20 }),
    meeting.projectId
      ? prisma.meeting.findMany({
          where: { projectId: meeting.projectId, id: { not: meeting.id }, startTime: { lt: meeting.startTime } },
          orderBy: { startTime: "desc" },
          take: 5,
        })
      : Promise.resolve([]),
  ]);

  const pastMeetingIds = pastMeetingsRaw.map((m) => m.id);
  const [pastDecisionsRaw, pastNotesRaw, pastResourcesRaw] = await Promise.all([
    pastMeetingIds.length
      ? prisma.decision.findMany({
          where: { meetingId: { in: pastMeetingIds } },
          include: { meeting: { select: { title: true } } },
          orderBy: { decidedAt: "desc" },
          take: 10,
        })
      : Promise.resolve([]),
    pastMeetingIds.length
      ? prisma.meetingNote.findMany({
          where: { meetingId: { in: pastMeetingIds } },
          include: { meeting: { select: { title: true } } },
          orderBy: { createdAt: "desc" },
          take: 10,
        })
      : Promise.resolve([]),
    // FR-15/16: RelatedResource is the one entity of the three (Notes/
    // Decisions/RelatedResource) the pre-meeting summary previously left out
    // of "context from past meetings" — it only ever looked at *this*
    // meeting's own resources.
    pastMeetingIds.length
      ? prisma.relatedResource.findMany({
          where: { meetingId: { in: pastMeetingIds } },
          include: { meeting: { select: { title: true } } },
          orderBy: { createdAt: "desc" },
          take: 10,
        })
      : Promise.resolve([]),
  ]);

  return {
    relatedTasks: relatedTasksRaw.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      dueDate: t.dueDate,
    })),
    pastMeetings: pastMeetingsRaw.map((m) => ({ id: m.id, title: m.title, startTime: m.startTime })),
    pastDecisions: pastDecisionsRaw.map((d) => ({
      id: d.id,
      content: d.content,
      meetingTitle: d.meeting.title,
      decidedAt: d.decidedAt,
    })),
    pastNotes: pastNotesRaw.map((n) => ({
      id: n.id,
      content: n.content,
      meetingTitle: n.meeting.title,
      createdAt: n.createdAt,
    })),
    pastResources: pastResourcesRaw.map((r) => ({
      id: r.id,
      title: r.title,
      url: r.url,
      meetingTitle: r.meeting.title,
    })),
  };
}

/** FR-16: tasks still open (not started/in progress) whose due date has passed. */
export function splitOverdueTasks(tasks: MeetingAiContext["relatedTasks"], now = new Date()) {
  const overdue = tasks.filter(
    (t) => (t.status === "NOT_STARTED" || t.status === "IN_PROGRESS") && t.dueDate !== null && t.dueDate < now
  );
  const overdueIds = new Set(overdue.map((t) => t.id));
  const open = tasks.filter((t) => t.status !== "COMPLETED" && !overdueIds.has(t.id));
  return { overdue, open };
}
