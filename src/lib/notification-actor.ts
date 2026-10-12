import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * In-app notifications are written by database triggers
 * (prisma/migrations/20261012090000_in_app_notifications_for_all_events), and
 * they never notify the person who made the change. For supabase-js / RPC
 * calls the triggers know who that is from the request JWT (auth.uid()); a
 * Prisma connection has no JWT, so a server route says it here instead: the
 * transaction-local setting smartmeeting.actor_id, read by
 * private.notification_actor(). It lasts only until this transaction ends,
 * so it can never leak to another request sharing the pooled connection.
 *
 * Only for writes that should notify others (tasks today). Without it the
 * write still works and still notifies - the actor just isn't skipped.
 */
export function withNotificationActor<T>(userId: string, run: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('smartmeeting.actor_id', ${userId}, true)`;
    return run(tx);
  });
}
