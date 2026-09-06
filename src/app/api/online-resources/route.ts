import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { onlineMeetingResourceSchema } from "@/lib/validations";
import { parseBody, requireUser, withApiErrors } from "@/lib/api-helpers";

// FR-07/BR-09/BR-10: a reusable named online meeting link. Any signed-in
// member may create one (same authorization level as contact groups) —
// reuse is the whole point, so this isn't locked down per-meeting.

export const GET = withApiErrors(async () => {
  await requireUser();
  const resources = await prisma.onlineMeetingResource.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { meetings: true } } },
  });
  return NextResponse.json({ items: resources });
});

export const POST = withApiErrors(async (request: Request) => {
  const user = await requireUser();
  const body = parseBody(onlineMeetingResourceSchema, await request.json());

  const resource = await prisma.onlineMeetingResource.create({
    data: { name: body.name, url: body.url, createdById: user.id },
  });
  return NextResponse.json({ resource }, { status: 201 });
});
