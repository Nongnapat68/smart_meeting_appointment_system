"use client";

import { useEffect } from "react";
import type { ReactNode } from "react";

export function Modal({
  open,
  onClose,
  children,
  maxWidth = "max-w-[420px]",
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  maxWidth?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-on-background/40 z-50 flex items-center justify-center p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className={`bg-surface-container-lowest rounded-xl shadow-[0_4px_15px_rgba(0,0,0,0.15)] w-full ${maxWidth} flex flex-col p-6 gap-6`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "ยืนยัน",
  cancelLabel = "ยกเลิก",
  destructive = false,
  loading = false,
  icon = "help",
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  loading?: boolean;
  icon?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal open={open} onClose={onCancel}>
      <div className="flex justify-center w-full">
        <div
          className={`w-12 h-12 rounded-full flex items-center justify-center ${
            destructive ? "bg-error-container" : "bg-primary/10"
          }`}
        >
          <span
            className={`material-symbols-outlined icon-fill ${destructive ? "text-error" : "text-primary"}`}
          >
            {icon}
          </span>
        </div>
      </div>
      <div className="text-center flex flex-col gap-2">
        <h2 className="font-headline-md text-headline-md text-on-surface">{title}</h2>
        {description && (
          <p className="font-body-md text-body-md text-on-surface-variant">{description}</p>
        )}
      </div>
      <div className="flex items-center justify-end gap-3 pt-2">
        <button
          type="button"
          className="px-4 py-2.5 rounded-full border border-outline text-on-surface font-label-md text-label-md hover:bg-surface-container-low transition-colors w-full sm:w-auto"
          onClick={onCancel}
          disabled={loading}
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          className={`px-4 py-2.5 rounded-full font-label-md text-label-md shadow-sm transition-colors w-full sm:w-auto disabled:opacity-60 ${
            destructive
              ? "bg-error text-on-error hover:opacity-90"
              : "bg-primary text-on-primary hover:opacity-90"
          }`}
          onClick={onConfirm}
          disabled={loading}
        >
          {loading ? "กำลังดำเนินการ..." : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
