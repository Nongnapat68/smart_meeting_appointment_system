import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { generateAgendaSuggestion } from "@/lib/ai";
import { ApiError, assertOwner, parseBody, requireUser, withApiErrors } from "@/lib/api-helpers";
import { assertMeetingAllowsAi, gatherMeetingAiContext, splitOverdueTasks } from "@/lib/meeting-ai-context";

type Params = { params: Promise<{ id: string }> };

const agendaSuggestionSchema = z.object({
  topic: z.string().trim().min(1, "กรุณาระบุหัวข้อการประชุมครั้งถัดไป"),
});

/**
 * FR-17: New Agenda Context — the user types the topic for the *next*
 * meeting, and this merges it with the same pending-issues context FR-16
 * analyzes (overdue tasks + unresolved past decisions/notes) into a
 * ready-to-use agenda. Not persisted, same as FR-16/ai-schedule.
 */
export const POST = withApiErrors(async (request: Request, { params }: Params) => {
  const user = await requireUser();
  const { id } = await params;
  const body = parseBody(agendaSuggestionSchema, await request.json());

  const meeting = await prisma.meeting.findUnique({
    where: { id },
    include: { project: { select: { name: true } } },
  });
  if (!meeting) throw new ApiError(404, "ไม่พบการประชุมนี้");
  assertOwner(
    user,
    meeting.organizerId === user.id,
    "เฉพาะผู้จัดประชุมหรือผู้ดูแลระบบเท่านั้นที่แนะนำ agenda ของการประชุมนี้ได้"
  );
  assertMeetingAllowsAi(meeting);

  const ctx = await gatherMeetingAiContext(meeting);
  const { overdue, open } = splitOverdueTasks(ctx.relatedTasks);

  let agenda: string;
  try {
    agenda = await generateAgendaSuggestion({
      topic: body.topic,
      projectName: meeting.project?.name ?? null,
      overdueTasks: overdue.map((t) => ({ title: t.title, status: t.status, priority: t.priority, dueDate: t.dueDate as Date })),
      openTasks: open.map((t) => ({ title: t.title, status: t.status, priority: t.priority, dueDate: t.dueDate })),
      decisions: ctx.pastDecisions.map((d) => ({ content: d.content, meetingTitle: d.meetingTitle })),
      notes: ctx.pastNotes.map((n) => ({ content: n.content, meetingTitle: n.meetingTitle })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "ไม่สามารถแนะนำ agenda ด้วย AI ได้";
    throw new ApiError(502, message);
  }

  const sources = [
    ...overdue.map((t) => ({ label: t.title, refType: "task", refId: t.id })),
    ...ctx.pastDecisions.map((d) => ({ label: d.content, refType: "decision", refId: d.id })),
    ...ctx.pastNotes.map((n) => ({ label: n.content, refType: "note", refId: n.id })),
  ];

  return NextResponse.json({ agenda, sources });
});
