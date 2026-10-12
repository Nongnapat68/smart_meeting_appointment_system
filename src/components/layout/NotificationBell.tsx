"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { api } from "@/lib/api-client";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/Toast";
import { relativeTime } from "@/lib/format";
import {
  NOTIFICATION_TYPE_META,
  announceNotificationsChanged,
  notificationHref,
  onNotificationsChanged,
  type NotificationRow,
} from "@/lib/notification-types";

export function NotificationBell({ initialUnreadCount = 0 }: { initialUnreadCount?: number }) {
  const router = useRouter();
const pathname = usePathname();
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

// The badge always comes from the database: a count-only query over every
  // unread row (select_owner_only RLS scopes it to this user), not from the
  // 10 rows the dropdown shows — those undercount once there are more than
  // 10 unread.
  // Last count read from the database — null until the first read, so the
  // first load never announces "new" notifications that were already there.
  const lastUnread = useRef<number | null>(null);
  const refreshUnreadCount = useCallback(async (): Promise<"ok" | "error" | "unauthorized"> => {
    try {
      const { count, error, status } = await createClient()
        .from("Notification")
        .select("*", { count: "exact", head: true })
        .eq("isRead", false);
      if (status === 401 || error?.code === "42501") return "unauthorized";
      if (error) return "error";
      const next = count ?? 0;
      if (lastUnread.current !== null && next > lastUnread.current) showToast("มีการแจ้งเตือนใหม่", "info");
      lastUnread.current = next;
      setUnreadCount(next);
      return "ok";
    } catch {
      return "error";
    }
  }, [showToast]);
  // Fetch-on-mount pattern deemed safe by design (see eslint.config.mjs).
  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await createClient()
      .from("Notification")
      .select("*")
      .order("createdAt", { ascending: false })
      .limit(10);
if (!error) setItems((data ?? []) as unknown as NotificationRow[]);
    await refreshUnreadCount();
    setLoading(false);
  }, [refreshUnreadCount]);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

// The (app) layout — and this bell with it — stays mounted across
  // client-side navigation, so initialUnreadCount from the server render goes
  // stale. Re-read the real count on every page change.
  useEffect(() => {
    // Fetch-on-navigation, same fetch-then-setState pattern as load() above.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshUnreadCount();
  }, [pathname, refreshUnreadCount]);

  // /notifications marked something read: re-read the real count now rather
  // than at the next 30 s tick (and without a "new notification" toast — the
  // count only goes down there).
  useEffect(() => onNotificationsChanged("bell", () => void refreshUnreadCount()), [refreshUnreadCount]);

  // New notifications (an invite, a reminder from the auto-processor) are rows
  // written by someone else, so nothing on this page changes when they arrive.
  // Re-read the count every 30 s while the tab is visible: paused while hidden
  // and re-read as soon as it is visible again, never two reads at once,
  // backing off up to 5 min after errors, and stopped for good once the
  // session is gone (401 / signed out).
  useEffect(() => {
    const BASE_MS = 30_000;
    const MAX_MS = 5 * 60_000;
    let delay = BASE_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inFlight = false;
    let stopped = false;
    const schedule = () => {
      clearTimeout(timer);
      if (!stopped && document.visibilityState === "visible") timer = setTimeout(tick, delay);
    };
    async function tick() {
      if (stopped || inFlight || document.visibilityState !== "visible") return;
      inFlight = true;
      const result = await refreshUnreadCount();
      inFlight = false;
      if (result === "unauthorized") {
        stopped = true;
        return;
      }
      delay = result === "ok" ? BASE_MS : Math.min(delay * 2, MAX_MS);
      schedule();
    }
    const onVisibility = () => {
      if (document.visibilityState === "visible") void tick();
      else clearTimeout(timer);
    };
    document.addEventListener("visibilitychange", onVisibility);
    const { data: auth } = createClient().auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        stopped = true;
        clearTimeout(timer);
      }
    });
    schedule();
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      auth.subscription.unsubscribe();
    };
  }, [refreshUnreadCount]);
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

// Save first, then navigate. This used to only decrement local state and
  // fire `.update()` without awaiting it — a supabase-js query builder never
  // sends its request until awaited, so the row stayed isRead=false and the
  // badge came back on the next page load.
  async function openNotification(n: NotificationRow) {
    if (!n.isRead) {
      try {
        const res = await api.post<{ unreadCount: number }>(`/api/notifications/${n.id}/read`);
        setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, isRead: true } : x)));
        setUnreadCount(res.unreadCount);
        lastUnread.current = res.unreadCount;
      } catch (err) {
        // Still open what was clicked; the badge keeps the real (unchanged) count.
        showToast(err instanceof Error ? err.message : "บันทึกสถานะการอ่านไม่สำเร็จ", "error");
      }
    }
    setOpen(false);
    announceNotificationsChanged("bell");
    // A type this build doesn't know (or no relatedId) has no page: just mark it read.
    const href = notificationHref(n);
    if (href) router.push(href);
  }

  async function markAllRead() {
if (unreadCount === 0) return;
    try {
      const { data: authData } = await createClient().auth.getUser();
      if (!authData.user) throw new Error("กรุณาเข้าสู่ระบบก่อนใช้งาน");
      const { error } = await createClient()
        .from("Notification")
        .update({ isRead: true })
        .eq("userId", authData.user.id)
        .eq("isRead", false);
      if (error) throw new Error(error.message);
      setItems((prev) => prev.map((n) => ({ ...n, isRead: true })));
      announceNotificationsChanged("bell");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "บันทึกสถานะการอ่านไม่สำเร็จ", "error");
    }
    await refreshUnreadCount();
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
                const meta = NOTIFICATION_TYPE_META[n.type];
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
                          {!n.isRead && <span className="w-2 h-2 rounded-full bg-error shrink-0" aria-label="ยังไม่อ่าน" />}
                        </span>
                        {n.body && <span className="block text-xs text-on-surface-variant truncate mt-0.5">{n.body}</span>}
                        <span className="flex items-center gap-2 text-[11px] text-on-surface-variant mt-0.5">
                          {meta && <span className="px-1.5 rounded bg-surface-container text-on-surface-variant">{meta.label}</span>}
                          {relativeTime(n.createdAt)}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {/* The dropdown only holds the latest 10; everything else lives on /notifications. */}
          <Link
            href="/notifications"
            onClick={() => setOpen(false)}
            className="block px-4 py-2.5 text-center text-sm font-label-md text-primary hover:bg-surface-container-low border-t border-outline-variant/50"
          >
            ดูการแจ้งเตือนทั้งหมด
          </Link>
        </div>
      )}
    </div>
  );
}