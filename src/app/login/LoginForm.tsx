"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api-client";

export function LoginForm({ nextUrl }: { nextUrl: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api.post("/api/auth/login", { email, password, remember });
      router.push(nextUrl);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "เข้าสู่ระบบไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="w-full flex flex-col gap-stack-gap">
      {error && (
        <div className="rounded-lg bg-error-container/50 text-on-error-container font-body-md text-body-md px-4 py-3">
          {error}
        </div>
      )}
      <div className="flex flex-col gap-1">
        <label className="font-label-md text-label-md text-on-surface" htmlFor="email">
          อีเมล (Email)
        </label>
        <div className="relative">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-xl pointer-events-none">
            mail
          </span>
          <input
            id="email"
            name="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@university.ac.th"
            className="w-full pl-10 pr-4 py-3 bg-surface border border-outline-variant rounded-lg font-body-md text-body-md text-on-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
          />
        </div>
      </div>
      <div className="flex flex-col gap-1 mt-2">
        <div className="flex items-center justify-between">
          <label className="font-label-md text-label-md text-on-surface" htmlFor="password">
            รหัสผ่าน (Password)
          </label>
          <a className="font-label-md text-label-md text-primary hover:underline" href="/forgot-password">
            ลืมรหัสผ่าน?
          </a>
        </div>
        <div className="relative">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-xl pointer-events-none">
            lock
          </span>
          <input
            id="password"
            name="password"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className="w-full pl-10 pr-4 py-3 bg-surface border border-outline-variant rounded-lg font-body-md text-body-md text-on-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
          />
        </div>
      </div>
      <div className="flex items-center mt-2 mb-4">
        <input
          id="remember"
          type="checkbox"
          checked={remember}
          onChange={(e) => setRemember(e.target.checked)}
          className="w-4 h-4 rounded border-outline-variant text-primary focus:ring-primary bg-surface"
        />
        <label className="ml-2 font-body-md text-body-md text-on-surface-variant" htmlFor="remember">
          จดจำการเข้าสู่ระบบ
        </label>
      </div>
      <button
        type="submit"
        disabled={loading}
        className="w-full bg-primary text-on-primary font-body-lg text-body-lg font-medium py-3 rounded-lg hover:opacity-90 active:scale-[0.98] transition-all shadow-sm disabled:opacity-60"
      >
        {loading ? "กำลังเข้าสู่ระบบ..." : "เข้าสู่ระบบ"}
      </button>
    </form>
  );
}
