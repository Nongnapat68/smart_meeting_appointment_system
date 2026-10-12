// What the bell (src/components/layout/NotificationBell.tsx) and /notifications
// show for each Notification.type: icon, a short Thai label, and the page the
// notification opens. relatedId is a meeting id or a task id depending on the
// type. Every type is written by the database triggers of
// 20261012090000_in_app_notifications_for_all_events except AI_SUMMARY_READY
// (POST /api/meetings/[id]/ai-summary).

export type NotificationType =
  | "MEETING_INVITE"
  | "MEETING_UPDATED"
  | "MEETING_CANCELLED"
  | "MEETING_REMOVED"
  | "MEETING_NOTE"
  | "TASK_ASSIGNED"
  | "TASK_UPDATED"
  | "TASK_COMMENT"
  | "AI_SUMMARY_READY"
  | "REMINDER";

export interface NotificationRow {
  id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  isRead: boolean;
  relatedId: string | null;
  createdAt: string;
}

const meeting = (id: string) => `/meetings/${id}`;
const task = (id: string) => `/tasks/${id}`;

export const NOTIFICATION_TYPE_META: Record<NotificationType, { icon: string; label: string; href: (id: string) => string }> = {
  MEETING_INVITE: { icon: "event", label: "คำเชิญ", href: meeting },
  MEETING_UPDATED: { icon: "edit_calendar", label: "ประชุมเปลี่ยนแปลง", href: meeting },
  MEETING_CANCELLED: { icon: "event_busy", label: "ยกเลิกประชุม", href: meeting },
  MEETING_REMOVED: { icon: "person_remove", label: "นำออกจากประชุม", href: meeting },
  MEETING_NOTE: { icon: "description", label: "บันทึก/มติ", href: meeting },
  TASK_ASSIGNED: { icon: "task_alt", label: "งานใหม่", href: task },
  TASK_UPDATED: { icon: "assignment", label: "งานเปลี่ยนแปลง", href: task },
  TASK_COMMENT: { icon: "chat", label: "ความคิดเห็น", href: task },
  AI_SUMMARY_READY: { icon: "auto_awesome", label: "สรุปประชุม", href: meeting },
  REMINDER: { icon: "notifications_active", label: "เตือนประชุม", href: meeting },
};

/** Page a notification opens, or null when there is nothing to open (unknown type / no relatedId). */
export function notificationHref(n: Pick<NotificationRow, "type" | "relatedId">): string | null {
  const meta = NOTIFICATION_TYPE_META[n.type];
  return meta && n.relatedId ? meta.href(n.relatedId) : null;
}

// The bell and /notifications each keep their own copy of the unread count;
// whichever one marks something read announces it so the other re-reads.
const NOTIFICATIONS_CHANGED_EVENT = "smartmeeting:notifications-changed";
type NotificationsSource = "bell" | "page";

export function announceNotificationsChanged(source: NotificationsSource): void {
  window.dispatchEvent(new CustomEvent(NOTIFICATIONS_CHANGED_EVENT, { detail: source }));
}

/** Calls onChange when the *other* component marked something read; returns the unsubscribe. */
export function onNotificationsChanged(self: NotificationsSource, onChange: () => void): () => void {
  const listener = (e: Event) => {
    if ((e as CustomEvent<NotificationsSource>).detail !== self) onChange();
  };
  window.addEventListener(NOTIFICATIONS_CHANGED_EVENT, listener);
  return () => window.removeEventListener(NOTIFICATIONS_CHANGED_EVENT, listener);
}
