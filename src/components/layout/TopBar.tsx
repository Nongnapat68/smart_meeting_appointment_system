import Link from "next/link";
import { Avatar } from "@/components/ui/Avatar";
import { NotificationBell } from "@/components/layout/NotificationBell";

export function TopBar({
  userName,
  avatarUrl,
  unreadCount = 0,
}: {
  userName: string;
  avatarUrl?: string | null;
  unreadCount?: number;
}) {
  return (
    <header className="h-16 fixed top-0 right-0 w-full md:w-[calc(100%-260px)] bg-surface flex items-center justify-end px-gutter z-40 border-b border-outline-variant">
      <div className="flex items-center gap-2 md:gap-4">
        <Link
          href="/ai-assistant"
          className="w-10 h-10 rounded-full flex items-center justify-center text-primary hover:bg-surface-container-low transition-all active:opacity-80"
          title="ตัวช่วย AI"
        >
          <span className="material-symbols-outlined icon-fill">auto_awesome</span>
        </Link>
        <NotificationBell initialUnreadCount={unreadCount} />
        <Link href="/settings" className="ml-1" title="ตั้งค่าบัญชี">
          <Avatar name={userName} src={avatarUrl} size={36} className="hover:ring-2 ring-primary transition-all" />
        </Link>
      </div>
    </header>
  );
}
