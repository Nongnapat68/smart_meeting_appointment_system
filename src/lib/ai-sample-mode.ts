import { formatDate } from "@/lib/format";

// Sample mode: what the three meeting AI features (FR-15/16/17) return when
// ANTHROPIC_API_KEY isn't set, instead of a 503. The text is assembled from
// the same get_meeting_context() data the real AI would get, with plain
// string templates — no LLM call, no cost. With a key set, the routes call
// the real AI exactly as before and none of this runs.
//
// No server-only imports here: the client components import the constants
// below so sample results aren't labeled "สร้างโดย AI".

/** Stored as AISummary.model for a sample-mode summary, so every page that
 * shows it can tell it apart from a real AI summary. */
export const SAMPLE_MODE_MODEL = "sample-mode-template";

export type AiResultMode = "ai" | "sample";

interface SampleTask {
  title: string;
  status: string;
  dueDate: Date | null;
}

const STATUS_LABEL: Record<string, string> = {
  NOT_STARTED: "ยังไม่เริ่ม",
  IN_PROGRESS: "กำลังดำเนินการ",
  COMPLETED: "เสร็จสิ้น",
};

const MAX_LISTED = 5;
const MAX_CHARS = 80;

function short(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > MAX_CHARS ? `${oneLine.slice(0, MAX_CHARS)}…` : oneLine;
}

function bulletList(items: string[]): string {
  const shown = items.slice(0, MAX_LISTED).map((i) => `- ${i}`);
  if (items.length > MAX_LISTED) shown.push(`- …และอีก ${items.length - MAX_LISTED} รายการ`);
  return shown.join("\n");
}

function taskLine(t: SampleTask): string {
  const due = t.dueDate ? ` (กำหนดส่ง ${formatDate(t.dueDate)})` : "";
  return `${t.title} [${STATUS_LABEL[t.status] ?? t.status}]${due}`;
}

/** FR-15 sample: counts + short titles of the notes/decisions/tasks in context. */
export function buildSampleMeetingSummary(input: {
  projectName: string | null;
  relatedTasks: SampleTask[];
  pastNotes: { content: string; meetingTitle: string }[];
  pastDecisions: { content: string; meetingTitle: string }[];
}): string {
  const scope = input.projectName ? `โปรเจกต์ "${input.projectName}"` : "การประชุมนี้";
  const sections = [
    `ข้อมูลที่เกี่ยวข้องใน${scope}: บันทึกจากการประชุมก่อนหน้า ${input.pastNotes.length} รายการ, มติ ${input.pastDecisions.length} รายการ, งาน ${input.relatedTasks.length} รายการ`,
    input.pastNotes.length
      ? `บันทึกการประชุม:\n${bulletList(input.pastNotes.map((n) => `[${n.meetingTitle}] ${short(n.content)}`))}`
      : null,
    input.pastDecisions.length
      ? `มติที่ประชุม:\n${bulletList(input.pastDecisions.map((d) => `[${d.meetingTitle}] ${short(d.content)}`))}`
      : null,
    input.relatedTasks.length ? `งานที่เกี่ยวข้อง:\n${bulletList(input.relatedTasks.map(taskLine))}` : null,
  ];
  return sections.filter(Boolean).join("\n\n");
}

/** FR-16 sample: overdue tasks first, then other unfinished ones, with due dates. */
export function buildSamplePendingIssues(input: { overdueTasks: SampleTask[]; openTasks: SampleTask[] }): string {
  const overdue = input.overdueTasks.length
    ? `งานที่เลยกำหนดส่งแล้วแต่ยังไม่เสร็จ (${input.overdueTasks.length} รายการ):\n${bulletList(input.overdueTasks.map(taskLine))}`
    : "งานที่เลยกำหนดส่งแล้วแต่ยังไม่เสร็จ: ไม่มี";
  const open = input.openTasks.length
    ? `งานอื่นที่ยังไม่เสร็จ (${input.openTasks.length} รายการ):\n${bulletList(input.openTasks.map(taskLine))}`
    : "งานอื่นที่ยังไม่เสร็จ: ไม่มี";
  return `${overdue}\n\n${open}`;
}

/** FR-17 sample: the typed topic first, then up to 2 items from pending tasks / past decisions. */
export function buildSampleAgenda(input: {
  topic: string;
  overdueTasks: SampleTask[];
  openTasks: SampleTask[];
  decisions: { content: string; meetingTitle: string }[];
}): string {
  const items = [`${input.topic} (หัวข้อที่ระบุ)`];
  const followUps = [
    ...input.overdueTasks.map((t) => `ติดตามงานที่เลยกำหนด: ${t.title}${t.dueDate ? ` (กำหนดส่ง ${formatDate(t.dueDate)})` : ""}`),
    ...input.decisions.map((d) => `ทบทวนมติจาก "${d.meetingTitle}": ${short(d.content)}`),
    ...input.openTasks.map((t) => `อัปเดตความคืบหน้า: ${t.title}`),
  ];
  items.push(...followUps.slice(0, 2));
  return items.map((item, i) => `${i + 1}. ${item}`).join("\n");
}
