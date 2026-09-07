"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/dashboard", icon: "home", label: "หน้าหลัก" },
  { href: "/people", icon: "person", label: "ผู้คน" },
  { href: "/groups", icon: "group", label: "กลุ่ม" },
  { href: "/meetings", icon: "calendar_month", label: "การประชุม" },
  { href: "/projects", icon: "assignment", label: "โปรเจกต์" },
  { href: "/tasks", icon: "task_alt", label: "งานของฉัน" },
  { href: "/reminders", icon: "notifications", label: "การแจ้งเตือน" },
];

const FOOTER_ITEMS = [
  { href: "/ai-assistant", icon: "auto_awesome", label: "ตัวช่วย AI" },
  { href: "/settings", icon: "settings", label: "ตั้งค่า" },
];

export function Sidebar() {
  const pathname = usePathname();

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");

  return (
    <aside className="w-sidebar-width h-screen fixed left-0 top-0 bg-surface shadow-sm flex flex-col border-r border-outline-variant z-50 hidden md:flex">
      <Link
        href="/dashboard"
        className="p-container-margin flex items-center gap-3 border-b border-outline-variant/50"
      >
        <div className="w-10 h-10 rounded-lg bg-primary-container flex items-center justify-center text-on-primary-container shrink-0">
          <span className="material-symbols-outlined icon-fill">meeting_room</span>
        </div>
        <div>
          <h1 className="font-headline-md text-headline-md font-bold text-primary leading-tight">
            Smart Meeting
          </h1>
          <p className="font-label-md text-label-md text-on-surface-variant">Meeting & Appointment System</p>
        </div>
      </Link>

      <div className="px-gutter pt-4 pb-2">
        <Link
          href="/meetings/new"
          className="w-full flex items-center justify-center gap-2 bg-primary text-on-primary py-3 rounded-lg font-body-md text-body-md font-semibold hover:opacity-90 active:scale-95 duration-200 transition-all shadow-sm"
        >
          <span className="material-symbols-outlined">add</span>
          นัดหมายใหม่
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto px-gutter py-2 flex flex-col gap-1">
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg font-body-md text-body-md transition-colors active:scale-95 duration-200 ${
              isActive(item.href)
                ? "bg-primary-container/10 text-primary font-bold"
                : "text-on-surface-variant hover:text-primary hover:bg-surface-container-high"
            }`}
          >
            <span className={`material-symbols-outlined ${isActive(item.href) ? "icon-fill" : ""}`}>
              {item.icon}
            </span>
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="mt-auto px-gutter py-4 border-t border-outline-variant flex flex-col gap-1">
        {FOOTER_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg font-body-md text-body-md transition-colors active:scale-95 duration-200 ${
              isActive(item.href)
                ? "bg-primary-container/10 text-primary font-bold"
                : "text-on-surface-variant hover:text-primary hover:bg-surface-container-high"
            }`}
          >
            <span className={`material-symbols-outlined ${isActive(item.href) ? "icon-fill" : ""}`}>
              {item.icon}
            </span>
            {item.label}
          </Link>
        ))}
      </div>
    </aside>
  );
}
