import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { updateOnlineMeetingResourceSchema } from "@/lib/validations";
import { ApiError, assertOwner, parseBody, requireUser, withApiErrors } from "@/lib/api-helpers";

type Params = { params: Promise<{ id: string }> };

export const GET = withApiErrors(async (_request: Request, { params }: Params) => {
  await requireUser();
  const { id } = await params;

  const resource = await prisma.onlineMeetingResource.findUnique({
    where: { id },
    include: { meetings: { select: { id: true, title: true, startTime: true } } },
  });
  if (!resource) throw new ApiError(404, "ไม่พบลิงก์ประชุมนี้");

  return NextResponse.json({ resource });
});

// BR-10: editing name/url here updates every meeting that references this
// resource in one place — there is nothing per-meeting to fall out of sync,
// since meetings only ever store the FK, never a copy of the url.
export const PUT = withApiErrors(async (request: Request, { params }: Params) => {
  const user = await requireUser();
  const { id } = await params;
  const body = parseBody(updateOnlineMeetingResourceSchema, await request.json());

  const existing = await prisma.onlineMeetingResource.findUnique({ where: { id } });
  if (!existing) throw new ApiError(404, "ไม่พบลิงก์ประชุมนี้");
  assertOwner(
    user,
    !existing.createdById || existing.createdById === user.id,
    "เฉพาะผู้สร้างลิงก์นี้หรือผู้ดูแลระบบเท่านั้นที่แก้ไขได้"
  );

  const resource = await prisma.onlineMeetingResource.update({ where: { id }, data: body });
  return NextResponse.json({ resource });
});

export const DELETE = withApiErrors(async (_request: Request, { params }: Params) => {
  const user = await requireUser();
  const { id } = await params;

  const existing = await prisma.onlineMeetingResource.findUnique({ where: { id } });
  if (!existing) throw new ApiError(404, "ไม่พบลิงก์ประชุมนี้");
  assertOwner(
    user,
    !existing.createdById || existing.createdById === user.id,
    "เฉพาะผู้สร้างลิงก์นี้หรือผู้ดูแลระบบเท่านั้นที่ลบได้"
  );

  // onDelete: SetNull on Meeting.onlineMeetingResourceId — meetings that used
  // this link just lose the reference, their history stays intact.
  await prisma.onlineMeetingResource.delete({ where: { id } });
  return NextResponse.json({ ok: true });
});
