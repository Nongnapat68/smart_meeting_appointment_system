import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, withApiErrors } from "@/lib/api-helpers";

export const GET = withApiErrors(async (request: Request) => {
  const user = await requireUser();
  const { searchParams } = new URL(request.url);
  const limitRaw = parseInt(searchParams.get("limit") ?? "30", 10);
  const limit = Math.min(100, Math.max(1, limitRaw));

  const [items, unreadCount, total] = await Promise.all([
    prisma.notification.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
    prisma.notification.count({ where: { userId: user.id, isRead: false } }),
    prisma.notification.count({ where: { userId: user.id } }),
  ]);

  return NextResponse.json({ items, unreadCount, total });
});