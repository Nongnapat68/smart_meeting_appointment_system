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

console.log(`\n${passed} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);