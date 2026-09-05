"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api-client";

export default function LogoutPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function confirmLogout() {
    setLoading(true);
    try {
      await api.post("/api/auth/logout");
    } finally {
      router.push("/login");
      router.refresh();
    }
  }

  return (
    <div className="bg-background font-body-md text-on-background h-screen flex items-center justify-center p-4">
      <div
        className="bg-surface-container-lowest rounded-xl shadow-[0_4px_15px_rgba(0,0,0,0.05)] w-full max-w-[400px] flex flex-col p-6 gap-6"
        role="dialog"
        aria-modal="true"
      >
        <div className="flex justify-center w-full">
          <div className="w-12 h-12 rounded-full bg-error-container flex items-center justify-center">
            <span className="material-symbols-outlined icon-fill text-error">logout</span>
          </div>
        </div>
        <div className="text-center flex flex-col gap-2">
          <h2 className="font-headline-md text-headline-md text-on-surface">ยืนยันการออกจากระบบ</h2>
          <p className="font-body-md text-body-md text-on-surface-variant">คุณต้องการออกจากระบบใช่หรือไม่?</p>
        </div>
        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            className="px-4 py-2.5 rounded-full border border-outline text-on-surface font-label-md text-label-md hover:bg-surface-container-low transition-colors w-full sm:w-auto"
            onClick={() => router.back()}
            type="button"
          >
            ยกเลิก
          </button>
          <button
            className="px-4 py-2.5 rounded-full bg-error text-on-error font-label-md text-label-md hover:opacity-90 shadow-sm transition-colors w-full sm:w-auto disabled:opacity-60"
            onClick={confirmLogout}
            disabled={loading}
            type="button"
          >
            {loading ? "กำลังออกจากระบบ..." : "ออกจากระบบ"}
          </button>
        </div>
      </div>
    </div>
  );
}
