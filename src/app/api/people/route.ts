import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { personSchema } from "@/lib/validations";
import { ApiError, parseBody, parsePagination, requireUser, withApiErrors } from "@/lib/api-helpers";
import { PersonStatus, PersonType, type Prisma } from "@prisma/client";

export const GET = withApiErrors(async (request: Request) => {
  await requireUser();
  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);
  const q = searchParams.get("q")?.trim();
  const type = searchParams.get("type");
  const status = searchParams.get("status");

  const where: Prisma.PersonWhereInput = {
    ...(q
      ? {
          OR: [
            { name: { contains: q } },
            { email: { contains: q } },
            { department: { contains: q } },
          ],
        }
      : {}),
    ...(type && type in PersonType ? { type: type as PersonType } : {}),
    ...(status && status in PersonStatus ? { status: status as PersonStatus } : {}),
  };

  const [items, total, totalActive, totalExternal, totalAll] = await Promise.all([
    prisma.person.findMany({
      where,
      orderBy: { name: "asc" },
      skip,
      take,
      include: { groupMemberships: { include: { group: true } } },
    }),
    prisma.person.count({ where }),
    prisma.person.count({ where: { status: "ACTIVE" } }),
    prisma.person.count({ where: { type: "EXTERNAL" } }),
    prisma.person.count(),
  ]);

  return NextResponse.json({
    items,
    total,
    page,
    pageSize,
    stats: { totalAll, totalActive, totalExternal },
  });
});

export const POST = withApiErrors(async (request: Request) => {
  await requireUser();
  const body = parseBody(personSchema, await request.json());

  const existing = await prisma.person.findUnique({ where: { email: body.email } });
  if (existing) throw new ApiError(409, "มีผู้ติดต่อที่ใช้อีเมลนี้อยู่แล้ว");

  const person = await prisma.person.create({ data: body });
  return NextResponse.json({ person }, { status: 201 });
});
