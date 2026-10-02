/**
 * Test: server-side upload type checks (src/lib/upload-validation.ts), used by
 * POST /api/tasks/[id]/attachments and POST /api/users/me/avatar.
 *
 * Builds real file bytes (signatures included) and checks that allowed files
 * pass, executable/markup files are rejected with a readable message, and a
 * file whose extension lies about its content (e.g. HTML renamed to .png) is
 * rejected too. Pure function tests — no database or server needed:
 *
 *   npm run test:uploads
 *
 * Exits 0 if every assertion passes.
 */
import { checkAttachmentUpload, checkAvatarUpload, ATTACHMENT_ACCEPT, AVATAR_ACCEPT } from "@/lib/upload-validation";

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

console.log(`\n${passed} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
