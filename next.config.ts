import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The proxy buffers request bodies up to this size (default 10MB). Task
  // attachments may be 10MB plus multipart overhead
  // (ATTACHMENT_MAX_REQUEST_BYTES in src/lib/upload-validation.ts), so the
  // buffer must be a bit larger or such uploads arrive truncated.
  experimental: {
    proxyClientMaxBodySize: "11mb",
  },
  // nosniff on every response, including the user uploads served from
  // /public/uploads: a browser must use the Content-Type it was given instead
  // of guessing one from the bytes, so an upload can never be sniffed into
  // HTML/script (the server-side checks in src/lib/upload-validation.ts are
  // the first layer; this is the second).
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [{ key: "X-Content-Type-Options", value: "nosniff" }],
      },
    ];
  },
};

export default nextConfig;
