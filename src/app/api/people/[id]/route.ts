import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { updatePersonSchema } from "@/lib/validations";
import { ApiError, assertOwner, parseBody, requireUser, withApiErrors } from "@/lib/api-helpers";

type Params = { params: Promise<{ id: string }> };

export const GET = withApiErrors(async (_request: Request, { params }: Params) => {
  await requireUser();
  const { id } = await params;

  const person = await prisma.person.findUnique({
    where: { id },
    include: {
      groupMemberships: { include: { group: true } },
      projectMemberships: { include: { project: true } },
    },
  });
  if (!person) throw new ApiError(404, "ไม่พบผู้ติดต่อนี้");

  const meetingHistory = await prisma.meetingParticipant.findMany({
    where: { personId: id },
    include: { meeting: true },
    orderBy: { meeting: { startTime: "desc" } },
    take: 10,
  });

  return NextResponse.json({ person, meetingHistory });
});

export const PUT = withApiErrors(async (request: Request, { params }: Params) => {
  const user = await requireUser();
  const { id } = await params;
  const body = parseBody(updatePersonSchema, await request.json());

  const existing = await prisma.person.findUnique({ where: { id } });
  if (!existing) throw new ApiError(404, "ไม่พบผู้ติดต่อนี้");
  // The contact directory is shared org data, so any signed-in member may
  // maintain an unlinked/external entry — but a person record linked to
  // *another* user's own account may only be edited by that user or an admin.
  assertOwner(
    user,
    !existing.userId || existing.userId === user.id,
    "คุณไม่มีสิทธิ์แก้ไขข้อมูลผู้ติดต่อของผู้ใช้รายอื่น"
  );

  if (body.email && body.email !== existing.email) {
    const dup = await prisma.person.findUnique({ where: { email: body.email } });
    if (dup) throw new ApiError(409, "มีผู้ติดต่อที่ใช้อีเมลนี้อยู่แล้ว");
  }

  const person = await prisma.person.update({ where: { id }, data: body });
  return NextResponse.json({ person });
});

export const DELETE = withApiErrors(async (_request: Request, { params }: Params) => {
  const user = await requireUser();
  const { id } = await params;

  const existing = await prisma.person.findUnique({ where: { id } });
  if (!existing) throw new ApiError(404, "ไม่พบผู้ติดต่อนี้");
  // Deleting a contact is destructive and affects every meeting/group/project
  // it's referenced from, so it's restricted to admins regardless of who
  // the record belongs to.
  assertOwner(user, false, "เฉพาะผู้ดูแลระบบเท่านั้นที่ลบผู้ติดต่อได้");

  // BR-02: hard-deleting a person who has ever attended a meeting must not
  // silently destroy that meeting's attendance history. MeetingParticipant.
  // personId is onDelete: Restrict at the DB level as the actual guarantee —
  // this check just turns that into a clear error instead of a raw FK
  // constraint failure. Contacts with no meeting history can still be
  // hard-deleted; anyone else must be set to "ไม่ใช้งาน" (PUT, status) instead.
  const participationCount = await prisma.meetingParticipant.count({ where: { personId: id } });
  if (participationCount > 0) {
    throw new ApiError(
      409,
      "ไม่สามารถลบผู้ติดต่อนี้ได้เพราะมีประวัติเข้าร่วมประชุมอยู่ — เปลี่ยนสถานะเป็น \"ไม่ใช้งาน\" แทน เพื่อไม่ให้ประวัติการประชุมหายไป"
    );
  }

  await prisma.person.delete({ where: { id } });
  return NextResponse.json({ ok: true });
});
