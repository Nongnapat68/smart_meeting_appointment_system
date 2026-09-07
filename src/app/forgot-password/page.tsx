"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api-client";

type Step = "email" | "otp" | "reset" | "success";

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [otpDigits, setOtpDigits] = useState(["", "", "", "", "", ""]);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [countdown, setCountdown] = useState(59);
  const inputsRef = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (step !== "otp" || countdown <= 0) return;
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [step, countdown]);

  async function submitEmail(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api.post("/api/auth/forgot-password", { email });
      setStep("otp");
      setCountdown(59);
      setTimeout(() => inputsRef.current[0]?.focus(), 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "ส่งรหัสยืนยันไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }

  async function resendOtp() {
    setError(null);
    try {
      await api.post("/api/auth/forgot-password", { email });
      setCountdown(59);
    } catch (err) {
      setError(err instanceof Error ? err.message : "ส่งรหัสยืนยันไม่สำเร็จ");
    }
  }

  function handleOtpChange(idx: number, value: string) {
    const digit = value.replace(/[^0-9]/g, "").slice(-1);
    const next = [...otpDigits];
    next[idx] = digit;
    setOtpDigits(next);
    if (digit && idx < 5) inputsRef.current[idx + 1]?.focus();
  }

  function handleOtpKeyDown(idx: number, e: React.KeyboardEvent) {
    if (e.key === "Backspace" && !otpDigits[idx] && idx > 0) {
      inputsRef.current[idx - 1]?.focus();
    }
  }

  async function verifyOtp() {
    setError(null);
    const code = otpDigits.join("");
    if (code.length !== 6) {
      setError("รหัส OTP ไม่ถูกต้อง กรุณาลองใหม่");
      return;
    }
    setLoading(true);
    try {
      await api.post("/api/auth/verify-otp", { email, otp: code });
      setStep("reset");
    } catch (err) {
      setError(err instanceof Error ? err.message : "รหัส OTP ไม่ถูกต้อง กรุณาลองใหม่");
    } finally {
      setLoading(false);
    }
  }

  async function submitNewPassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api.post("/api/auth/reset-password", {
        email,
        otp: otpDigits.join(""),
        password: newPassword,
        confirmPassword,
      });
      setStep("success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "รหัสผ่านไม่ตรงกัน หรือไม่ตรงตามเงื่อนไข");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-gutter bg-background">
      {step === "email" && (
        <div className="w-full max-w-md bg-surface-container-lowest rounded-xl shadow-sm p-8 sm:p-10 relative overflow-hidden ring-1 ring-outline-variant/30">
          <div className="flex flex-col items-center mb-8">
            <div className="w-12 h-12 bg-primary rounded-lg flex items-center justify-center mb-4 shadow-sm">
              <span className="material-symbols-outlined text-on-primary text-[28px]">calendar_month</span>
            </div>
            <h1 className="font-headline-lg text-headline-lg text-primary mb-2">Smart Meeting</h1>
            <p className="font-body-md text-body-md text-on-surface-variant text-center mt-2">Meeting & Appointment System</p>
          </div>
          <div className="text-center mb-8">
            <h2 className="font-headline-md text-headline-md text-on-surface mb-3">ลืมรหัสผ่าน?</h2>
            <p className="font-body-md text-body-md text-on-surface-variant">
              กรุณากรอกอีเมลของคุณเพื่อรับรหัสยืนยันสำหรับรีเซ็ตรหัสผ่าน
            </p>
          </div>
          {error && (
            <div className="mb-4 rounded-lg bg-error-container/50 text-on-error-container font-body-md text-body-md px-4 py-3">
              {error}
            </div>
          )}
          <form onSubmit={submitEmail} className="flex flex-col gap-stack-gap">
            <div className="relative">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline text-[20px]">
                mail
              </span>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="อีเมลของคุณ"
                className="block w-full pl-10 pr-3 py-3 border border-outline-variant rounded-lg bg-surface-bright text-on-surface focus:ring-2 focus:ring-primary focus:border-primary transition-all font-body-md text-body-md"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full mt-4 bg-primary text-on-primary font-label-md text-label-md py-3 px-4 rounded-lg shadow-sm transition-all active:scale-[0.98] flex items-center justify-center gap-2 disabled:opacity-60"
            >
              <span>{loading ? "กำลังส่ง..." : "ส่งรหัสยืนยัน (OTP)"}</span>
            </button>
          </form>
          <div className="mt-8 text-center">
            <a
              className="inline-flex items-center gap-2 font-label-md text-label-md text-on-surface-variant hover:text-primary transition-colors"
              href="/login"
            >
              <span className="material-symbols-outlined text-[16px]">arrow_back</span>
              <span>กลับไปหน้าเข้าสู่ระบบ</span>
            </a>
          </div>
        </div>
      )}

      {step === "otp" && (
        <div className="bg-surface-container-lowest rounded-xl shadow-[0_4px_15px_rgba(0,0,0,0.05)] w-full max-w-[420px] flex flex-col p-8 gap-6">
          <div className="flex justify-center w-full">
            <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
              <span className="material-symbols-outlined text-primary text-[28px]">mark_email_read</span>
            </div>
          </div>
          <div className="text-center flex flex-col gap-2">
            <h2 className="font-headline-md text-headline-md text-on-surface">ยืนยันรหัส OTP</h2>
            <p className="font-body-md text-body-md text-on-surface-variant">
              เราได้ส่งรหัส 6 หลักไปยังอีเมล
              <br />
              <span className="text-on-surface font-medium">{email}</span>
            </p>
          </div>
          <div className="flex justify-center gap-2">
            {otpDigits.map((digit, idx) => (
              <input
                key={idx}
                ref={(el) => {
                  inputsRef.current[idx] = el;
                }}
                value={digit}
                onChange={(e) => handleOtpChange(idx, e.target.value)}
                onKeyDown={(e) => handleOtpKeyDown(idx, e)}
                inputMode="numeric"
                maxLength={1}
                className="w-11 h-12 text-center text-xl font-bold border border-outline-variant rounded-lg bg-surface-bright text-on-surface focus:ring-2 focus:ring-primary focus:border-primary transition-all"
              />
            ))}
          </div>
          {error && (
            <p className="text-center font-label-md text-label-md text-error">{error}</p>
          )}
          <div className="text-center">
            {countdown > 0 ? (
              <span className="font-label-md text-label-md text-on-surface-variant">
                ส่งรหัสอีกครั้งใน 00:{String(countdown).padStart(2, "0")}
              </span>
            ) : (
              <button
                type="button"
                onClick={resendOtp}
                className="font-label-md text-label-md text-primary hover:underline"
              >
                ส่งรหัสอีกครั้ง
              </button>
            )}
          </div>
          <div className="flex flex-col gap-3">
            <button
              type="button"
              onClick={verifyOtp}
              disabled={loading}
              className="w-full bg-primary hover:opacity-90 text-on-primary font-label-md text-label-md py-3 px-4 rounded-lg shadow-sm transition-all active:scale-[0.98] disabled:opacity-60"
            >
              {loading ? "กำลังตรวจสอบ..." : "ยืนยัน"}
            </button>
            <button
              type="button"
              onClick={() => setStep("email")}
              className="w-full text-on-surface-variant font-label-md text-label-md py-2 hover:text-primary transition-colors"
            >
              กลับไปแก้ไขอีเมล
            </button>
          </div>
        </div>
      )}

      {step === "reset" && (
        <div className="bg-surface-container-lowest rounded-xl shadow-[0_4px_15px_rgba(0,0,0,0.05)] w-full max-w-[420px] flex flex-col p-8 gap-6">
          <div className="flex justify-center w-full">
            <div className="w-14 h-14 rounded-full bg-secondary-container/40 flex items-center justify-center">
              <span className="material-symbols-outlined text-secondary text-[28px]">lock_reset</span>
            </div>
          </div>
          <div className="text-center flex flex-col gap-2">
            <h2 className="font-headline-md text-headline-md text-on-surface">ตั้งรหัสผ่านใหม่</h2>
            <p className="font-body-md text-body-md text-on-surface-variant">กรุณากรอกรหัสผ่านใหม่ของคุณ</p>
          </div>
          <form onSubmit={submitNewPassword} className="flex flex-col gap-4">
            <div className="space-y-1">
              <label className="font-label-md text-label-md text-on-surface-variant block text-left">
                รหัสผ่านใหม่
              </label>
              <input
                type="password"
                required
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="อย่างน้อย 8 ตัวอักษร"
                className="w-full px-4 py-2.5 bg-surface-bright border border-outline-variant rounded-lg font-body-md text-body-md text-on-surface focus:border-primary focus:ring-1 focus:ring-primary transition-all outline-none"
              />
            </div>
            <div className="space-y-1">
              <label className="font-label-md text-label-md text-on-surface-variant block text-left">
                ยืนยันรหัสผ่านใหม่
              </label>
              <input
                type="password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="กรอกรหัสผ่านใหม่อีกครั้ง"
                className="w-full px-4 py-2.5 bg-surface-bright border border-outline-variant rounded-lg font-body-md text-body-md text-on-surface focus:border-primary focus:ring-1 focus:ring-primary transition-all outline-none"
              />
            </div>
            <p className="font-label-md text-label-md text-on-surface-variant text-left">
              รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร ประกอบด้วยตัวเลขและตัวพิมพ์ใหญ่
            </p>
            {error && <p className="text-left font-label-md text-label-md text-error">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-primary hover:opacity-90 text-on-primary font-label-md text-label-md py-3 px-4 rounded-lg shadow-sm transition-all active:scale-[0.98] mt-2 disabled:opacity-60"
            >
              {loading ? "กำลังบันทึก..." : "บันทึกรหัสผ่านใหม่"}
            </button>
          </form>
        </div>
      )}

      {step === "success" && (
        <div className="bg-surface-container-lowest rounded-xl shadow-[0_4px_15px_rgba(0,0,0,0.05)] w-full max-w-[400px] flex flex-col items-center p-8 gap-4 text-center">
          <div className="w-14 h-14 rounded-full bg-secondary-container/40 flex items-center justify-center">
            <span className="material-symbols-outlined text-secondary text-[28px]">check_circle</span>
          </div>
          <h2 className="font-headline-md text-headline-md text-on-surface">เปลี่ยนรหัสผ่านสำเร็จ</h2>
          <p className="font-body-md text-body-md text-on-surface-variant">
            คุณสามารถเข้าสู่ระบบด้วยรหัสผ่านใหม่ได้ทันที
          </p>
          <button
            type="button"
            onClick={() => router.push("/login")}
            className="w-full bg-primary hover:opacity-90 text-on-primary font-label-md text-label-md py-3 px-4 rounded-lg shadow-sm transition-all active:scale-[0.98] mt-2"
          >
            ไปหน้าเข้าสู่ระบบ
          </button>
        </div>
      )}
    </div>
  );
}
