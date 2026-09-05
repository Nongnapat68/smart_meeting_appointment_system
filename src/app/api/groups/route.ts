import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { groupSchema } from "@/lib/validations";
import { parseBody, requireUser, withApiErrors } from "@/lib/api-helpers";

export const GET = withApiErrors(async () => {
  await requireUser();
  const groups = await prisma.contactGroup.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { members: true } } },
  });
  return NextResponse.json({ items: groups });
});

export const POST = withApiErrors(async (request: Request) => {
  const user = await requireUser();
  const body = parseBody(groupSchema, await request.json());

  const group = await prisma.contactGroup.create({
    data: { ...body, createdById: user.id },
  });
  return NextResponse.json({ group }, { status: 201 });
});
