import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { addGroupMemberSchema } from "@/lib/validations";
import { ApiError, assertOwner, parseBody, requireUser, withApiErrors } from "@/lib/api-helpers";

type Params = { params: Promise<{ id: string }> };

export const POST = withApiErrors(async (request: Request, { params }: Params) => {
  const user = await requireUser();
  const { id: groupId } = await params;
  const body = parseBody(addGroupMemberSchema, await request.json());

  const group = await prisma.contactGroup.findUnique({ where: { id: groupId } });
  if (!group) throw new ApiError(404, "ไม่พบกลุ่มนี้");
  assertOwner(user, group.createdById === user.id, "เฉพาะผู้สร้างกลุ่มหรือผู้ดูแลระบบเท่านั้นที่เพิ่มสมาชิกในกลุ่มนี้ได้");

  const person = await prisma.person.findUnique({ where: { id: body.personId } });
  if (!person) throw new ApiError(404, "ไม่พบผู้ติดต่อนี้");

  const existing = await prisma.contactGroupMember.findUnique({
    where: { groupId_personId: { groupId, personId: body.personId } },
  });
  if (existing) throw new ApiError(409, "ผู้ติดต่อนี้อยู่ในกลุ่มนี้อยู่แล้ว");

  const member = await prisma.contactGroupMember.create({
    data: { groupId, personId: body.personId, role: body.role },
    include: { person: true },
  });
  return NextResponse.json({ member }, { status: 201 });
});
