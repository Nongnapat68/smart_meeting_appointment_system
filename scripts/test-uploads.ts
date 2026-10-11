/**
 * Test: server-side upload type checks (src/lib/upload-validation.ts), used by
 * POST /api/tasks/[id]/attachments and POST /api/users/me/avatar.
 *
 * Builds real file bytes (signatures included) and checks that allowed files
 * pass, executable/markup files are rejected with a readable message, and a
 * file whose extension lies about its content (e.g. HTML renamed to .png) is
 * rejected too. Pure function tests (plus a source check of the avatar route) —
 * no database or server needed:
 *
 *   npm run test:uploads
 *
 * Exits 0 if every assertion passes.
 */
import { readFileSync } from "fs";
import path from "path";
import { taskUploadDir, taskUploadsRoot } from "@/lib/task-uploads";
import {
  checkAttachmentUpload,
  checkAvatarUpload,
  checkAttachmentRequestSize,
  checkAvatarRequestSize,
  ATTACHMENT_ACCEPT,
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_MAX_REQUEST_BYTES,
  AVATAR_ACCEPT,
  AVATAR_MAX_BYTES,
  AVATAR_MAX_REQUEST_BYTES,
  AVATAR_TOO_LARGE_MESSAGE,
} from "@/lib/upload-validation";

let failures = 0;
let passed = 0;
function check(label: string, condition: boolean, detail?: string) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${label}`);
  } else {
    failures++;
    console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const bytes = (...parts: (string | number[])[]) =>
  new Uint8Array(parts.flatMap((p) => (typeof p === "string" ? [...Buffer.from(p, "latin1")] : p)));

// Real 1x1 PNG.
const PNG = new Uint8Array(
  Buffer.from(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fe0dc9a4f60000000049454e44ae426082",
    "hex"
  )
);
const JPEG = bytes([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10], "JFIF", [0x00, 0x01, 0x01, 0x00, 0xff, 0xd9]);
const GIF = bytes("GIF89a", [0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x3b]);
const WEBP = bytes("RIFF", [0x1a, 0x00, 0x00, 0x00], "WEBPVP8 ", [0x0e, 0x00, 0x00, 0x00]);
const PDF = bytes("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
const ZIP = bytes([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00], "[Content_Types].xml");
const OLE = bytes([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00, 0x00]);
const utf8 = (s: string) => new Uint8Array(Buffer.from(s, "utf8"));
const HTML = utf8("<!DOCTYPE html><html><body><script>fetch('/api/auth/me').then(r=>r.text()).then(alert)</script></body></html>");
const SVG = utf8('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(document.cookie)"><script>alert(1)</script></svg>');
const EXE = bytes("MZ", [0x90, 0x00, 0x03, 0x00]);

type Case = { name: string; type: string; data: Uint8Array };
const att = (c: Case) => checkAttachmentUpload({ name: c.name, type: c.type }, c.data);
const ava = (c: Case) => checkAvatarUpload({ name: c.name, type: c.type }, c.data);
const accepted = (r: ReturnType<typeof att>) => r.ok;
const rejectedWith = (r: ReturnType<typeof att>, needle: string | RegExp) =>
  !r.ok && (typeof needle === "string" ? r.message.includes(needle) : needle.test(r.message));
const show = (r: ReturnType<typeof att>) => (r.ok ? `ok ${r.ext} ${r.mime}` : r.message);

console.log("\n[1] Attachments: allowed types are accepted");
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const good: Case[] = [
  { name: "photo.png", type: "image/png", data: PNG },
  { name: "photo.jpg", type: "image/jpeg", data: JPEG },
  { name: "photo.jpeg", type: "image/jpeg", data: JPEG },
  { name: "anim.gif", type: "image/gif", data: GIF },
  { name: "pic.webp", type: "image/webp", data: WEBP },
  { name: "report.pdf", type: "application/pdf", data: PDF },
  { name: "รายงานประชุม.docx", type: DOCX_MIME, data: ZIP },
  { name: "budget.xlsx", type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", data: ZIP },
  { name: "deck.pptx", type: "application/vnd.openxmlformats-officedocument.presentationml.presentation", data: ZIP },
  { name: "old.doc", type: "application/msword", data: OLE },
  { name: "old.xls", type: "application/vnd.ms-excel", data: OLE },
  { name: "old.ppt", type: "application/vnd.ms-powerpoint", data: OLE },
  { name: "notes.txt", type: "text/plain", data: utf8("บันทึกการประชุม\nข้อ 1: a<b และ x < 5\n") },
  { name: "data.csv", type: "text/csv", data: utf8("name,online=yes,condition=ok\nสมชาย,1,2\n") },
];
for (const c of good) check(`${c.name} (${c.type}) accepted`, accepted(att(c)), show(att(c)));
check("office file with no MIME from the browser is accepted (magic bytes still checked)", accepted(att({ name: "a.docx", type: "", data: ZIP })));
check("…and with application/octet-stream", accepted(att({ name: "a.pdf", type: "application/octet-stream", data: PDF })));
check("CSV declared as application/vnd.ms-excel (Windows + Excel) accepted", accepted(att({ name: "a.csv", type: "application/vnd.ms-excel", data: utf8("a,b\n1,2\n") })));
check("MIME with parameters (text/plain; charset=utf-8) accepted", accepted(att({ name: "a.txt", type: "text/plain; charset=utf-8", data: utf8("hi") })));
const upper = att({ name: "PHOTO.PNG", type: "image/png", data: PNG });
check("upper-case extension accepted and normalised to lower case", upper.ok && upper.ext === "png", show(upper));
check("stored MIME is ours, not the client's (docx → canonical type)", (() => {
  const r = att({ name: "a.docx", type: "application/zip", data: ZIP });
  return r.ok && r.mime === DOCX_MIME;
})());

console.log("\n[2] Attachments: executable / markup files are rejected with a readable message");
const dangerous: Case[] = [
  { name: "page.html", type: "text/html", data: HTML },
  { name: "page.htm", type: "text/html", data: HTML },
  { name: "page.xhtml", type: "application/xhtml+xml", data: HTML },
  { name: "logo.svg", type: "image/svg+xml", data: SVG },
  { name: "app.js", type: "text/javascript", data: utf8("alert(1)") },
  { name: "app.mjs", type: "text/javascript", data: utf8("alert(1)") },
  { name: "setup.exe", type: "application/x-msdownload", data: EXE },
  { name: "run.bat", type: "application/x-bat", data: utf8("del *") },
  { name: "shell.php", type: "application/x-php", data: utf8("<?php system($_GET['c']);") },
  { name: "page.HTML", type: "text/html", data: HTML },
  { name: "evil.png.html", type: "text/html", data: HTML },
  { name: "Makefile", type: "", data: utf8("all:") },
  { name: "trailingdot.", type: "", data: utf8("x") },
];
for (const c of dangerous) {
  const r = att(c);
  check(`${c.name} rejected — "${r.ok ? "" : r.message}"`, rejectedWith(r, "ไม่รองรับไฟล์"), show(r));
}
check("rejection message lists what *is* allowed", rejectedWith(att(dangerous[0]), "PDF, Word, Excel, PowerPoint"));
check("message names the rejected type (.html)", rejectedWith(att(dangerous[0]), "ชนิด .html"));

console.log("\n[3] Attachments: files whose extension lies about the content are rejected");
const disguised: Case[] = [
  { name: "innocent.png", type: "image/png", data: HTML },
  { name: "innocent.jpg", type: "image/jpeg", data: SVG },
  { name: "innocent.gif", type: "image/gif", data: HTML },
  { name: "innocent.webp", type: "image/webp", data: HTML },
  { name: "innocent.pdf", type: "application/pdf", data: HTML },
  { name: "innocent.docx", type: DOCX_MIME, data: HTML },
  { name: "innocent.doc", type: "application/msword", data: EXE },
  { name: "evil.html.png", type: "image/png", data: HTML },
  { name: "photo.png", type: "image/png", data: JPEG }, // wrong image format
];
for (const c of disguised) {
  const r = att(c);
  check(`${c.name} with ${c === disguised[8] ? "JPEG" : "HTML/SVG/EXE"} content rejected`, rejectedWith(r, "อาจถูกเปลี่ยนนามสกุล"), show(r));
}
check("double extension with a real PNG inside is fine (evil.html.png → png)", (() => {
  const r = att({ name: "evil.html.png", type: "image/png", data: PNG });
  return r.ok && r.ext === "png";
})());
check(".txt containing <script> rejected", rejectedWith(att({ name: "a.txt", type: "text/plain", data: HTML }), "HTML หรือสคริปต์"));
check(".csv containing <img onerror> rejected", rejectedWith(att({ name: "a.csv", type: "text/csv", data: utf8('a,b\n<img src=x onerror="alert(1)">,1\n') }), "HTML หรือสคริปต์"));
check(".txt with an <svg> payload rejected", rejectedWith(att({ name: "a.txt", type: "text/plain", data: SVG }), "HTML หรือสคริปต์"));
const padded = utf8("x".repeat(200_000) + "<script>alert(1)</script>");
check("payload hidden after 200KB of padding still found", rejectedWith(att({ name: "a.txt", type: "text/plain", data: padded }), "HTML หรือสคริปต์"));

console.log("\n[4] Attachments: declared MIME must match the extension");
check("real PNG named .png but declared text/html → rejected", rejectedWith(att({ name: "a.png", type: "text/html", data: PNG }), "ไม่ตรงกับนามสกุล .png"));
check("real PDF named .pdf but declared image/png → rejected", rejectedWith(att({ name: "a.pdf", type: "image/png", data: PDF }), "ไม่ตรงกับนามสกุล .pdf"));
check("image with no declared MIME → rejected (images always have one)", rejectedWith(att({ name: "a.png", type: "", data: PNG }), "ไม่ระบุ"));
check("text file declared image/png → rejected", rejectedWith(att({ name: "a.txt", type: "image/png", data: utf8("hi") }), "ไม่ตรงกับนามสกุล .txt"));
check("empty file rejected", rejectedWith(att({ name: "a.pdf", type: "application/pdf", data: new Uint8Array() }), "ไฟล์ว่างเปล่า"));

console.log("\n[5] Avatar: common images only");
for (const c of good.slice(0, 5)) check(`avatar ${c.name} accepted`, accepted(ava(c)), show(ava(c)));
check("avatar .pdf rejected", rejectedWith(ava({ name: "a.pdf", type: "application/pdf", data: PDF }), "รองรับเฉพาะรูปภาพ JPG, PNG, WEBP หรือ GIF"));
check("avatar .svg rejected", rejectedWith(ava({ name: "a.svg", type: "image/svg+xml", data: SVG }), "ไม่รองรับไฟล์ชนิด .svg"));
check("avatar .html rejected", rejectedWith(ava({ name: "a.html", type: "text/html", data: HTML }), "ไม่รองรับไฟล์ชนิด .html"));
check("avatar HTML renamed to .png (declared image/png) rejected", rejectedWith(ava({ name: "me.png", type: "image/png", data: HTML }), "อาจถูกเปลี่ยนนามสกุล"));
check("avatar HTML declared image/png but named .html (the old MIME-only check let this through) rejected", rejectedWith(ava({ name: "me.html", type: "image/png", data: HTML }), "ไม่รองรับไฟล์ชนิด .html"));
check("avatar real JPEG accepted with ext jpg", (() => {
  const r = ava({ name: "me.jpg", type: "image/jpeg", data: JPEG });
  return r.ok && r.ext === "jpg" && r.mime === "image/jpeg";
})());

console.log("\n[6] accept hints for the file pickers");
check("avatar picker accept lists only images", AVATAR_ACCEPT === ".jpg,.jpeg,.png,.webp,.gif", AVATAR_ACCEPT);
check("attachment picker accept has no .html/.svg/.js", !/\.(html?|svg|js)\b/.test(ATTACHMENT_ACCEPT), ATTACHMENT_ACCEPT);

console.log("\n[7] Attachments: size limit (10MB) checked from Content-Length before the body is read");
const MB = 1024 * 1024;
const sized = (n: number | null) => checkAttachmentRequestSize(n === null ? null : String(n));
check("max file size is 10MB", ATTACHMENT_MAX_BYTES === 10 * MB);
check("request cap leaves room for multipart overhead on a 10MB file", ATTACHMENT_MAX_REQUEST_BYTES > ATTACHMENT_MAX_BYTES);
check("small request (25 B) passes", sized(25).ok);
check("10MB file + 1KB multipart overhead passes", sized(10 * MB + 1024).ok);
check("request exactly at the cap passes", sized(ATTACHMENT_MAX_REQUEST_BYTES).ok);
check("~11MB request is refused with the Thai size message", (() => {
  const r = sized(11 * MB);
  return !r.ok && r.message === "ไฟล์มีขนาดใหญ่เกินไป (สูงสุด 10MB)";
})());
check("one byte over the cap is refused", !sized(ATTACHMENT_MAX_REQUEST_BYTES + 1).ok);
check("missing Content-Length passes to the per-file check", sized(null).ok);
check("unparsable Content-Length passes to the per-file check", checkAttachmentRequestSize("abc").ok);
check("next.config proxyClientMaxBodySize is larger than the request cap (else bodies arrive truncated → 500)", (() => {
  const m = readFileSync("next.config.ts", "utf8").match(/proxyClientMaxBodySize:\s*"(\d+)mb"/);
  return !!m && Number(m[1]) * MB >= ATTACHMENT_MAX_REQUEST_BYTES;
})());

console.log("\n[7b] Avatar: size limit (5MB) checked from Content-Length before the body is read");
const avatarSized = (n: number | null) => checkAvatarRequestSize(n === null ? null : String(n));
check("avatar max file size is 5MB", AVATAR_MAX_BYTES === 5 * MB);
check("avatar request cap leaves room for multipart overhead on a 5MB image", AVATAR_MAX_REQUEST_BYTES > AVATAR_MAX_BYTES);
check("small avatar request (2KB) passes", avatarSized(2048).ok);
check("5MB image + 1KB multipart overhead passes", avatarSized(5 * MB + 1024).ok);
check("avatar request exactly at the cap passes", avatarSized(AVATAR_MAX_REQUEST_BYTES).ok);
check("one byte over the avatar cap is refused", !avatarSized(AVATAR_MAX_REQUEST_BYTES + 1).ok);
check("~6MB avatar request is refused with the Thai size message", (() => {
  const r = avatarSized(6 * MB);
  return !r.ok && r.message === "ไฟล์มีขนาดใหญ่เกินไป (สูงสุด 5MB)" && r.message === AVATAR_TOO_LARGE_MESSAGE;
})());
check("a 7MB request is fine for attachments but refused for avatars", sized(7 * MB).ok && !avatarSized(7 * MB).ok);
check("missing Content-Length passes to the avatar per-file check", avatarSized(null).ok);
check("unparsable Content-Length passes to the avatar per-file check", checkAvatarRequestSize("abc").ok);
check("avatar route answers 413 from Content-Length and 400 when formData() throws (no bare 500)", (() => {
  const src = readFileSync("src/app/api/users/me/avatar/route.ts", "utf8");
  const sizeAt = src.indexOf("checkAvatarRequestSize(request.headers.get(\"content-length\"))");
  const parseAt = src.indexOf("await request.formData()");
  return sizeAt > 0 && parseAt > sizeAt && /ApiError\(413,/.test(src) && /try\s*\{\s*formData = await request\.formData\(\);\s*\}\s*catch/.test(src);
})());
check("next.config proxyClientMaxBodySize is larger than the avatar request cap", (() => {
  const m = readFileSync("next.config.ts", "utf8").match(/proxyClientMaxBodySize:\s*"(\d+)mb"/);
  return !!m && Number(m[1]) * MB >= AVATAR_MAX_REQUEST_BYTES;
})());

console.log("\n[8] Task upload folder removed on task delete: only a direct child of public/uploads/tasks/");
const ROOT = taskUploadsRoot();
check("cuid task id resolves inside the tasks folder", taskUploadDir("cmv40lls40001uwcsm9a5dedm") === path.join(ROOT, "cmv40lls40001uwcsm9a5dedm"));
check("uuid task id resolves inside the tasks folder", taskUploadDir("6f46be4e-3d53-468f-a030-2c7447531395") === path.join(ROOT, "6f46be4e-3d53-468f-a030-2c7447531395"));
for (const bad of ["..", "../avatars", "..\\avatars", "a/b", "x/../../..", "/etc", "C:\\Windows", "", ".", "rlswild%123", "a".repeat(65)]) {
  check(`task id ${JSON.stringify(bad.length > 20 ? bad.slice(0, 8) + "…" : bad)} refused`, taskUploadDir(bad) === null);
}

console.log(`\n${passed} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
