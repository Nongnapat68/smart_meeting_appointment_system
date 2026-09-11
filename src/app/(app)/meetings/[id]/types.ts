import type {
  AISummary,
  ContactGroup,
  Decision,
  Meeting,
  MeetingNote,
  MeetingParticipant,
  OnlineMeetingResource,
  Person,
  RelatedResource,
  Task,
} from "@prisma/client";

// Hybrid migration round 1 (Meeting resource): this page now reads via
// supabase-js/PostgREST instead of Prisma. Prisma's generated types (Date
// fields) described the *old* GET /api/meetings/[id] response faithfully
// because Next.js RSC's flight protocol preserves real Date instances
// across the Server -> Client Component boundary. PostgREST has no such
// protocol — every timestamp column comes back as a plain ISO string. Every
// helper in src/lib/format.ts already accepts `Date | string`, so nothing
// downstream needed to change — only the types needed to stop claiming
// `Date` for values that are actually `string` at runtime now.
type Stringify<T> = T extends Date
  ? string
  : T extends (infer U)[]
    ? Stringify<U>[]
    : T extends object
      ? { [K in keyof T]: Stringify<T[K]> }
      : T;

export type MeetingWithStringDates = Stringify<Meeting>;

export interface MeetingDetail extends MeetingWithStringDates {
  organizer: { id: string; name: string; avatarUrl: string | null } | null;
  project: { id: string; name: string } | null;
  participants: (Stringify<MeetingParticipant> & {
    person: Stringify<Person>;
    sourceGroup: { id: string; name: string } | null;
  })[];
  groups: Stringify<ContactGroup>[];
  tasks: Stringify<Task>[];
  aiSummary: Stringify<AISummary> | null;
  onlineMeetingResource: Stringify<OnlineMeetingResource> | null;
  notes: (Stringify<MeetingNote> & { author: { name: string } | null })[];
  decisions: (Stringify<Decision> & { decidedBy: { name: string } | null })[];
  resources: (Stringify<RelatedResource> & { addedBy: { name: string } | null })[];
}

// Convenience aliases so MeetingContext.tsx (and anything else fed rows out
// of MeetingDetail) doesn't need to re-derive these via indexed access.
export type NoteWithAuthor = MeetingDetail["notes"][number];
export type DecisionWithUser = MeetingDetail["decisions"][number];
export type ResourceWithUser = MeetingDetail["resources"][number];
