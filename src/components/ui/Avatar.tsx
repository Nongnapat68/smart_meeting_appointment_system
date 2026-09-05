function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function Avatar({
  name,
  src,
  size = 32,
  className = "",
}: {
  name: string;
  src?: string | null;
  size?: number;
  className?: string;
}) {
  const style = { width: size, height: size };
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={name}
        style={style}
        className={`rounded-full object-cover border border-outline-variant shrink-0 ${className}`}
      />
    );
  }
  return (
    <div
      style={style}
      className={`rounded-full bg-primary-container text-on-primary-container flex items-center justify-center font-label-md font-bold shrink-0 ${className}`}
    >
      {initials(name)}
    </div>
  );
}
