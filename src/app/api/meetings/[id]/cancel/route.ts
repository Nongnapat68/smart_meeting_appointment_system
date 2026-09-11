import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ApiError, assertOwner, requireUser, withApiErrors } from "@/lib/api-helpers";

type Params = { params: Promise<{ id: string }> };

export const POST = withApiErrors(async (_request: Request, { params }: Params) => {
  const user = await requireUser();
  const { id } = await params;

  const existing = await prisma.meeting.findUnique({ where: { id } });
  if (!existing) throw new ApiError(404, "ไม่พบการประชุมนี้");
  assertOwner(user, existing.organizerId === user.id, "เฉพาะผู้จัดประชุมหรือผู้ดูแลระบบเท่านั้นที่ยกเลิกการประชุมนี้ได้");

  // BR-14: cancelling every still-PENDING Reminder for this meeting is now
  // handled by the trg_cancel_meeting_reminders trigger on Meeting (see
  // prisma/migrations/20260911160000_cancel_meeting_reminders_trigger) -
  // this update alone is enough to trigger that cascade.
  const meeting = await prisma.meeting.update({ where: { id }, data: { status: "CANCELLED" } });

  return NextResponse.json({ meeting });
});
