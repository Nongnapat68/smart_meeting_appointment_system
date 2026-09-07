"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api-client";
import { relativeTime } from "@/lib/format";
import type { Notification as NotificationRow, NotificationType } from "@prisma/client";

const TYPE_ICONS: Record<NotificationType, string> = {
  MEETING_INVITE: "event_available",
  MEETING_UPDATED: "edit_calendar",
  MEETING_CANCELLED: "event_busy",
  TASK_ASSIGNED: "task_alt",
  AI_SUMMARY_READY: "auto_awesome",
  REMINDER: "notifications_active",
};

function notificationHref(n: NotificationRow): string {
  switch (n.type) {
    case "MEETING_INVITE":
    case "MEETING_UPDATED":
    case "MEETING_CANCELLED":
      return n.relatedId ? `/meetings/${n.relatedId}` : "/meetings";
    case "TASK_ASSIGNED":
      return n.relatedId ? `/tasks/${n.relatedId}` : "/tasks";
    case "AI_SUMMARY_READY":
      return n.relatedId ? `/ai-assistant?meetingId=${n.relatedId}` : "/ai-assistant";
    case "REMINDER":
      return "/reminders";
  }
}

export function NotificationBell({ initialUnreadCount = 0 }: { initialUnreadCount?: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount);
  const [loading, setLoading] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<{ items: NotificationRow[]; unreadCount: number }>(
        "/api/notifications?limit=50"
      );
      setItems(res.items);
      setUnreadCount(res.unreadCount);
    } catch {
      // ignore — bell stays with its current state
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    load();
  }, [open, load]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleEscape);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  async function markRead(n: NotificationRow) {
    if (!n.isRead) {
      void api.post(`/api/notifications/${n.id}/read`).then(() => {
        setUnreadCount((c) => Math.max(0, c - 1));
      });
    }
  }

  async function readAll() {
    try {
      await api.post("/api/notifications/read-all");
      setUnreadCount(0);
      setItems((prev) => prev.map((n) => ({ ...n, isRead: true })));
    } catch {
      // ignore
    }
  }

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-10 h-10 rounded-full flex items-center justify-center text-on-surface-variant hover:bg-surface-container-low transition-all active:opacity-80 relative"
        title="การแจ้งเตือน"
      >
        <span className="material-symbols-outlined">notifications</span>
        {unreadCount > 0 && (
          <span className="absolute top-1.5 right-1.5 min-w-[16px] h-4 px-0.5 rounded-full bg-error text-on-error text-[10px] font-semibold flex items-center justify-center">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-12 w-[360px] max-w-[calc(100vw-24px)] bg-surface-container-lowest rounded-xl shadow-lg border border-outline-variant z-50 overflow-hidden flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-outline-variant bg-surface-bright">
            <h3 className="font-headline-md text-headline-md text-on-background">การแจ้งเตือน</h3>
            {unreadCount > 0 && (
              <button
                onClick={readAll}
                className="text-primary font-label-md text-label-md hover:underline"
              >
                อ่านทั้งหมด
              </button>
            )}
          </div>

          <div className="max-h-[380px] overflow-y-auto">
            {loading && items.length === 0 && (
              <p className="p-6 text-center font-body-md text-body-md text-on-surface-variant">
                กำลังโหลด...
              </p>
            )}
            {!loading && items.length === 0 && (
              <div className="p-8 text-center flex flex-col items-center gap-2">
                <span className="material-symbols-outlined text-[40px] text-on-surface-variant/50">
                  notifications_none
                </span>
                <p className="font-body-md text-body-md text-on-surface-variant">
                  ยังไม่มีการแจ้งเตือน
                </p>
              </div>
            )}
            {items.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => {
                  markRead(n);
                  setOpen(false);
                  const href = notificationHref(n);
                  router.push(href);
                  router.refresh();
                }}
                className={`w-full text-left px-4 py-3 flex gap-3 border-b border-outline-variant/40 transition-colors hover:bg-surface-container-low ${
                  n.isRead ? "" : "bg-primary-fixed/10"
                }`}
              >
                <span
                  className={`material-symbols-outlined text-[22px] mt-0.5 shrink-0 ${
                    n.isRead ? "text-on-surface-variant" : "text-primary"
                  }`}
                >
                  {TYPE_ICONS[n.type]}
                </span>
                <span className="flex flex-col min-w-0">
                  <span className="font-body-md text-body-md font-medium text-on-background leading-snug">
                    {n.title}
                  </span>
                  {n.body && (
                    <span className="font-body-md text-sm text-on-surface-variant truncate mt-0.5">
                      {n.body}
                    </span>
                  )}
                  <span className="font-label-md text-label-md text-on-surface-variant mt-1">
                    {relativeTime(n.createdAt)}
                  </span>
                </span>
                {!n.isRead && (
                  <span className="w-2 h-2 rounded-full bg-primary shrink-0 mt-2 ml-auto" />
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}