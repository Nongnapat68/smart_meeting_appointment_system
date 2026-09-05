import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { ApiError, assertOwner, requireUser, withApiErrors } from "@/lib/api-helpers";

type Params = { params: Promise<{ id: string }> };

export const POST = withApiErrors(async (_request: Request, { params }: Params) => {
  const user = await requireUser();
  const { id } = await params;

  const reminder = await prisma.reminder.findUnique({
    where: { id },
    include: { meeting: { include: { participants: { include: { person: true } } } } },
  });
  if (!reminder) throw new ApiError(404, "ไม่พบการแจ้งเตือนนี้");
  assertOwner(
    user,
    reminder.meeting.organizerId === user.id,
    "เฉพาะผู้จัดประชุมหรือผู้ดูแลระบบเท่านั้นที่ส่งการแจ้งเตือนนี้ใหม่ได้"
  );

  try {
    for (const p of reminder.meeting.participants) {
      await sendEmail({
        to: p.person.email,
        subject: `แจ้งเตือนการประชุม: ${reminder.meeting.title}`,
        text: `การประชุม "${reminder.meeting.title}" จะเริ่มเวลา ${reminder.meeting.startTime.toLocaleString("th-TH")}`,
      });
    }

    const updated = await prisma.reminder.update({
      where: { id },
      data: {
        status: "SENT",
        sentAt: new Date(),
        failureReason: null,
        retryCount: { increment: 1 },
      },
    });
    return NextResponse.json({ reminder: updated });
  } catch {
    const updated = await prisma.reminder.update({
      where: { id },
      data: {
        status: "FAILED",
        failureReason: "ไม่สามารถส่งอีเมลได้ กรุณาตรวจสอบการตั้งค่า SMTP",
        retryCount: { increment: 1 },
      },
    });
    return NextResponse.json({ reminder: updated }, { status: 502 });
  }
});
