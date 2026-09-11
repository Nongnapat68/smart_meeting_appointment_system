import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ApiError, assertOwner, requireUser, withApiErrors } from "@/lib/api-helpers";
import { notifyParticipantsByEmail } from "@/lib/meeting-notify";

type Params = { params: Promise<{ id: string }> };

/**
 * Hybrid migration round 1 (Meeting resource), step C: the email side of
 * meeting creation, split out of POST /api/meetings so that route could be
 * removed once meeting creation moved to the create_meeting_with_
 * participants() RPC (see src/components/meetings/MeetingForm.tsx). No DB
 * writes here at all — just reads the meeting + participants that RPC
 * already committed, then calls the same notifyParticipantsByEmail() every
 * other meeting-mutating route uses (FR-09).
 *
 * Deliberately its own endpoint rather than folded into the RPC itself,
 * since Postgres can't send email — see docs/DESIGN_DECISIONS.md §5.5.
 */
export const POST = withApiErrors(async (_request: Request, { params }: Params) => {
  const user = await requireUser();
  const { id } = await params;

  const meeting = await prisma.meeting.findUnique({
    where: { id },
    include: {
      participants: { include: { person: true } },
      organizerPerson: { select: { name: true, email: true } },
      onlineMeetingResource: { select: { url: true } },
    },
  });
  if (!meeting) throw new ApiError(404, "ไม่พบการประชุมนี้");
  assertOwner(
    user,
    meeting.organizerId === user.id,
    "เฉพาะผู้จัดประชุมหรือผู้ดูแลระบบเท่านั้นที่ส่งอีเมลแจ้งเตือนการประชุมนี้ได้"
  );

  try {
    await notifyParticipantsByEmail(meeting, "คำเชิญเข้าร่วมประชุมใหม่");
  } catch (err) {
    console.error("notifyParticipantsByEmail failed for meeting", meeting.id, err);
    throw new ApiError(500, "สร้างการประชุมสำเร็จ แต่ส่งอีเมลแจ้งเตือนผู้เข้าร่วมไม่สำเร็จ");
  }

  return NextResponse.json({ ok: true });
});
