export function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-block w-5 h-5 rounded-full border-2 border-outline-variant border-t-primary animate-spin ${className}`}
    />
  );
}

export function FullPageSpinner() {
  return (
    <div className="flex-1 flex items-center justify-center py-24">
      <Spinner className="w-8 h-8" />
    </div>
  );
}

export function EmptyState({
  icon = "inbox",
  title,
  description,
  action,
}: {
  icon?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 px-6 gap-3">
      <div className="w-14 h-14 rounded-full bg-surface-container flex items-center justify-center text-on-surface-variant">
        <span className="material-symbols-outlined text-[28px]">{icon}</span>
      </div>
      <h3 className="font-headline-md text-headline-md text-on-surface">{title}</h3>
      {description && (
        <p className="font-body-md text-body-md text-on-surface-variant max-w-sm">{description}</p>
      )}
      {action}
    </div>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-error-container/50 text-on-error-container font-body-md text-body-md">
      <span className="material-symbols-outlined text-[20px]">error</span>
      <span>{message}</span>
    </div>
  );
}
