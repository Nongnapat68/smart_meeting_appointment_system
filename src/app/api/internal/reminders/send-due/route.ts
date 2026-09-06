import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";

export const runtime = "nodejs";

/** Called by a trusted deployment scheduler, never by a browser session. */
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "ไม่ได้รับอนุญาต" }, { status: 401 });
  }

  const due = await prisma.reminder.findMany({
    where: { status: "PENDING", scheduledAt: { lte: new Date() } },
    include: { meeting: { include: { participants: { include: { person: true } } } } },
    orderBy: { scheduledAt: "asc" },
    take: 100,
  });
  let sent = 0;
  let failed = 0;

  for (const reminder of due) {
    // Claim the row first; a second scheduler invocation cannot send it twice.
    const claimed = await prisma.reminder.updateMany({
      where: { id: reminder.id, status: "PENDING" },
      data: { status: "PROCESSING", failureReason: null },
    });
    if (!claimed.count) continue;

    try {
      await Promise.all(
        reminder.meeting.participants.map((participant) =>
          sendEmail({
            to: participant.person.email,
            subject: `แจ้งเตือนการประชุม: ${reminder.meeting.title}`,
            text: `การประชุม "${reminder.meeting.title}" จะเริ่มเวลา ${reminder.meeting.startTime.toLocaleString("th-TH")}`,
          })
        )
      );
      await prisma.reminder.update({
        where: { id: reminder.id },
        data: { status: "SENT", sentAt: new Date(), failureReason: null, retryCount: { increment: 1 } },
      });
      sent++;
    } catch {
      await prisma.reminder.update({
        where: { id: reminder.id },
        data: { status: "FAILED", failureReason: "ไม่สามารถส่งอีเมลได้ กรุณาตรวจสอบการตั้งค่า SMTP", retryCount: { increment: 1 } },
      });
      failed++;
    }
  }

  return NextResponse.json({ processed: due.length, sent, failed });
}
