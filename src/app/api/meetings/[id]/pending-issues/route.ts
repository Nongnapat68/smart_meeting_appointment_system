import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generatePendingIssuesAnalysis } from "@/lib/ai";
import { ApiError, assertOwner, requireUser, withApiErrors } from "@/lib/api-helpers";
import { assertMeetingAllowsAi, gatherMeetingAiContext, splitOverdueTasks } from "@/lib/meeting-ai-context";

type Params = { params: Promise<{ id: string }> };

/**
 * FR-16: Pending Issues Analysis — a capability separate from FR-15's
 * pre-meeting summary. Flags tasks that are overdue, plus decisions/notes
 * from past meetings in the same project that don't look followed up on.
 * Not persisted (same pattern as /api/tasks/ai-schedule): recomputed live
 * on every call from current data, not a stored snapshot.
 */
export const POST = withApiErrors(async (_request: Request, { params }: Params) => {
  const user = await requireUser();
  const { id } = await params;

  const meeting = await prisma.meeting.findUnique({
    where: { id },
    include: { project: { select: { name: true } } },
  });
  if (!meeting) throw new ApiError(404, "ไม่พบการประชุมนี้");
  assertOwner(
    user,
    meeting.organizerId === user.id,
    "เฉพาะผู้จัดประชุมหรือผู้ดูแลระบบเท่านั้นที่วิเคราะห์ประเด็นค้างของการประชุมนี้ได้"
  );
  assertMeetingAllowsAi(meeting);

  const ctx = await gatherMeetingAiContext(meeting);
  const { overdue, open } = splitOverdueTasks(ctx.relatedTasks);

  let analysis: string;
  try {
    analysis = await generatePendingIssuesAnalysis({
      projectName: meeting.project?.name ?? null,
      overdueTasks: overdue.map((t) => ({ title: t.title, status: t.status, priority: t.priority, dueDate: t.dueDate as Date })),
      openTasks: open.map((t) => ({ title: t.title, status: t.status, priority: t.priority, dueDate: t.dueDate })),
      decisions: ctx.pastDecisions.map((d) => ({ content: d.content, meetingTitle: d.meetingTitle })),
      notes: ctx.pastNotes.map((n) => ({ content: n.content, meetingTitle: n.meetingTitle })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "ไม่สามารถวิเคราะห์ประเด็นค้างด้วย AI ได้";
    throw new ApiError(502, message);
  }

  const sources = [
    ...overdue.map((t) => ({ label: t.title, refType: "task", refId: t.id })),
    ...ctx.pastDecisions.map((d) => ({ label: d.content, refType: "decision", refId: d.id })),
    ...ctx.pastNotes.map((n) => ({ label: n.content, refType: "note", refId: n.id })),
  ];

  return NextResponse.json({
    analysis,
    overdueTasks: overdue.map((t) => ({ id: t.id, title: t.title, dueDate: t.dueDate })),
    sources,
  });
});
