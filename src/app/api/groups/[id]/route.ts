import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { groupSchema } from "@/lib/validations";
import { ApiError, assertOwner, parseBody, requireUser, withApiErrors } from "@/lib/api-helpers";

type Params = { params: Promise<{ id: string }> };

export const GET = withApiErrors(async (_request: Request, { params }: Params) => {
  await requireUser();
  const { id } = await params;

  const group = await prisma.contactGroup.findUnique({
    where: { id },
    include: {
      members: { include: { person: true }, orderBy: { role: "asc" } },
      meetings: { orderBy: { startTime: "desc" }, take: 20 },
    },
  });
  if (!group) throw new ApiError(404, "ไม่พบกลุ่มนี้");

  return NextResponse.json({ group });
});

export const PUT = withApiErrors(async (request: Request, { params }: Params) => {
  const user = await requireUser();
  const { id } = await params;
  const body = parseBody(groupSchema.partial(), await request.json());

  const existing = await prisma.contactGroup.findUnique({ where: { id } });
  if (!existing) throw new ApiError(404, "ไม่พบกลุ่มนี้");
  assertOwner(user, existing.createdById === user.id, "เฉพาะผู้สร้างกลุ่มหรือผู้ดูแลระบบเท่านั้นที่แก้ไขกลุ่มนี้ได้");

  const group = await prisma.contactGroup.update({ where: { id }, data: body });
  return NextResponse.json({ group });
});

export const DELETE = withApiErrors(async (_request: Request, { params }: Params) => {
  const user = await requireUser();
  const { id } = await params;

  const existing = await prisma.contactGroup.findUnique({ where: { id } });
  if (!existing) throw new ApiError(404, "ไม่พบกลุ่มนี้");
  assertOwner(user, existing.createdById === user.id, "เฉพาะผู้สร้างกลุ่มหรือผู้ดูแลระบบเท่านั้นที่ลบกลุ่มนี้ได้");

  await prisma.contactGroup.delete({ where: { id } });
  return NextResponse.json({ ok: true });
});
