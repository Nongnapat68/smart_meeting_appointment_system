"use client";

import { useEffect, useRef, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { formatDate } from "@/lib/format";

const ROW_HEIGHT = 36;
const VISIBLE_ROWS = 5;
const CENTER_IDX = Math.floor(VISIBLE_ROWS / 2);
const DATE_CARD_COUNT = 14;

const WEEKDAY_FMT = new Intl.DateTimeFormat("en-US", { weekday: "short" });
const THAI_WEEKDAYS = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];

const pad = (n: number) => String(n).padStart(2, "0");

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function keyToParts(key: string): { y: number; m: number; d: number } {
  const [y, m, d] = key.split("-").map(Number);
  return { y, m, d };
}

function buildLocal(key: string, hour: number, minute: number): string {
  const { y, m, d } = keyToParts(key);
  return `${y}-${pad(m)}-${pad(d)}T${pad(hour)}:${pad(minute)}`;
}

function parseLocal(v: string): { key: string; hour: number; minute: number } | null {
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!m) return null;
  return { key: `${m[1]}-${m[2]}-${m[3]}`, hour: Number(m[4]), minute: Number(m[5]) };
}

function monthTitle(d: Date): string {
  return d.toLocaleDateString("th-TH", { month: "long", year: "numeric" });
}

export function DateTimeField({
  label,
  value,
  onChange,
  minDateKey,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  minDateKey?: string;
}) {
  const [showCalendar, setShowCalendar] = useState(false);
  const todayKey = dateKey(new Date());
  const effectiveMinKey = minDateKey && minDateKey > todayKey ? minDateKey : todayKey;
  const parsed = parseLocal(value) ?? { key: todayKey, hour: 9, minute: 0 };

  const days = Array.from({ length: DATE_CARD_COUNT }, (_, i) => {
    const { y, m, d } = keyToParts(effectiveMinKey);
    return new Date(y, m - 1, d + i);
  });

  function setDate(key: string) {
    onChange(buildLocal(key, parsed.hour, parsed.minute));
  }

  function setHour(hour: number) {
    onChange(buildLocal(parsed.key, hour, parsed.minute));
  }

  function setMinute(minute: number) {
    onChange(buildLocal(parsed.key, parsed.hour, minute));
  }

  const { y: selY, m: selM, d: selD } = keyToParts(parsed.key);
  const selectedDate = new Date(selY, selM - 1, selD);

  return (
    <div>
      <span className="block font-label-md text-label-md text-on-surface-variant mb-2">{label}</span>

      <div className="flex items-start gap-2">
        <div className="flex-1 flex gap-2 overflow-x-auto pb-1 -mb-1">
          {days.map((d) => {
            const key = dateKey(d);
            const disabled = key < todayKey;
            const selected = key === parsed.key;
            return (
              <button
                key={key}
                type="button"
                disabled={disabled}
                onClick={() => setDate(key)}
                className={`flex flex-col items-center justify-center shrink-0 rounded-xl border min-w-[60px] px-2 py-2 transition-all ${
                  disabled
                    ? "opacity-40 cursor-not-allowed bg-surface-container-low border-outline-variant text-on-surface-variant"
                    : selected
                      ? "bg-primary border-primary text-on-primary shadow-sm"
                      : "bg-surface-container-lowest border-outline-variant text-on-surface hover:border-primary hover:bg-primary-container/10"
                }`}
              >
                <span className="font-label-md text-label-md">{WEEKDAY_FMT.format(d)}</span>
                <span className="font-headline-md text-headline-md font-bold leading-tight">{d.getDate()}</span>
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => setShowCalendar(true)}
          className="shrink-0 flex flex-col items-center justify-center gap-0.5 min-w-[52px] px-2 py-2 rounded-xl border border-outline-variant text-primary hover:bg-primary-container/10 transition-colors"
        >
          <span className="material-symbols-outlined text-[20px]">calendar_month</span>
          <span className="font-label-md text-label-md">ดูปฏิทิน</span>
        </button>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 mt-2">
        <p className="font-body-md text-body-md text-on-surface-variant">{formatDate(selectedDate)}</p>
        <div className="flex items-center gap-3">
          <WheelPicker label="ชั่วโมง" value={parsed.hour} min={0} max={23} onChange={setHour} />
          <WheelPicker label="นาที" value={parsed.minute} min={0} max={59} onChange={setMinute} />
        </div>
      </div>

      <CalendarModal
        open={showCalendar}
        initialKey={parsed.key}
        minKey={todayKey}
        onSelect={setDate}
        onClose={() => setShowCalendar(false)}
      />
    </div>
  );
}

function WheelPicker({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  const values: number[] = [];
  for (let v = min; v <= max; v += 1) values.push(v);
  const ref = useRef<HTMLDivElement>(null);
  const idx = values.indexOf(value);
  const effectiveIdx = idx === -1 ? 0 : idx;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const current = Math.round(el.scrollTop / ROW_HEIGHT);
    if (current !== effectiveIdx) el.scrollTop = effectiveIdx * ROW_HEIGHT;
  }, [effectiveIdx]);

  function onScroll() {
    const el = ref.current;
    if (!el) return;
    const i = Math.round(el.scrollTop / ROW_HEIGHT);
    const clamped = Math.min(Math.max(i, 0), values.length - 1);
    const v = values[clamped];
    if (v !== undefined && v !== value) onChange(v);
  }

  return (
    <div className="flex flex-col items-center">
      <span className="font-label-md text-label-md text-on-surface-variant mb-1">{label}</span>
      <div className="relative" style={{ height: ROW_HEIGHT * VISIBLE_ROWS, width: 64 }}>
        <div
          className="absolute inset-x-0 rounded-full bg-primary-container/15 border-y border-outline-variant/60 pointer-events-none"
          style={{ top: CENTER_IDX * ROW_HEIGHT, height: ROW_HEIGHT }}
        />
        <div
          ref={ref}
          onScroll={onScroll}
          className="absolute inset-0 overflow-y-auto snap-y snap-mandatory [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          role="listbox"
          aria-label={label}
        >
          <div style={{ paddingTop: CENTER_IDX * ROW_HEIGHT, paddingBottom: CENTER_IDX * ROW_HEIGHT }}>
            {values.map((v) => (
              <div
                key={v}
                role="option"
                aria-selected={v === value}
                onClick={() => onChange(v)}
                className="snap-center flex items-center justify-center cursor-pointer"
                style={{ height: ROW_HEIGHT }}
              >
                <span
                  className={`font-headline-md leading-none transition-all ${
                    v === value ? "text-on-surface font-bold scale-110" : "text-on-surface-variant opacity-50"
                  }`}
                >
                  {pad(v)}
                </span>
              </div>
            ))}
          </div>
        </div>
        <div
          className="absolute inset-x-0 top-0 pointer-events-none bg-gradient-to-b from-surface-container-lowest to-transparent"
          style={{ height: CENTER_IDX * ROW_HEIGHT }}
        />
        <div
          className="absolute inset-x-0 bottom-0 pointer-events-none bg-gradient-to-t from-surface-container-lowest to-transparent"
          style={{ height: CENTER_IDX * ROW_HEIGHT }}
        />
      </div>
    </div>
  );
}

function CalendarModal({
  open,
  initialKey,
  minKey,
  onSelect,
  onClose,
}: {
  open: boolean;
  initialKey: string;
  minKey: string;
  onSelect: (key: string) => void;
  onClose: () => void;
}) {
  const { y: initY, m: initM } = keyToParts(initialKey);
  const [cursor, setCursor] = useState<{ y: number; m: number }>({ y: initY, m: initM });

  useEffect(() => {
    if (open) {
      const { y, m } = keyToParts(initialKey);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCursor({ y, m });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const firstWeekday = new Date(cursor.y, cursor.m - 1, 1).getDay();
  const daysInMonth = new Date(cursor.y, cursor.m, 0).getDate();
  const cells: (number | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  function move(delta: number) {
    const d = new Date(cursor.y, cursor.m - 1 + delta, 1);
    setCursor({ y: d.getFullYear(), m: d.getMonth() + 1 });
  }

  return (
    <Modal open={open} onClose={onClose} maxWidth="max-w-sm">
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => move(-1)} className="w-9 h-9 rounded-full hover:bg-surface-container-low flex items-center justify-center text-on-surface-variant" aria-label="เดือนก่อนหน้า">
          <span className="material-symbols-outlined">chevron_left</span>
        </button>
        <span className="font-headline-md text-headline-md text-on-surface">{monthTitle(new Date(cursor.y, cursor.m - 1, 1))}</span>
        <button type="button" onClick={() => move(1)} className="w-9 h-9 rounded-full hover:bg-surface-container-low flex items-center justify-center text-on-surface-variant" aria-label="เดือนถัดไป">
          <span className="material-symbols-outlined">chevron_right</span>
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center">
        {THAI_WEEKDAYS.map((w) => (
          <span key={w} className="font-label-md text-label-md text-on-surface-variant py-1">
            {w}
          </span>
        ))}
        {cells.map((day, i) => {
          if (day === null) return <span key={`empty-${i}`} />;
          const d = new Date(cursor.y, cursor.m - 1, day);
          const key = dateKey(d);
          const disabled = key < minKey;
          const selected = key === initialKey;
          return (
            <button
              key={key}
              type="button"
              disabled={disabled}
              onClick={() => {
                onSelect(key);
                onClose();
              }}
              className={`h-9 rounded-lg font-body-md text-body-md transition-colors ${
                disabled
                  ? "text-on-surface-variant opacity-35 cursor-not-allowed"
                  : selected
                    ? "bg-primary text-on-primary font-bold"
                    : key === dateKey(new Date())
                      ? "text-primary font-semibold ring-1 ring-primary"
                      : "text-on-surface hover:bg-primary-container/15"
              }`}
            >
              {day}
            </button>
          );
        })}
      </div>
    </Modal>
  );
}