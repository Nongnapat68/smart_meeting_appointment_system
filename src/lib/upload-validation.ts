// Server-side allowlist for uploaded files (task attachments, avatars).
//
// Uploads are written under public/uploads and served from the app's own
// origin, so a file the browser would render as a page (.html, .svg with an
// embedded <script>, ...) would run with the app's cookies — stored XSS. The
// file picker's `accept` attribute is only a hint and is trivially bypassed,
// so every upload is checked here, three ways, and all three must agree:
//
//   1. the extension of the file name is on the allowlist for that upload;
//   2. the MIME type the client declared is one browsers actually send for
//      that extension (declared MIME alone is client-controlled, so it is
//      never trusted on its own);
//   3. the file's first bytes match that format's signature ("magic bytes"),
//      which catches a renamed file — e.g. an HTML page saved as .png. Plain
//      text formats have no signature, so they are rejected if they contain
//      markup a browser could execute instead.
//
// No Node-only APIs here (Uint8Array, not Buffer), so client components can
// import the `accept` strings too.

type Rule = {
  /** MIME stored with the file — ours, not the client's. */
  mime: string;
  /** MIME types browsers send for this extension. */
  declared: readonly string[];
  /** Signature check on the first bytes; absent for plain-text formats. */
  magic?: (b: Uint8Array) => boolean;
};

const startsWith = (b: Uint8Array, sig: readonly number[], offset = 0) =>
  b.length >= offset + sig.length && sig.every((byte, i) => b[offset + i] === byte);
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

const JPEG = (b: Uint8Array) => startsWith(b, [0xff, 0xd8, 0xff]);
const PNG = (b: Uint8Array) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const GIF = (b: Uint8Array) => startsWith(b, ascii("GIF87a")) || startsWith(b, ascii("GIF89a"));
const WEBP = (b: Uint8Array) => startsWith(b, ascii("RIFF")) && startsWith(b, ascii("WEBP"), 8);
const PDF = (b: Uint8Array) => startsWith(b, ascii("%PDF-"));
// .docx/.xlsx/.pptx are ZIP containers; .doc/.xls/.ppt are OLE compound files.
const ZIP = (b: Uint8Array) => startsWith(b, [0x50, 0x4b, 0x03, 0x04]);
const OLE = (b: Uint8Array) => startsWith(b, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

// Some browsers/OSes send no MIME (or a generic one) for office files when no
// office suite is installed. Accepting that is safe only because the magic
// bytes must still match.
const GENERIC = ["application/octet-stream", ""];

const RULES: Record<string, Rule> = {
  jpg: { mime: "image/jpeg", declared: ["image/jpeg", "image/pjpeg"], magic: JPEG },
  jpeg: { mime: "image/jpeg", declared: ["image/jpeg", "image/pjpeg"], magic: JPEG },
  png: { mime: "image/png", declared: ["image/png"], magic: PNG },
  gif: { mime: "image/gif", declared: ["image/gif"], magic: GIF },
  webp: { mime: "image/webp", declared: ["image/webp"], magic: WEBP },
  pdf: { mime: "application/pdf", declared: ["application/pdf", ...GENERIC], magic: PDF },
  docx: {
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    declared: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/zip", ...GENERIC],
    magic: ZIP,
  },
  xlsx: {
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    declared: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/zip", ...GENERIC],
    magic: ZIP,
  },
  pptx: {
    mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    declared: ["application/vnd.openxmlformats-officedocument.presentationml.presentation", "application/zip", ...GENERIC],
    magic: ZIP,
  },
  doc: { mime: "application/msword", declared: ["application/msword", ...GENERIC], magic: OLE },
  xls: { mime: "application/vnd.ms-excel", declared: ["application/vnd.ms-excel", ...GENERIC], magic: OLE },
  ppt: { mime: "application/vnd.ms-powerpoint", declared: ["application/vnd.ms-powerpoint", ...GENERIC], magic: OLE },
  txt: { mime: "text/plain", declared: ["text/plain"] },
  // Windows reports .csv as application/vnd.ms-excel when Excel is installed.
  csv: { mime: "text/csv", declared: ["text/csv", "text/plain", "application/csv", "application/vnd.ms-excel"] },
};

export const AVATAR_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "gif"] as const;
export const ATTACHMENT_EXTENSIONS = [
  "jpg", "jpeg", "png", "webp", "gif",
  "pdf",
  "docx", "xlsx", "pptx", "doc", "xls", "ppt",
  "txt", "csv",
] as const;

const AVATAR_LABEL = "รูปภาพ JPG, PNG, WEBP หรือ GIF";
const ATTACHMENT_LABEL = "รูปภาพ (JPG, PNG, WEBP, GIF), PDF, Word, Excel, PowerPoint, TXT หรือ CSV";

/** For the file inputs' `accept` attribute (a UX hint only — the server decides). */
export const AVATAR_ACCEPT = AVATAR_EXTENSIONS.map((e) => `.${e}`).join(",");
export const ATTACHMENT_ACCEPT = ATTACHMENT_EXTENSIONS.map((e) => `.${e}`).join(",");

// Tags a browser could run script through if a "text" file were ever rendered
// as a page. Only tags: event-handler attributes (onload=...) need one of these
// to live in, and matching them alone would reject ordinary text like
// "online=yes" in a CSV.
const ACTIVE_MARKUP =
  /<\s*(script|html|head|body|iframe|frame|frameset|object|embed|applet|svg|math|meta|link|style|base|form|img|video|audio|image)\b|<!doctype|<\?xml/i;

export type UploadCheck = { ok: true; ext: string; mime: string } | { ok: false; message: string };

function extensionOf(name: string): string | null {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return null;
  return name.slice(dot + 1).toLowerCase();
}

function check(
  file: { name: string; type: string },
  bytes: Uint8Array,
  allowed: readonly string[],
  label: string
): UploadCheck {
  const ext = extensionOf(file.name);
  if (!ext || !allowed.includes(ext)) {
    return {
      ok: false,
      message: `ไม่รองรับไฟล์${ext ? `ชนิด .${ext}` : "ที่ไม่มีนามสกุล"} — รองรับเฉพาะ${label}`,
    };
  }
  if (bytes.length === 0) return { ok: false, message: "ไฟล์ว่างเปล่า กรุณาเลือกไฟล์อื่น" };

  const rule = RULES[ext];
  const declared = (file.type ?? "").toLowerCase().split(";")[0].trim();
  if (!rule.declared.includes(declared)) {
    return { ok: false, message: `ชนิดไฟล์ (${declared || "ไม่ระบุ"}) ไม่ตรงกับนามสกุล .${ext} ระบบจึงไม่รับไฟล์นี้` };
  }

  if (rule.magic) {
    if (!rule.magic(bytes)) {
      return { ok: false, message: `เนื้อหาไฟล์ไม่ใช่ไฟล์ .${ext} จริง (อาจถูกเปลี่ยนนามสกุล) ระบบจึงไม่รับไฟล์นี้` };
    }
  } else {
    // Plain text has no signature: scan the whole file for markup instead
    // (not just the start — padding would push a payload past any cut-off;
    // uploads are size-capped, so this stays cheap).
    const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    if (ACTIVE_MARKUP.test(text)) {
      return { ok: false, message: "ไฟล์ข้อความนี้มีโค้ด HTML หรือสคริปต์ปนอยู่ ระบบจึงไม่รับไฟล์นี้" };
    }
  }

  return { ok: true, ext, mime: rule.mime };
}

export function checkAvatarUpload(file: { name: string; type: string }, bytes: Uint8Array): UploadCheck {
  return check(file, bytes, AVATAR_EXTENSIONS, AVATAR_LABEL);
}

export function checkAttachmentUpload(file: { name: string; type: string }, bytes: Uint8Array): UploadCheck {
  return check(file, bytes, ATTACHMENT_EXTENSIONS, ATTACHMENT_LABEL);
}
