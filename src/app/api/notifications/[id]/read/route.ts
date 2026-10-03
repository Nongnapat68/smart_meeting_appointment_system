import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ApiError, requireUser, withApiErrors } from "@/lib/api-helpers";

type Params = { params: Promise<{ id: string }> };

/**
 * Marks one of the signed-in user's notifications as read (clicking it in
 * NotificationBell) and returns their remaining unread count, so the bell
 * shows what the database holds rather than a locally decremented number.
 *
 * Owner-only with no admin bypass — deliberately not assertOwner(): a
 * notification is personal, same as the Notification RLS policy
 * "update_owner_only" (20260911120000_enable_rls_policies). Prisma bypasses
 * RLS, so this route has to enforce it itself. Idempotent: an already-read
 * notification just returns 200.
 */
export const POST = withApiErrors(async (_request: Request, { params }: Params) => {
  const user = await requireUser();
  const { id } = await params;

  const notification = await prisma.notification.findUnique({ where: { id }, select: { userId: true } });
  if (!notification) throw new ApiError(404, "ไม่พบการแจ้งเตือนนี้");
  if (notification.userId !== user.id) throw new ApiError(403, "คุณไม่มีสิทธิ์ดำเนินการกับการแจ้งเตือนนี้");

  // userId in the where as well, so the write itself can only ever touch the caller's own row.
  await prisma.notification.updateMany({ where: { id, userId: user.id }, data: { isRead: true } });
  const unreadCount = await prisma.notification.count({ where: { userId: user.id, isRead: false } });

  return NextResponse.json({ id, isRead: true, unreadCount });
});
