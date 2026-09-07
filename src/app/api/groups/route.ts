import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { groupSchema } from "@/lib/validations";
import { parseBody, requireUser, withApiErrors } from "@/lib/api-helpers";

export const GET = withApiErrors(async () => {
  const user = await requireUser();
  const userPerson = await prisma.person.findUnique({ where: { userId: user.id } });

  const groups = await prisma.contactGroup.findMany({
    where: {
      OR: [
        { createdById: user.id },
        ...(userPerson ? [{ members: { some: { personId: userPerson.id } } }] : []),
      ],
    },
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
