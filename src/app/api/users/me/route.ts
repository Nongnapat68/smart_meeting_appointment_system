import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { updateProfileSchema } from "@/lib/validations";
import { parseBody, requireUser, withApiErrors } from "@/lib/api-helpers";

export const PATCH = withApiErrors(async (request: Request) => {
  const user = await requireUser();
  const body = parseBody(updateProfileSchema, await request.json());

  const updated = await prisma.user.update({ where: { id: user.id }, data: body });

  // Keep the linked Person record (contact directory) in sync so the name
  // shown to other users when inviting/assigning stays correct.
  await prisma.person.updateMany({
    where: { userId: user.id },
    data: {
      name: body.name,
      phone: body.phone ?? undefined,
      title: body.title ?? undefined,
      department: body.department ?? undefined,
    },
  });

  return NextResponse.json({
    user: {
      id: updated.id,
      email: updated.email,
      name: updated.name,
      avatarUrl: updated.avatarUrl,
      phone: updated.phone,
      title: updated.title,
      department: updated.department,
      emailNotifications: updated.emailNotifications,
      inAppNotifications: updated.inAppNotifications,
    },
  });
});
