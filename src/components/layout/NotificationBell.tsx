"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { relativeTime } from "@/lib/format";

type NotificationType =
  | "MEETING_INVITE"
  | "MEETING_UPDATED"
  | "MEETING_CANCELLED"
  | "TASK_ASSIGNED"
  | "AI_SUMMARY_READY"
  | "REMINDER";

interface NotificationRow {
  id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  isRead: boolean;
  relatedId: string | null;
  createdAt: string;
}

const TYPE_META: Record<NotificationType, { icon: string; href: (id: string) => string }> = {
  MEETING_INVITE: { icon: "event", href: (id) => `/meetings/${id}` },
  MEETING_UPDATED: { icon: "edit_calendar", href: (id) => `/meetings/${id}` },
  MEETING_CANCELLED: { icon: "event_busy", href: (id) => `/meetings/${id}` },
  TASK_ASSIGNED: { icon: "task_alt", href: (id) => `/tasks/${id}` },
  AI_SUMMARY_READY: { icon: "auto_awesome", href: (id) => `/meetings/${id}` },
  REMINDER: { icon: "notifications_active", href: (id) => `/meetings/${id}` },
};

export function NotificationBell({ initialUnreadCount = 0 }: { initialUnreadCount?: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Fetch-on-mount pattern deemed safe by design (see eslint.config.mjs).
  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await createClient()
      .from("Notification")
      .select("*")
      .order("createdAt", { ascending: false })
      .limit(10);
    if (!error) {
      const rows = (data ?? []) as unknown as NotificationRow[];
      setItems(rows);
      setUnreadCount(rows.filter((n) => !n.isRead).length);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function openNotification(n: NotificationRow) {
    if (!n.isRead) {
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, isRead: true } : x)));
      setUnreadCount((c) => Math.max(0, c - 1));
      createClient().from("Notification").update({ isRead: true }).eq("id", n.id);
    }
    setOpen(false);
    if (n.relatedId) router.push(TYPE_META[n.type]?.href(n.relatedId));
  }

  async function markAllRead() {
    if (items.every((n) => n.isRead)) return;
    setItems((prev) => prev.map((n) => ({ ...n, isRead: true })));
    setUnreadCount(0);
    try {
      const { data: authData } = await createClient().auth.getUser();
      if (authData.user) {
        await createClient().from("Notification").update({ isRead: true }).eq("userId", authData.user.id).eq("isRead", false);
      }
    } catch {
      // best-effort — the dot just stays until next fetch
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="w-10 h-10 rounded-full flex items-center justify-center text-on-surface-variant hover:bg-surface-container-low transition-all active:opacity-80 relative"
        title="การแจ้งเตือน"
        aria-label="การแจ้งเตือน"
      >
        <span className="material-symbols-outlined">notifications</span>
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-error text-on-error text-[10px] font-bold flex items-center justify-center border-2 border-surface">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-12 w-80 md:w-96 bg-surface-container-lowest rounded-xl border border-outline-variant shadow-[0_4px_15px_rgba(0,0,0,0.15)] z-50 flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-outline-variant/50">
            <span className="font-headline-md text-headline-md text-on-surface">การแจ้งเตือนของฉัน</span>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                className="text-xs font-label-md text-primary hover:underline"
              >
                อ่านทั้งหมดแล้ว
              </button>
            )}
          </div>

          {loading && <p className="p-4 text-sm text-on-surface-variant text-center">กำลังโหลด...</p>}

          {!loading && items.length === 0 && (
            <div className="p-6 text-center flex flex-col items-center gap-2 text-on-surface-variant">
              <span className="material-symbols-outlined text-[32px] text-outline">notifications_off</span>
              <p className="text-sm">ไม่มีการแจ้งเตือน</p>
            </div>
          )}

          {!loading && items.length > 0 && (
            <ul className="max-h-[360px] overflow-y-auto divide-y divide-outline-variant/40">
              {items.map((n) => {
                const meta = TYPE_META[n.type];
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => openNotification(n)}
                      className={`w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-surface-container-low transition-colors ${
                        !n.isRead ? "bg-primary-container/5" : ""
                      }`}
                    >
                      <span
                        className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${
                          n.isRead ? "bg-surface-container text-on-surface-variant" : "bg-primary-container text-on-primary-container"
                        }`}
                      >
                        <span className="material-symbols-outlined text-[18px]">{meta?.icon ?? "notifications"}</span>
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="flex items-center gap-2">
                          <span className={`font-label-md text-label-md font-semibold truncate ${n.isRead ? "text-on-surface-variant" : "text-on-surface"}`}>
                            {n.title}
                          </span>
                          {!n.isRead && <span className="w-2 h-2 rounded-full bg-error shrink-0" />}
                        </span>
                        {n.body && <span className="block text-xs text-on-surface-variant truncate mt-0.5">{n.body}</span>}
                        <span className="block text-[11px] text-on-surface-variant mt-0.5">{relativeTime(n.createdAt)}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}