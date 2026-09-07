import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Sidebar } from "@/components/layout/Sidebar";
import { TopBar } from "@/components/layout/TopBar";

declare global {
  // eslint-disable-next-line no-var
  var __reminderCheckAt: number | undefined;
}

/**
 * Best-effort in-flight reminder delivery, fired once per ~25s from a server
 * component render so reminders reach their recipients even in `next dev`
 * (where `instrumentation.ts` does not run). In production the background
 * scheduler in `src/lib/reminder-scheduler.ts` (via instrumentation) owns
 * delivery; this is a harmless fallback and is idempotent because rows are
 * claimed pessimistically.
 */
function scheduleBestEffortReminderCheck() {
  const now = Date.now();
  if (globalThis.__reminderCheckAt && now - globalThis.__reminderCheckAt < 25_000) {
    return;
  }
  globalThis.__reminderCheckAt = now;
  void import("@/lib/reminder-processor").then(({ processDueReminders }) =>
    processDueReminders().catch((err) => console.error("[reminders] best-effort check failed:", err))
  );
}

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  scheduleBestEffortReminderCheck();

  const unreadCount = await prisma.notification.count({
    where: { userId: user.id, isRead: false },
  });

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <div className="flex-1 md:ml-sidebar-width flex flex-col min-h-screen">
        <TopBar userName={user.name} avatarUrl={user.avatarUrl} unreadCount={unreadCount} />
        <main className="flex-1 pt-16">{children}</main>
      </div>
    </div>
  );
}
