"use client";

import { useEffect, useRef, useState } from "react";

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
  // Uploaded avatars live on the server's own disk (public/uploads, not in
  // git), so on another machine — or after the file is gone — the stored
  // avatarUrl 404s. Fall back to the initials instead of a broken image.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  useEffect(() => {
    // An error that happened before hydration never reaches onError.
    const img = imgRef.current;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (img && img.complete && img.naturalWidth === 0 && src) setFailedSrc(src);
  }, [src]);

  if (src && failedSrc !== src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        ref={imgRef}
        src={src}
        alt={name}
        style={style}
        onError={() => setFailedSrc(src)}
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
