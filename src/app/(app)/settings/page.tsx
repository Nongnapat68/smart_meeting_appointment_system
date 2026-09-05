"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api-client";
import { useToast } from "@/components/ui/Toast";
import { Avatar } from "@/components/ui/Avatar";
import { ErrorBanner, FullPageSpinner } from "@/components/ui/Feedback";

interface MeUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  phone: string | null;
  title: string | null;
  department: string | null;
  emailNotifications: boolean;
  inAppNotifications: boolean;
}

export default function SettingsPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [user, setUser] = useState<MeUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [title, setTitle] = useState("");
  const [department, setDepartment] = useState("");
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [inAppNotifications, setInAppNotifications] = useState(true);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [changingPassword, setChangingPassword] = useState(false);

  useEffect(() => {
    api
      .get<{ user: MeUser | null }>("/api/auth/me")
      .then((res) => {
        if (!res.user) return;
        setUser(res.user);
        setName(res.user.name);
        setPhone(res.user.phone ?? "");
        setTitle(res.user.title ?? "");
        setDepartment(res.user.department ?? "");
        setEmailNotifications(res.user.emailNotifications);
        setInAppNotifications(res.user.inAppNotifications);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "โหลดข้อมูลไม่สำเร็จ"))
      .finally(() => setLoading(false));
  }, []);

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.patch("/api/users/me", { name, phone, title, department, emailNotifications, inAppNotifications });
      showToast("บันทึกการเปลี่ยนแปลงสำเร็จ", "success");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  }

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    setUploadingAvatar(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await api.post<{ avatarUrl: string }>("/api/users/me/avatar", formData);
      setUser({ ...user, avatarUrl: res.avatarUrl });
      showToast("เปลี่ยนรูปโปรไฟล์สำเร็จ", "success");
      router.refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "เปลี่ยนรูปไม่สำเร็จ", "error");
    } finally {
      setUploadingAvatar(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setPasswordError(null);
    setChangingPassword(true);
    try {
      await api.post("/api/users/me/password", { currentPassword, newPassword, confirmPassword });
      showToast("เปลี่ยนรหัสผ่านสำเร็จ", "success");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : "เปลี่ยนรหัสผ่านไม่สำเร็จ");
    } finally {
      setChangingPassword(false);
    }
  }

  if (loading) return <FullPageSpinner />;
  if (!user) return <div className="p-container-margin"><ErrorBanner message={error ?? "ไม่พบข้อมูลผู้ใช้"} /></div>;

  return (
    <div className="p-container-margin max-w-4xl mx-auto">
      <h2 className="font-headline-lg text-headline-lg text-on-surface mb-8">ตั้งค่าบัญชีผู้ใช้ (Settings &amp; Profile)</h2>

      <div className="grid grid-cols-1 gap-8">
        {error && <ErrorBanner message={error} />}

        <form onSubmit={handleSaveProfile} className="bg-surface-container-lowest rounded-xl p-card-padding shadow-sm border border-outline-variant/20 flex flex-col md:flex-row items-center md:items-start gap-8">
          <div className="flex flex-col items-center gap-4">
            <div className="relative w-32 h-32 rounded-full overflow-hidden border-4 border-surface shadow-sm group">
              <Avatar name={user.name} src={user.avatarUrl} size={128} />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <span className="material-symbols-outlined text-white">photo_camera</span>
              </button>
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
            </div>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingAvatar}
              className="px-4 py-2 bg-surface-container-low hover:bg-surface-container-high text-on-surface-variant rounded-full font-label-md text-label-md transition-colors border border-outline-variant/50 disabled:opacity-60"
            >
              {uploadingAvatar ? "กำลังอัปโหลด..." : "เปลี่ยนรูปโปรไฟล์"}
            </button>
          </div>

          <div className="flex-1 w-full space-y-6">
            <div>
              <h3 className="font-headline-md text-headline-md text-on-surface mb-4">ข้อมูลส่วนตัว</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <SettingField label="ชื่อ - นามสกุล" value={name} onChange={setName} />
                <SettingField label="อีเมล" value={user.email} onChange={() => {}} disabled type="email" />
                <SettingField label="เบอร์โทรศัพท์" value={phone} onChange={setPhone} />
                <SettingField label="ตำแหน่ง" value={title} onChange={setTitle} />
                <div className="md:col-span-2">
                  <SettingField label="แผนก" value={department} onChange={setDepartment} />
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <ToggleRow
                title="การแจ้งเตือนผ่านอีเมล (Email Notifications)"
                description="รับการแจ้งเตือนเมื่อมีการเชิญประชุม หรืออัปเดตตารางงาน"
                checked={emailNotifications}
                onChange={setEmailNotifications}
              />
              <ToggleRow
                title="การแจ้งเตือนในระบบ (In-app Notifications)"
                description="แสดงการแจ้งเตือนป๊อปอัปเมื่อใช้งานแอปพลิเคชัน"
                checked={inAppNotifications}
                onChange={setInAppNotifications}
              />
            </div>

            <div className="flex items-center justify-between pt-4">
              <a
                href="/logout"
                className="flex items-center gap-2 px-6 py-2.5 rounded-lg border border-error/50 text-error hover:bg-error/10 transition-colors font-label-md text-label-md"
              >
                <span className="material-symbols-outlined text-[20px]">logout</span>
                ออกจากระบบ
              </a>
              <button
                type="submit"
                disabled={saving}
                className="flex items-center gap-2 px-8 py-3 bg-primary text-on-primary rounded-lg shadow-sm hover:opacity-90 transition-colors font-label-md text-label-md font-bold disabled:opacity-60"
              >
                <span className="material-symbols-outlined text-[20px]">save</span>
                {saving ? "กำลังบันทึก..." : "บันทึกการเปลี่ยนแปลง"}
              </button>
            </div>
          </div>
        </form>

        <form onSubmit={handleChangePassword} className="bg-surface-container-lowest rounded-xl p-card-padding shadow-sm border border-outline-variant/20">
          <h3 className="font-headline-md text-headline-md text-on-surface mb-6 flex items-center gap-2">
            <span className="material-symbols-outlined text-primary">lock</span>
            เปลี่ยนรหัสผ่าน
          </h3>
          {passwordError && <ErrorBanner message={passwordError} />}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl mt-4">
            <div className="md:col-span-2">
              <SettingField
                label="รหัสผ่านปัจจุบัน"
                value={currentPassword}
                onChange={setCurrentPassword}
                type="password"
                placeholder="••••••••"
              />
            </div>
            <SettingField label="รหัสผ่านใหม่" value={newPassword} onChange={setNewPassword} type="password" placeholder="ตั้งรหัสผ่านใหม่" />
            <SettingField
              label="ยืนยันรหัสผ่านใหม่"
              value={confirmPassword}
              onChange={setConfirmPassword}
              type="password"
              placeholder="กรอกรหัสผ่านใหม่อีกครั้ง"
            />
          </div>
          <div className="flex justify-end mt-4">
            <button
              type="submit"
              disabled={changingPassword}
              className="px-6 py-2.5 bg-primary text-on-primary rounded-lg font-label-md text-label-md hover:opacity-90 transition-colors disabled:opacity-60"
            >
              {changingPassword ? "กำลังเปลี่ยน..." : "เปลี่ยนรหัสผ่าน"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function SettingField({
  label,
  value,
  onChange,
  type = "text",
  disabled = false,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  disabled?: boolean;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1">
      <label className="font-label-md text-label-md text-on-surface-variant block">{label}</label>
      <input
        type={type}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-4 py-2.5 bg-surface-container-low border border-outline-variant/30 rounded-lg font-body-md text-body-md text-on-surface focus:border-primary focus:ring-1 focus:ring-primary transition-all outline-none disabled:opacity-60"
      />
    </div>
  );
}

function ToggleRow({
  title,
  description,
  checked,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <h4 className="font-body-lg text-body-lg text-on-surface font-medium">{title}</h4>
        <p className="font-body-md text-body-md text-on-surface-variant mt-1">{description}</p>
      </div>
      <label className="relative inline-flex items-center cursor-pointer">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="sr-only peer" />
        <div className="w-11 h-6 bg-surface-variant peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary" />
      </label>
    </div>
  );
}
