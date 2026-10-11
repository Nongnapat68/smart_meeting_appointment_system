/**
 * Test: every date-time readout is pinned to Asia/Bangkok and does NOT drift
 * with the process timezone (ข้อ B8).
 *
 * Two checks:
 *   1. Absolute assertions — a fixed instant renders to fixed Bangkok values.
 *   2. TZ-independence — the same probe output is produced under
 *      TZ=UTC, TZ=Asia/Bangkok and TZ=America/Los_Angeles. The script re-spawns
 *      itself under each TZ and compares, so npm run test:format is one
 *      self-contained command.
 *
 * Also covers the phone-format rule and the .ics builder (src/lib/ics.ts):
 * UTC times, escaping, octet-based line folding for Thai text, STATUS.
 *
 * Run with:
 *   npm run test:format
 *
 * Exits 0 if every assertion passes, 1 otherwise.
 */
import { spawnSync } from "node:child_process";
import {
  formatDate,
  formatTime,
  formatDateTime,
  dayNumber,
  toDatetimeLocalValue,
  nextHourLocalValue,
  parseLocalAsBangkok,
} from "@/lib/format";
import { isValidPhone, PHONE_FORMAT_MESSAGE, personSchema, updatePersonSchema, updateProfileSchema } from "@/lib/validations";
import { foldLine, generateIcs } from "@/lib/ics";

const INSTANT = new Date("2026-10-20T03:00:00Z"); // 10:00 Asia/Bangkok

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

// The probe exercises every exported date function; the values below are the
// Asia/Bangkok answers, so any of them leaking the process TZ fails a check.
function probe(): string {
  return [
    formatDate(INSTANT),
    formatTime(INSTANT),
    formatDateTime(INSTANT),
    dayNumber(INSTANT),
    toDatetimeLocalValue(INSTANT),
    nextHourLocalValue(new Date("2026-10-20T08:07:00+07:00")),
    parseLocalAsBangkok("2026-10-20T10:00").toISOString(),
  ].join("|");
}

if (process.argv.includes("--probe")) {
  process.stdout.write(probe());
  process.exit(0);
}

console.log("Absolute Bangkok values for 2026-10-20T03:00:00Z (th-TH renders the Buddhist year 2569):");
check("formatDate -> 20 ต.ค. 2569", probe().split("|")[0] === "20 ต.ค. 2569", probe().split("|")[0]);
check("formatTime -> 10:00", probe().split("|")[1] === "10:00", probe().split("|")[1]);
check("formatDateTime contains • 10:00", probe().split("|")[2].includes("10:00"), probe().split("|")[2]);
check("dayNumber -> 20", probe().split("|")[3] === "20", probe().split("|")[3]);
check("toDatetimeLocalValue -> 2026-10-20T10:00", probe().split("|")[4] === "2026-10-20T10:00", probe().split("|")[4]);
check("nextHourLocalValue(08:07 BKK) -> 2026-10-20T09:00", probe().split("|")[5] === "2026-10-20T09:00", probe().split("|")[5]);
check("parseLocalAsBangkok -> UTC instant 03:00Z", probe().split("|")[6] === "2026-10-20T03:00:00.000Z", probe().split("|")[6]);

console.log("\nTZ-independence (same output under UTC / Asia/Bangkok / America/Los_Angeles):");
const tzs = ["UTC", "Asia/Bangkok", "America/Los_Angeles"];
const outputs: Record<string, string> = {};
for (const tz of tzs) {
  const child = spawnSync(process.execPath, ["--import", "tsx", __filename, "--probe"], {
    env: { ...process.env, TZ: tz },
    encoding: "utf8",
  });
  if (child.status !== 0) {
    failures++;
    console.log(`  ❌ probe under TZ=${tz} failed: ${(child.stderr ?? "").toString().trim()}`);
    continue;
  }
  outputs[tz] = child.stdout.toString().trim();
  console.log(`  TZ=${tz}: ${outputs[tz]}`);
}
const first = outputs[tzs[0]];
for (const tz of tzs.slice(1)) {
  check(`TZ=${tz} matches TZ=${tzs[0]}`, outputs[tz] === first, `got ${outputs[tz]}`);
}

console.log("\n[3] Phone number format (Settings API schema + People forms share isValidPhone)");
for (const ok of ["081-234-5678", "0123456789", "+66 81 234 5678", "(02) 123-4567", "", "   "]) {
  check(`phone ${JSON.stringify(ok)} accepted`, isValidPhone(ok));
}
check("phone null / undefined accepted (optional)", isValidPhone(null) && isValidPhone(undefined));
for (const bad of ["abc<script>", "081-234-567x", "12345678", "1234567890123456", "081.234.5678", "+66#812345678"]) {
  check(`phone ${JSON.stringify(bad)} rejected`, !isValidPhone(bad));
}
const badProfile = updateProfileSchema.safeParse({ name: "x", phone: "abc<script>" });
check(
  "updateProfileSchema rejects a bad phone with the Thai message",
  !badProfile.success && badProfile.error.issues[0]?.message === PHONE_FORMAT_MESSAGE
);
check("updateProfileSchema accepts a seeded phone and null", updateProfileSchema.safeParse({ name: "x", phone: "081-234-5680" }).success && updateProfileSchema.safeParse({ name: "x", phone: null }).success);
check("personSchema / updatePersonSchema reject a bad phone", !personSchema.safeParse({ name: "x", email: "a@b.co", phone: "abc" }).success && !updatePersonSchema.safeParse({ phone: "abc" }).success);

console.log("\n[.ics] FR-08 calendar file (RFC 5545)");
const icsInput = {
  uid: "zz-ics-1",
  title: "ประชุมทบทวนความคืบหน้าโครงการวิจัย AI Lab และพิจารณางบประมาณประจำปี; ครั้งที่ 2, ห้อง A",
  description: "วาระ 1\nวาระ 2; ตรวจ, \\ ทาง",
  startTime: INSTANT,
  endTime: new Date("2026-10-20T04:30:00Z"),
  location: "ห้องประชุมออนไลน์ A, ชั้น 3",
  organizerName: "สมชาย ใจดี",
  organizerEmail: "somchai@smartmeeting.dev",
  attendees: [{ name: 'Doe, John; "JJ"', email: "john@example.com" }],
};
const ics = generateIcs(icsInput);
const icsLines = ics.split("\r\n");
const unfolded = ics.replace(/\r\n /g, "");
check(".ics has VCALENDAR/VEVENT and a stable UID", ics.startsWith("BEGIN:VCALENDAR\r\n") && ics.includes("BEGIN:VEVENT") && ics.includes("END:VEVENT") && unfolded.includes("UID:zz-ics-1@smart-meeting-appointment-system"));
check(".ics times are UTC (10:00 Bangkok → 030000Z)", unfolded.includes("DTSTART:20261020T030000Z") && unfolded.includes("DTEND:20261020T043000Z"));
check(".ics every line ≤ 75 UTF-8 octets (Thai is 3 octets per character)", icsLines.every((l) => Buffer.byteLength(l, "utf8") <= 75), String(Math.max(...icsLines.map((l) => Buffer.byteLength(l, "utf8")))));
check(".ics folding never splits a character and unfolds back to the escaped Thai title", !ics.includes("�") && unfolded.includes("SUMMARY:ประชุมทบทวนความคืบหน้าโครงการวิจัย AI Lab และพิจารณางบประมาณประจำปี\\; ครั้งที่ 2\\, ห้อง A"));
check(".ics escapes ; , \\ and newlines in TEXT", unfolded.includes("DESCRIPTION:วาระ 1\\nวาระ 2\\; ตรวจ\\, \\\\ ทาง") && unfolded.includes("LOCATION:ห้องประชุมออนไลน์ A\\, ชั้น 3"));
check(".ics quotes CN parameters instead of backslash-escaping them", unfolded.includes(`ATTENDEE;CN="Doe, John; 'JJ'";ROLE=REQ-PARTICIPANT`) && unfolded.includes(`ORGANIZER;CN="สมชาย ใจดี":mailto:somchai@smartmeeting.dev`));
check(".ics STATUS:CONFIRMED normally, STATUS:CANCELLED for a cancelled meeting", unfolded.includes("STATUS:CONFIRMED") && generateIcs({ ...icsInput, cancelled: true }).includes("STATUS:CANCELLED"));
check(".ics short lines are left alone", foldLine("SUMMARY:x") === "SUMMARY:x");

console.log(`\n${passed} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);