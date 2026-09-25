"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { formatDate } from "@/lib/format";

const ROW_HEIGHT = 32;
const VISIBLE_ROWS = 3;
const CENTER_IDX = Math.floor(VISIBLE_ROWS / 2);
const POPUP_WIDTH = 304;
const POPUP_GAP = 8;
const WHEEL_ACTIVE_IDLE_MS = 700;

const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

// Monday-first, matching the จ–อา column order.
const THAI_WEEKDAYS = ["จ", "อ", "พ", "พฤ", "ศ", "ส", "อา"];

const pad = (n: number) => String(n).padStart(2, "0");

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function keyToParts(key: string): { y: number; m: number; d: number } {
  const [y, m, d] = key.split("-").map(Number);
  return { y, m, d };
}

function keyToDate(key: string): Date {
  const { y, m, d } = keyToParts(key);
  return new Date(y, m - 1, d);
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

interface Draft {
  key: string | null;
  hour: number;
  minute: number;
}

function draftFrom(value: string): Draft {
  const parsed = parseLocal(value);
  if (parsed) return parsed;
  const next = new Date();
  next.setMinutes(0, 0, 0);
  next.setHours(next.getHours() + 1);
  return { key: null, hour: next.getHours(), minute: 0 };
}

type Placement = "right" | "left" | "bottom";

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
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<Placement>("bottom");
  // Edits stay in this draft until "ตกลง"; outside click / Esc discard them.
  const [draft, setDraft] = useState<Draft>(() => draftFrom(value));
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const todayKey = dateKey(new Date());
  const effectiveMinKey = minDateKey && minDateKey > todayKey ? minDateKey : todayKey;
  const parsed = parseLocal(value);

  const close = useCallback(() => setOpen(false), []);

  function openPopup() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      const vw = window.innerWidth;
      if (rect.right + POPUP_GAP + POPUP_WIDTH <= vw - 16) setPlacement("right");
      else if (rect.left - POPUP_GAP - POPUP_WIDTH >= 16) setPlacement("left");
      else setPlacement("bottom");
    }
    setDraft(draftFrom(value));
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) close();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        close();
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  function confirm() {
    if (!draft.key) return;
    onChange(buildLocal(draft.key, draft.hour, draft.minute));
    close();
    triggerRef.current?.focus();
  }

  const popupPosition =
    placement === "right"
      ? "left-full top-0 ml-2"
      : placement === "left"
        ? "right-full top-0 mr-2"
        : "left-0 top-full mt-2";

  return (
    <div>
      <span className="block font-label-md text-label-md text-on-surface-variant mb-2">{label}</span>

      <div ref={wrapperRef} className="relative w-fit max-w-full">
        <button
          ref={triggerRef}
          type="button"
          onClick={() => (open ? close() : openPopup())}
          aria-haspopup="dialog"
          aria-expanded={open}
          className={`w-fit max-w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-left transition-colors ${
            parsed
              ? "border border-outline-variant bg-surface-container-lowest text-on-surface hover:border-primary"
              : "border border-outline-variant bg-surface-container-lowest text-on-surface-variant hover:border-primary"
          } ${open ? "border-primary ring-2 ring-primary/20" : ""}`}
        >
          <span className={`material-symbols-outlined shrink-0 text-[20px] ${parsed ? "text-primary" : "opacity-60"}`}>
            calendar_month
          </span>
          {parsed ? (
            <span className="font-body-md text-body-md font-semibold whitespace-nowrap truncate">
              {formatDate(keyToDate(parsed.key))} | {pad(parsed.hour)}:{pad(parsed.minute)} น.
            </span>
          ) : (
            <span className="font-body-md text-body-md opacity-60 whitespace-nowrap truncate">เลือกวันที่และเวลา</span>
          )}
        </button>

        {open && (
          <div
            role="dialog"
            aria-label={`เลือกวันที่และเวลา${label}`}
            className={`absolute z-40 ${popupPosition} bg-surface-container-lowest border border-outline-variant rounded-xl shadow-lg p-4`}
            style={{ width: POPUP_WIDTH, maxWidth: "calc(100vw - 32px)" }}
          >
            <MonthGrid selectedKey={draft.key} minKey={effectiveMinKey} todayKey={todayKey} onSelect={(key) => setDraft((d) => ({ ...d, key }))}
            />

            <div className="border-t border-outline-variant my-2" />

            <span className="block font-label-md text-label-md text-on-surface-variant">เวลา</span>
            <div className="flex items-center justify-center gap-1 mt-1">
              <WheelPicker label="ชั่วโมง" value={draft.hour} min={0} max={23} onChange={(hour) => setDraft((d) => ({ ...d, hour }))} />
              <span className="font-headline-lg text-headline-lg font-bold text-on-surface leading-none pb-1">:</span>
              <WheelPicker label="นาที" value={draft.minute} min={0} max={59} onChange={(minute) => setDraft((d) => ({ ...d, minute }))} />
            </div>

            <button
              type="button"
              onClick={confirm}
              disabled={!draft.key}
              className="mt-3 w-full py-2.5 rounded-lg bg-primary text-on-primary font-label-md text-label-md font-semibold hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {draft.key ? "ตกลง" : "เลือกวันที่ก่อน"}
            </button>
          </div>
        )}
      </div>
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
  const skipNextScrollRef = useRef(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Neighbors only show while the wheel is being used (hover, focus, drag or
  // scroll); at rest only the selected value is visible.
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [scrolling, setScrolling] = useState(false);
  const active = hovered || focused || scrolling;
  const idx = values.indexOf(value);
  const effectiveIdx = idx === -1 ? 0 : idx;

  const center = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    if (skipNextScrollRef.current) {
      skipNextScrollRef.current = false;
      return;
    }
    el.scrollTop = effectiveIdx * ROW_HEIGHT;
  }, [effectiveIdx]);

  useIsomorphicLayoutEffect(center, [center]);

  useEffect(
    () => () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
    },
    []
  );

  function markActive() {
    setScrolling(true);
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setScrolling(false), WHEEL_ACTIVE_IDLE_MS);
  }

  function onScroll() {
    const el = ref.current;
    if (!el) return;
    markActive();
    const i = Math.round(el.scrollTop / ROW_HEIGHT);
    const clamped = Math.min(Math.max(i, 0), values.length - 1);
    const v = values[clamped];
    if (v !== undefined && v !== value) {
      skipNextScrollRef.current = true;
      onChange(v);
    }
  }

  function pick(v: number) {
    if (v !== value) {
      skipNextScrollRef.current = false;
      onChange(v);
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    const next = Math.min(Math.max(effectiveIdx + (e.key === "ArrowDown" ? 1 : -1), 0), values.length - 1);
    pick(values[next]);
  }

  return (
    <div
      className="relative"
      style={{ height: ROW_HEIGHT * VISIBLE_ROWS, width: 72 }}
      onPointerEnter={(e) => e.pointerType === "mouse" && setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onPointerDown={markActive}
    >
      <div
        className={`absolute inset-x-0 rounded-lg pointer-events-none transition-colors ${
          active ? "bg-primary-container/15 border-y border-outline-variant/60" : ""
        }`}
        style={{ top: CENTER_IDX * ROW_HEIGHT, height: ROW_HEIGHT }}
      />
      <div
        ref={ref}
        onScroll={onScroll}
        onKeyDown={onKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        tabIndex={0}
        className="absolute inset-0 overflow-y-auto snap-y snap-mandatory rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-primary/40 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        role="listbox"
        aria-label={label}
      >
        <div style={{ paddingTop: CENTER_IDX * ROW_HEIGHT, paddingBottom: CENTER_IDX * ROW_HEIGHT }}>
          {values.map((v) => (
            <div
              key={v}
              role="option"
              aria-selected={v === value}
              onClick={() => pick(v)}
              className="snap-center flex items-center justify-center cursor-pointer"
              style={{ height: ROW_HEIGHT }}
            >
              <span
                className={`font-headline-lg text-headline-lg leading-none tabular-nums transition-opacity duration-150 ${
                  v === value
                    ? "text-on-surface font-bold"
                    : active
                      ? "text-on-surface-variant opacity-40"
                      : "opacity-0"
                }`}
              >
                {pad(v)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function MonthGrid({
  selectedKey,
  minKey,
  todayKey,
  onSelect,
}: {
  selectedKey: string | null;
  minKey: string;
  todayKey: string;
  onSelect: (key: string) => void;
}) {
  const { y: initY, m: initM } = keyToParts(selectedKey ?? minKey);
  const [cursor, setCursor] = useState<{ y: number; m: number }>({ y: initY, m: initM });

  const leadingBlanks = (new Date(cursor.y, cursor.m - 1, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(cursor.y, cursor.m, 0).getDate();
  const cells: (number | null)[] = [
    ...Array.from({ length: leadingBlanks }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  function move(delta: number) {
    const d = new Date(cursor.y, cursor.m - 1 + delta, 1);
    setCursor({ y: d.getFullYear(), m: d.getMonth() + 1 });
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <button type="button" onClick={() => move(-1)} className="w-8 h-8 rounded-full hover:bg-surface-container-low flex items-center justify-center text-on-surface-variant" aria-label="เดือนก่อนหน้า">
          <span className="material-symbols-outlined text-[20px]">chevron_left</span>
        </button>
        <span className="font-body-md text-body-md font-semibold text-on-surface">{monthTitle(new Date(cursor.y, cursor.m - 1, 1))}</span>
        <button type="button" onClick={() => move(1)} className="w-8 h-8 rounded-full hover:bg-surface-container-low flex items-center justify-center text-on-surface-variant" aria-label="เดือนถัดไป">
          <span className="material-symbols-outlined text-[20px]">chevron_right</span>
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
          const key = dateKey(new Date(cursor.y, cursor.m - 1, day));
          const disabled = key < minKey;
          const selected = key === selectedKey;
          return (
            <button
              key={key}
              type="button"
              disabled={disabled}
              onClick={() => onSelect(key)}
              className={`h-9 rounded-lg font-body-md text-body-md transition-colors ${
                disabled
                  ? "text-on-surface-variant opacity-35 cursor-not-allowed"
                  : selected
                    ? "bg-primary text-on-primary font-bold"
                    : key === todayKey
                      ? "text-primary font-semibold ring-1 ring-primary"
                      : "text-on-surface hover:bg-primary-container/15"
              }`}
            >
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
}
