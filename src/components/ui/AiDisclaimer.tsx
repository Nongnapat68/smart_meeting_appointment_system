// FR-13 AC4: every place that shows AI-generated text carries this notice.
// `sample`: the text came from sample mode (no API key — assembled from
// stored data by templates), so it gets the same notice without claiming
// the text was written by AI.
export function AiDisclaimer({ className = "", sample = false }: { className?: string; sample?: boolean }) {
  return (
    <div className={`flex items-center justify-center gap-2 text-on-surface-variant ${className}`}>
      <span className="material-symbols-outlined text-[16px]">info</span>
      <span className="font-label-md text-label-md">
        {sample ? "สร้างโดยระบบ" : "สร้างโดย AI"} — โปรดตรวจสอบความถูกต้องก่อนใช้งาน
      </span>
    </div>
  );
}
