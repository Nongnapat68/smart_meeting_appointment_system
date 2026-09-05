import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ApiError, assertOwner, requireUser, withApiErrors } from "@/lib/api-helpers";

type Params = { params: Promise<{ id: string; personId: string }> };

export const DELETE = withApiErrors(async (_request: Request, { params }: Params) => {
  const user = await requireUser();
  const { id: groupId, personId } = await params;

  const group = await prisma.contactGroup.findUnique({ where: { id: groupId } });
  if (!group) throw new ApiError(404, "ไม่พบกลุ่มนี้");
  assertOwner(user, group.createdById === user.id, "เฉพาะผู้สร้างกลุ่มหรือผู้ดูแลระบบเท่านั้นที่ลบสมาชิกออกจากกลุ่มนี้ได้");

  const existing = await prisma.contactGroupMember.findUnique({
    where: { groupId_personId: { groupId, personId } },
  });
  if (!existing) throw new ApiError(404, "ไม่พบสมาชิกนี้ในกลุ่ม");

  await prisma.contactGroupMember.delete({
    where: { groupId_personId: { groupId, personId } },
  });
  return NextResponse.json({ ok: true });
});
