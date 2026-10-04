import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/format";
import type { HistoryMeeting } from "./types";

/**
 * FR-11: "ระบบควรสามารถเรียกดู Notes จากการประชุมก่อนหน้าที่เกี่ยวข้องได้".
 *
 * Until now the only thing that read a previous meeting's notes was the AI
 * context builder (src/lib/meeting-ai-context.ts -> get_meeting_context()), so
 * the notes existed for the machine and not for the person preparing the next
 * meeting. This card surfaces the same material as read-only history.
 *
 * "Related" is scoped to the same project. That is the relation the data model
 * actually gives a meeting beyond its own row, and it is the same relation
 * FR-13 uses to trace a decision back to a project - so a project keeps one
 * coherent history. A meeting with no project has nothing to relate to, and
 * the card is then not rendered at all rather than showing an empty box.
 *
 * Read path is supabase-js under select_all_authenticated, matching the rest of
 * this page - no API route and no Prisma, since this is a Server Component and
 * the browser never issues the query.
 */
export async function MeetingHistoryCard({
  meetingId,
  projectId,
  currentStartTime,
}: {
  meetingId: string;
  projectId: string | null;
  currentStartTime: string;
}) {
  if (!projectId) return null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("Meeting")
    .select(
      `id, title, startTime, status,
       notes:MeetingNote(id, content, createdAt, author:User(name))`
    )
    .eq("projectId", projectId)
    .neq("id", meetingId)
    .lt("startTime", currentStartTime)
.order("startTime", { ascending: false })
    .order("createdAt", { referencedTable: "notes", ascending: false })
    .limit(10)
    // overrideTypes is the typed escape hatch for a PostgREST embed supabase-js
    // cannot infer - the same reason MeetingDetail is stated by hand and applied
    // with maybeSingle<T>(). Declaring the embed here keeps `notes[].author` a
    // single object rather than the array PostgREST's inference falls back to.
    .overrideTypes<HistoryMeeting[], { merge: false }>();

  if (error) throw new Error(error.message);

  const past = data ?? [];

  // A previous meeting that logged nothing is not history worth listing - it
  // would pad the card with empty rows that open to reveal there is nothing
  // inside. Meeting.notes has no default, so an unlogged meeting arrives here
  // with null rather than [].
  const pastWithNotes = past.filter((m) => Array.isArray(m.notes) && m.notes.length > 0);

  if (pastWithNotes.length === 0) {
    return (
      <div className="bg-surface-container-lowest rounded-xl p-card-padding border border-outline-variant/30">
        <h3 className="font-headline-md text-headline-md text-on-surface mb-3">ประวัติการประชุมก่อนหน้า</h3>
        <p className="text-on-surface-variant font-body-md text-sm">ยังไม่มีบันทึกจากการประชุมก่อนหน้าในโปรเจกต์นี้</p>
      </div>
    );
  }

  return (
    <div className="bg-surface-container-lowest rounded-xl p-card-padding border border-outline-variant/30">
      <h3 className="font-headline-md text-headline-md text-on-surface mb-1">ประวัติการประชุมก่อนหน้า</h3>
      <p className="text-on-surface-variant text-xs mb-3">บันทึกจากการประชุมก่อนหน้าในโปรเจกต์เดียวกัน</p>
      <div className="space-y-2">
        {pastWithNotes.map((m) => (
          /* <details> keeps this server-rendered and collapsible without any
             client state - a native disclosure widget, which also means the
             history is present in the initial HTML for search / no-JS. */
          <details key={m.id} className="p-3 rounded-lg bg-surface-container-low group">
            <summary className="flex items-center justify-between gap-2 cursor-pointer list-none">
              <div className="min-w-0">
                <p className="font-body-md text-body-md text-on-surface truncate">{m.title}</p>
                <p className="text-xs text-on-surface-variant">{formatDateTime(m.startTime)}</p>
              </div>
              <span className="material-symbols-outlined text-[18px] text-on-surface-variant shrink-0 group-open:rotate-180 transition-transform">
                expand_more
              </span>
            </summary>
            <div className="mt-3 space-y-2 border-t border-outline-variant/30 pt-3">
              {m.notes.map((n) => (
                <div key={n.id} className="p-2 rounded-lg bg-surface-container-lowest">
                  <p className="font-body-md text-body-md text-on-surface whitespace-pre-line">{n.content}</p>
                  <p className="text-xs text-on-surface-variant mt-1">{n.author?.name ?? "ไม่ทราบผู้บันทึก"}</p>
                </div>
              ))}
              <Link
                href={`/meetings/${m.id}`}
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <span className="material-symbols-outlined text-[14px]">open_in_new</span>
                เปิดการประชุมนั้น
              </Link>
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}
