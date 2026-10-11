import type { ReactNode } from "react";
import { reminderAutoProcessIntervalSeconds } from "@/lib/reminder-auto-processor";

// Tells everyone on /reminders how due reminders get processed, so a row
// reading "เลยกำหนด — รอระบบประมวลผล" isn't mistaken for a bug. Read on the
// server (page.tsx is a client component); only on/off and the interval are
// shown. Same opt-in rule as src/instrumentation.ts.
export default function RemindersLayout({ children }: { children: ReactNode }) {
  const auto = process.env.REMINDER_AUTO_PROCESS?.trim() === "1";
  const seconds = reminderAutoProcessIntervalSeconds(process.env.REMINDER_AUTO_PROCESS_INTERVAL_SECONDS);
  return (
    <>
      <div className="max-w-7xl mx-auto px-container-margin pt-container-margin">
        <p
          role="status"
          className="flex items-start gap-2 rounded-lg border border-outline-variant bg-surface-container-low px-4 py-3 font-body-md text-body-md text-on-surface-variant"
        >
          <span className="material-symbols-outlined text-[20px] text-primary">{auto ? "autorenew" : "touch_app"}</span>
          {auto
            ? `ระบบประมวลผลการแจ้งเตือนที่ถึงเวลาโดยอัตโนมัติทุก ${seconds} วินาที — รายการที่ขึ้น "เลยกำหนด — รอระบบประมวลผล" จะถูกประมวลผลในรอบถัดไป`
            : `ระบบยังไม่ได้เปิดการประมวลผลอัตโนมัติ การแจ้งเตือนที่ถึงเวลาจะถูกส่งเมื่อผู้ดูแลระบบกด "ประมวลผล reminder ที่ถึงเวลา" เท่านั้น — รายการที่ขึ้น "เลยกำหนด — รอระบบประมวลผล" จึงไม่ใช่ข้อผิดพลาด`}
        </p>
      </div>
      {children}
    </>
  );
}
