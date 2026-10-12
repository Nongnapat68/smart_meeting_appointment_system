"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api-client";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/Toast";
import { EmptyState, ErrorBanner, FullPageSpinner } from "@/components/ui/Feedback";
import { formatDateTime, relativeTime } from "@/lib/format";
import {
  NOTIFICATION_TYPE_META,
  announceNotificationsChanged,
  notificationHref,
  onNotificationsChanged,
  type NotificationRow,
} from "@/lib/notification-types";

// Every notification of the signed-in user, newest first — the bell only
// shows the latest 10. Read straight through supabase-js: the
// select_owner_only RLS policy limits it to this user's own rows, and marking
// read goes through the same paths as the bell (POST /api/notifications/[id]/read,
// or update_owner_only for "อ่านทั้งหมด").

const PAGE_SIZE = 30;

export default function NotificationsPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshUnreadCount = useCallback(async () => {
    const { count } = await createClient()
      .from("Notification")
      .select("*", { count: "exact", head: true })
      .eq("isRead", false);
    setUnreadCount(count ?? 0);
  }, []);

  // One page starting at `offset`; replaces the list for offset 0, appends otherwise.
  const fetchPage = useCallback(
    async (offset: number) => {
      let query = createClient()
        .from("Notification")
        .select("id,type,title,body,isRead,relatedId,createdAt")
        .order("createdAt", { ascending: false })
        .order("id", { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1);
      if (unreadOnly) query = query.eq("isRead", false);
      const { data, error: dbError } = await query;
      if (dbError) throw new Error(dbError.message);
      const rows = (data ?? []) as unknown as NotificationRow[];
      setItems((prev) => (offset === 0 ? rows : [...prev, ...rows]));
      setHasMore(rows.length === PAGE_SIZE);
    },
    [unreadOnly]
  );

  // Fetch-on-mount / on filter change, same pattern as the other list pages.
  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    Promise.all([fetchPage(0), refreshUnreadCount()])
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "โหลดการแจ้งเตือนไม่สำเร็จ"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [fetchPage, refreshUnreadCount]);

  // The bell marked something read: keep this page's dots and count in step.
  useEffect(
    () =>
      onNotificationsChanged("page", () => {
        void refreshUnreadCount();
        void fetchPage(0).catch(() => {});
      }),
    [fetchPage, refreshUnreadCount]
  );

  async function loadMore() {
    setLoadingMore(true);
    try {
      await fetchPage(items.length);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "โหลดเพิ่มเติมไม่สำเร็จ", "error");
    } finally {
      setLoadingMore(false);
    }
  }

  async function markRead(n: NotificationRow): Promise<boolean> {
    if (n.isRead) return true;
    try {
      const res = await api.post<{ unreadCount: number }>(`/api/notifications/${n.id}/read`);
      setItems((prev) =>
        unreadOnly ? prev.filter((x) => x.id !== n.id) : prev.map((x) => (x.id === n.id ? { ...x, isRead: true } : x))
      );
      setUnreadCount(res.unreadCount);
      announceNotificationsChanged("page");
      return true;
    } catch (err) {
      showToast(err instanceof Error ? err.message : "บันทึกสถานะการอ่านไม่สำเร็จ", "error");
      return false;
    }
  }

  async function open(n: NotificationRow) {
    await markRead(n);
    const href = notificationHref(n);
    if (href) router.push(href);
  }

  async function markAllRead() {
    try {
      const supabase = createClient();
      const { data: authData } = await supabase.auth.getUser();
      if (!authData.user) throw new Error("กรุณาเข้าสู่ระบบก่อนใช้งาน");
      const { error: dbError } = await supabase
        .from("Notification")
        .update({ isRead: true })
        .eq("userId", authData.user.id)
        .eq("isRead", false);
      if (dbError) throw new Error(dbError.message);
      setItems((prev) => (unreadOnly ? [] : prev.map((x) => ({ ...x, isRead: true }))));
      setHasMore(false);
      announceNotificationsChanged("page");
      showToast("ทำเครื่องหมายว่าอ่านแล้วทั้งหมด", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "บันทึกสถานะการอ่านไม่สำเร็จ", "error");
    }
    await refreshUnreadCount();
  }

  const tabClass = (active: boolean) =>
    `px-3 py-1.5 rounded-full text-sm font-label-md transition-colors ${
      active ? "bg-primary text-on-primary" : "bg-surface-container text-on-surface-variant hover:bg-surface-container-high"
    }`;

  return (
    <div className="max-w-4xl mx-auto p-container-margin space-y-container-margin">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-headline-lg text-headline-lg text-on-surface">การแจ้งเตือนทั้งหมด</h2>
          <p className="text-on-surface-variant mt-1">ยังไม่อ่าน {unreadCount} รายการ</p>
        </div>
        {unreadCount > 0 && (
          <button
            type="button"
            onClick={markAllRead}
            className="self-start sm:self-auto px-4 py-2 rounded-lg border border-outline text-on-surface font-label-md text-label-md flex items-center gap-2 hover:bg-surface-container-low transition-colors"
          >
            <span className="material-symbols-outlined text-[18px]">done_all</span>
            อ่านทั้งหมดแล้ว
          </button>
        )}
      </div>

      <div className="flex gap-2" role="tablist" aria-label="กรองการแจ้งเตือน">
        <button type="button" role="tab" aria-selected={!unreadOnly} className={tabClass(!unreadOnly)} onClick={() => setUnreadOnly(false)}>
          ทั้งหมด
        </button>
        <button type="button" role="tab" aria-selected={unreadOnly} className={tabClass(unreadOnly)} onClick={() => setUnreadOnly(true)}>
          ยังไม่อ่าน
        </button>
      </div>

      <div className="bg-surface-container-lowest rounded-xl border border-outline-variant shadow-sm overflow-hidden">
        {loading && <FullPageSpinner />}
        {!loading && error && (
          <div className="p-4">
            <ErrorBanner message={error} />
          </div>
        )}
        {!loading && !error && items.length === 0 && (
          <EmptyState
            icon="notifications_off"
            title={unreadOnly ? "ไม่มีการแจ้งเตือนที่ยังไม่อ่าน" : "ไม่มีการแจ้งเตือน"}
            description="การแจ้งเตือนเรื่องประชุมและงานของคุณจะแสดงที่นี่"
          />
        )}
        {!loading && !error && items.length > 0 && (
          <ul className="divide-y divide-outline-variant/40">
            {items.map((n) => {
              const meta = NOTIFICATION_TYPE_META[n.type];
              return (
                <li key={n.id} className={`flex items-start gap-3 px-4 py-3 ${!n.isRead ? "bg-primary-container/5" : ""}`}>
                  <button type="button" onClick={() => open(n)} className="flex-1 min-w-0 flex items-start gap-3 text-left group">
                    <span
                      className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${
                        n.isRead ? "bg-surface-container text-on-surface-variant" : "bg-primary-container text-on-primary-container"
                      }`}
                    >
                      <span className="material-symbols-outlined text-[18px]">{meta?.icon ?? "notifications"}</span>
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="flex items-center gap-2 flex-wrap">
                        <span
                          className={`font-label-md text-label-md font-semibold break-words group-hover:text-primary ${
                            n.isRead ? "text-on-surface-variant" : "text-on-surface"
                          }`}
                        >
                          {n.title}
                        </span>
                        {!n.isRead && <span className="w-2 h-2 rounded-full bg-error shrink-0" aria-label="ยังไม่อ่าน" />}
                      </span>
                      {n.body && <span className="block text-sm text-on-surface-variant mt-0.5 break-words">{n.body}</span>}
                      <span className="flex items-center gap-2 flex-wrap text-xs text-on-surface-variant mt-1">
                        {meta && <span className="px-1.5 rounded bg-surface-container">{meta.label}</span>}
                        <span title={formatDateTime(n.createdAt)}>{relativeTime(n.createdAt)}</span>
                      </span>
                    </span>
                  </button>
                  {!n.isRead && (
                    <button
                      type="button"
                      onClick={() => markRead(n)}
                      className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-on-surface-variant hover:bg-surface-container-low hover:text-primary"
                      title="ทำเครื่องหมายว่าอ่านแล้ว"
                      aria-label="ทำเครื่องหมายว่าอ่านแล้ว"
                    >
                      <span className="material-symbols-outlined text-[18px]">done</span>
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {!loading && !error && hasMore && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={loadMore}
            disabled={loadingMore}
            className="px-4 py-2 rounded-lg border border-outline text-on-surface font-label-md text-label-md hover:bg-surface-container-low transition-colors disabled:opacity-60"
          >
            {loadingMore ? "กำลังโหลด..." : "โหลดเพิ่มเติม"}
          </button>
        </div>
      )}
    </div>
  );
}
