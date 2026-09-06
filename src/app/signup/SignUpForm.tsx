"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api-client";

export function SignUpForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api.post("/api/auth/signup", { name, email, password, confirmPassword });
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "สมัครสมาชิกไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="w-full flex flex-col gap-stack-gap">
      {error && <div className="rounded-lg bg-error-container/50 text-on-error-container font-body-md px-4 py-3">{error}</div>}
      <Field label="ชื่อ-นามสกุล" icon="person">
        <input required autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="ชื่อ-นามสกุล" className="w-full pl-10 pr-4 py-3 bg-surface border border-outline-variant rounded-lg font-body-md text-body-md text-on-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary" />
      </Field>
      <Field label="อีเมล" icon="mail">
        <input required type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" className="w-full pl-10 pr-4 py-3 bg-surface border border-outline-variant rounded-lg font-body-md text-body-md text-on-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary" />
      </Field>
      <Field label="รหัสผ่าน" icon="lock">
        <input required type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="อย่างน้อย 8 ตัว (อังกฤษและตัวเลข)" className="w-full pl-10 pr-4 py-3 bg-surface border border-outline-variant rounded-lg font-body-md text-body-md text-on-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary" />
      </Field>
      <Field label="ยืนยันรหัสผ่าน" icon="lock">
        <input required type="password" autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="กรอกรหัสผ่านอีกครั้ง" className="w-full pl-10 pr-4 py-3 bg-surface border border-outline-variant rounded-lg font-body-md text-body-md text-on-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary" />
      </Field>
      <button type="submit" disabled={loading} className="w-full mt-2 bg-primary text-on-primary font-body-lg font-medium py-3 rounded-lg hover:opacity-90 disabled:opacity-60">
        {loading ? "กำลังสร้างบัญชี..." : "สร้างบัญชี"}
      </button>
      <p className="text-center font-body-md text-body-md text-on-surface-variant">
        มีบัญชีอยู่แล้ว? <a className="font-label-md text-primary hover:underline" href="/login">เข้าสู่ระบบ</a>
      </p>
    </form>
  );
}

function Field({ label, icon, children }: { label: string; icon: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 font-label-md text-label-md text-on-surface">
      {label}
      <span className="relative">
        <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-xl pointer-events-none">{icon}</span>
        {children}
      </span>
    </label>
  );
}
