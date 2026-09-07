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
    <header className="h-16 fixed top-0 right-0 w-full md:w-[calc(100%-260px)] bg-surface flex items-center justify-between px-gutter z-40 border-b border-outline-variant">
      <div className="flex items-center flex-1 max-w-xl">
        <div className="relative w-full hidden sm:block">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-[20px]">
            search
          </span>
          <input
            className="w-full pl-10 pr-4 py-2 bg-surface-container-low border-none rounded-full font-body-md text-body-md text-on-surface focus:ring-2 focus:ring-primary focus:bg-surface transition-all outline-none"
            placeholder="ค้นหา... (ใช้ตัวกรองในแต่ละหน้า)"
            type="text"
            disabled
            title="ใช้ช่องค้นหาในแต่ละหน้าเพื่อกรองข้อมูลของหน้านั้นๆ"
          />
        </div>
      </div>
      <div className="flex items-center gap-2 md:gap-4 ml-4">
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
