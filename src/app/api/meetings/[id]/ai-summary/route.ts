import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { aiErrorToApiError, generateMeetingSummary, isAiConfigured } from "@/lib/ai";
import { buildSampleMeetingSummary, SAMPLE_MODE_MODEL } from "@/lib/ai-sample-mode";
import { ApiError, assertOwner, parseBody, requireUser, withApiErrors } from "@/lib/api-helpers";
import { assertMeetingAllowsAi, gatherMeetingAiContext } from "@/lib/meeting-ai-context";
import { z } from "zod";

type Params = { params: Promise<{ id: string }> };

export const GET = withApiErrors(async (_request: Request, { params }: Params) => {
  await requireUser();
  const { id } = await params;
  const summary = await prisma.aISummary.findUnique({ where: { meetingId: id } });
  return NextResponse.json({ summary });
});

export const POST = withApiErrors(async (_request: Request, { params }: Params) => {
  const user = await requireUser();
  const { id } = await params;

  const meeting = await prisma.meeting.findUnique({
    where: { id },
    include: {
      organizer: { select: { name: true } },
      project: { select: { id: true, name: true } },
      participants: { include: { person: true } },
      resources: true,
    },
  });
  if (!meeting) throw new ApiError(404, "ไม่พบการประชุมนี้");
  assertOwner(
    user,
    meeting.organizerId === user.id,
    "เฉพาะผู้จัดประชุมหรือผู้ดูแลระบบเท่านั้นที่สร้างสรุป AI ของการประชุมนี้ได้"
  );

  // FR-18: One-shot meeting ไม่มีบริบทสะสมจากการประชุมอื่นให้ AI อ้างอิง จึงไม่จำเป็นต้อง
  // (และไม่ควร) เรียกใช้ AI — เฉพาะ meeting ที่เชื่อมกับ project เท่านั้นที่สร้างสรุปได้
  assertMeetingAllowsAi(meeting);
  // No API key: sample mode — same context, assembled with plain templates
  // instead of an LLM call (see src/lib/ai-sample-mode.ts).
  const sampleMode = !isAiConfigured();

  const ctx = await gatherMeetingAiContext(meeting);

  let content: string;
  if (sampleMode) {
    content = buildSampleMeetingSummary({
      projectName: meeting.project?.name ?? null,
      relatedTasks: ctx.relatedTasks,
      pastNotes: ctx.pastNotes,
      pastDecisions: ctx.pastDecisions,
    });
  } else try {
    content = await generateMeetingSummary({
      title: meeting.title,
      description: meeting.description,
      startTime: meeting.startTime,
      endTime: meeting.endTime,
      location: meeting.location,
      organizerName: meeting.organizer?.name ?? null,
      participantNames: meeting.participants.map((p) => p.person.name),
      projectName: meeting.project?.name ?? null,
      relatedTasks: ctx.relatedTasks.map((t) => ({ title: t.title, status: t.status, dueDate: t.dueDate })),
      pastMeetings: ctx.pastMeetings.map((m) => ({ title: m.title, startTime: m.startTime })),
      pastDecisions: ctx.pastDecisions.map((d) => ({ content: d.content, meetingTitle: d.meetingTitle })),
      pastNotes: ctx.pastNotes.map((n) => ({ content: n.content, meetingTitle: n.meetingTitle })),
      resources: meeting.resources.map((r) => ({ title: r.title, url: r.url })),
      pastResources: ctx.pastResources.map((r) => ({ title: r.title, url: r.url, meetingTitle: r.meetingTitle })),
    });
  } catch (err) {
    throw aiErrorToApiError(err, "สร้างสรุปก่อนการประชุม");
  }

  const sources = [
    ...ctx.relatedTasks.map((t) => ({ label: t.title, refType: "task", refId: t.id })),
    ...ctx.pastMeetings.map((m) => ({ label: m.title, refType: "meeting", refId: m.id })),
    ...ctx.pastDecisions.map((d) => ({ label: d.content, refType: "decision", refId: d.id })),
    ...ctx.pastNotes.map((n) => ({ label: n.content, refType: "note", refId: n.id })),
    ...meeting.resources.map((r) => ({ label: r.title, refType: "resource", refId: r.id })),
    ...ctx.pastResources.map((r) => ({ label: r.title, refType: "resource", refId: r.id })),
  ];

  const model = sampleMode ? SAMPLE_MODE_MODEL : "claude-opus-5";
  const summary = await prisma.aISummary.upsert({
    where: { meetingId: id },
    update: { content, sources: JSON.stringify(sources), model, isEdited: false, generatedAt: new Date() },
    create: {
      meetingId: id,
      content,
      sources: JSON.stringify(sources),
      model,
    },
  });

  // Let the organizer see it show up in the dashboard activity feed / notifications.
  // Skipped in sample mode — this notification announces an AI result.
  if (meeting.organizerId && !sampleMode) {
    await prisma.notification.create({
      data: {
        userId: meeting.organizerId,
        type: "AI_SUMMARY_READY",
        title: "AI สรุปข้อมูลก่อนประชุมเสร็จสิ้น",
        body: meeting.title,
        relatedId: meeting.id,
      },
    });
  }

  return NextResponse.json({ summary, mode: sampleMode ? "sample" : "ai" });
});

const editSummarySchema = z.object({ content: z.string().min(1) });

export const PATCH = withApiErrors(async (request: Request, { params }: Params) => {
  const user = await requireUser();
  const { id } = await params;
  const body = parseBody(editSummarySchema, await request.json());

  const existing = await prisma.aISummary.findUnique({ where: { meetingId: id } });
  if (!existing) throw new ApiError(404, "ยังไม่มีสรุปสำหรับการประชุมนี้");

  const meeting = await prisma.meeting.findUnique({ where: { id }, select: { organizerId: true } });
  assertOwner(
    user,
    meeting?.organizerId === user.id,
    "เฉพาะผู้จัดประชุมหรือผู้ดูแลระบบเท่านั้นที่แก้ไขสรุป AI ของการประชุมนี้ได้"
  );

  const summary = await prisma.aISummary.update({
    where: { meetingId: id },
    data: { content: body.content, isEdited: true },
  });

  return NextResponse.json({ summary });
});
