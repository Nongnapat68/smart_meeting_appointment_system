import { NextResponse } from "next/server";
import { processDueReminders } from "@/lib/reminder-processor";

export const runtime = "nodejs";

/** Called by a trusted deployment scheduler, never by a browser session. */
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "ไม่ได้รับอนุญาต" }, { status: 401 });
  }

  const result = await processDueReminders();
  return NextResponse.json(result);
}