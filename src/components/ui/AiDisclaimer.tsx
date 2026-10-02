// FR-13 AC4: every place that shows AI-generated text carries this notice.
export function AiDisclaimer({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center justify-center gap-2 text-on-surface-variant ${className}`}>
      <span className="material-symbols-outlined text-[16px]">info</span>
      <span className="font-label-md text-label-md">สร้างโดย AI — โปรดตรวจสอบความถูกต้องก่อนใช้งาน</span>
    </div>
  );
}
