"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

type ToastKind = "success" | "error" | "info";

interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastContextValue {
  showToast: (message: string, kind?: ToastKind) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}

let nextId = 1;

const KIND_STYLES: Record<ToastKind, string> = {
  success: "bg-secondary text-on-secondary",
  error: "bg-error text-on-error",
  info: "bg-inverse-surface text-inverse-on-surface",
};

const KIND_ICONS: Record<ToastKind, string> = {
  success: "check_circle",
  error: "error",
  info: "info",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((message: string, kind: ToastKind = "info") => {
    const id = nextId++;
    setToasts((prev) => [...prev, { id, kind, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-center gap-2 rounded-lg px-4 py-3 shadow-lg font-body-md text-body-md ${KIND_STYLES[t.kind]}`}
          >
            <span className="material-symbols-outlined text-[20px]">{KIND_ICONS[t.kind]}</span>
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
