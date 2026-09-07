import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-opus-5";

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Add it to .env to use the AI features."
    );
  }
  if (!client) client = new Anthropic();
  return client;
}

export function isAiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function textFrom(response: Anthropic.Message): string {
  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

export interface MeetingSummaryInput {
  title: string;
  description: string | null;
  startTime: Date;
  endTime: Date;
  location: string | null;
  organizerName: string | null;
  participantNames: string[];
  projectName: string | null;
  relatedTasks: { title: string; status: string; dueDate: Date | null }[];
  pastMeetings: { title: string; startTime: Date }[];
  // FR-15: now that Decision/MeetingNote/RelatedResource exist as their own
  // entities, the pre-meeting summary can draw on what was actually decided,
  // noted and shared last time, not just task/meeting titles.
  pastDecisions: { content: string; meetingTitle: string }[];
  pastNotes: { content: string; meetingTitle: string }[];
  resources: { title: string; url: string }[];
  pastResources: { title: string; url: string; meetingTitle: string }[];
}

/** Generates a pre-meeting briefing: pending items, decisions to revisit, open issues. */
export async function generateMeetingSummary(input: MeetingSummaryInput): Promise<string> {
  const anthropic = getClient();

  const context = [
    `หัวข้อการประชุม: ${input.title}`,
    `เวลา: ${input.startTime.toLocaleString("th-TH")} - ${input.endTime.toLocaleString("th-TH")}`,
    input.location ? `สถานที่/ลิงก์: ${input.location}` : null,
    input.organizerName ? `ผู้จัดประชุม: ${input.organizerName}` : null,
    input.participantNames.length
      ? `ผู้เข้าร่วม: ${input.participantNames.join(", ")}`
      : null,
    input.projectName ? `โปรเจกต์ที่เกี่ยวข้อง: ${input.projectName}` : null,
    input.description ? `วาระ/รายละเอียดที่ระบุไว้:\n${input.description}` : null,
    input.relatedTasks.length
      ? `งาน (tasks) ที่เกี่ยวข้องกับโปรเจกต์/ประชุมนี้:\n${input.relatedTasks
          .map(
            (t) =>
              `- [${t.status}] ${t.title}${t.dueDate ? ` (กำหนดส่ง ${t.dueDate.toLocaleDateString("th-TH")})` : ""}`
          )
          .join("\n")}`
      : null,
    input.pastMeetings.length
      ? `การประชุมก่อนหน้าของโปรเจกต์/กลุ่มเดียวกัน:\n${input.pastMeetings
          .map((m) => `- ${m.title} (${m.startTime.toLocaleDateString("th-TH")})`)
          .join("\n")}`
      : null,
    input.pastDecisions.length
      ? `มติ/การตัดสินใจจากการประชุมก่อนหน้า:\n${input.pastDecisions
          .map((d) => `- [${d.meetingTitle}] ${d.content}`)
          .join("\n")}`
      : null,
    input.pastNotes.length
      ? `บันทึกจากการประชุมก่อนหน้า:\n${input.pastNotes
          .map((n) => `- [${n.meetingTitle}] ${n.content}`)
          .join("\n")}`
      : null,
    input.resources.length
      ? `เอกสาร/ลิงก์อ้างอิงที่เกี่ยวข้องกับการประชุมนี้:\n${input.resources
          .map((r) => `- ${r.title}: ${r.url}`)
          .join("\n")}`
      : null,
    input.pastResources.length
      ? `เอกสาร/ลิงก์ที่เคยแชร์ไว้ในการประชุมก่อนหน้า:\n${input.pastResources
          .map((r) => `- [${r.meetingTitle}] ${r.title}: ${r.url}`)
          .join("\n")}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1200,
    system:
      "คุณเป็นผู้ช่วยเตรียมข้อมูลก่อนการประชุมสำหรับระบบ Smart Meeting ขององค์กร " +
      "หน้าที่ของคุณคือสรุปข้อมูลที่มีให้กระชับ เป็นภาษาไทย แบ่งเป็นหัวข้อย่อยที่ชัดเจน " +
      "(เช่น สถานะงานค้าง, การตัดสินใจ/บริบทจากการประชุมก่อนหน้า, ประเด็นที่ควรพิจารณา) " +
      "ใช้เฉพาะข้อมูลที่ได้รับมาเท่านั้น ห้ามสร้างข้อมูลที่ไม่มีอยู่จริงขึ้นมาเอง " +
      "หากข้อมูลบางหมวดไม่มี ให้ข้ามหัวข้อนั้นไปเลย อย่าเขียนว่า 'ไม่มีข้อมูล'",
    messages: [
      {
        role: "user",
        content: `นี่คือข้อมูลของการประชุมที่กำลังจะถึง กรุณาสรุปเป็นบทสรุปก่อนการประชุม:\n\n${context}`,
      },
    ],
  });

  return textFrom(response);
}

// --- FR-16: Pending Issues Analysis ---------------------------------------

export interface PendingIssuesInput {
  projectName: string | null;
  overdueTasks: { title: string; status: string; priority: string; dueDate: Date }[];
  openTasks: { title: string; status: string; priority: string; dueDate: Date | null }[];
  decisions: { content: string; meetingTitle: string }[];
  notes: { content: string; meetingTitle: string }[];
}

/**
 * Analyzes what's still open going into the next meeting: tasks that are
 * overdue, and decisions/notes from past meetings that don't look like
 * they've been followed up on. This is a separate, narrower capability from
 * FR-15's pre-meeting briefing — FR-15 summarizes everything relevant;
 * FR-16 specifically flags what still needs attention.
 */
export async function generatePendingIssuesAnalysis(input: PendingIssuesInput): Promise<string> {
  const anthropic = getClient();

  const context = [
    input.projectName ? `โปรเจกต์: ${input.projectName}` : null,
    input.overdueTasks.length
      ? `งานที่เลยกำหนดส่งแล้วแต่ยังไม่เสร็จ:\n${input.overdueTasks
          .map((t) => `- [${t.status}, priority ${t.priority}] ${t.title} (กำหนดส่ง ${t.dueDate.toLocaleDateString("th-TH")})`)
          .join("\n")}`
      : "งานที่เลยกำหนดส่งแล้วแต่ยังไม่เสร็จ: ไม่มี",
    input.openTasks.length
      ? `งานอื่นที่ยังไม่เสร็จ (ยังไม่เลยกำหนด):\n${input.openTasks
          .map(
            (t) =>
              `- [${t.status}, priority ${t.priority}] ${t.title}${t.dueDate ? ` (กำหนดส่ง ${t.dueDate.toLocaleDateString("th-TH")})` : ""}`
          )
          .join("\n")}`
      : null,
    input.decisions.length
      ? `มติ/การตัดสินใจจากการประชุมก่อนหน้า:\n${input.decisions
          .map((d) => `- [${d.meetingTitle}] ${d.content}`)
          .join("\n")}`
      : "มติ/การตัดสินใจจากการประชุมก่อนหน้า: ไม่มี",
    input.notes.length
      ? `บันทึกจากการประชุมก่อนหน้า:\n${input.notes.map((n) => `- [${n.meetingTitle}] ${n.content}`).join("\n")}`
      : "บันทึกจากการประชุมก่อนหน้า: ไม่มี",
  ]
    .filter(Boolean)
    .join("\n");

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1200,
    system:
      "คุณเป็นผู้ช่วยวิเคราะห์ประเด็นค้างก่อนการประชุมครั้งถัดไปสำหรับระบบ Smart Meeting ขององค์กร " +
      "จากข้อมูลที่ได้รับ ให้วิเคราะห์และตอบเป็นภาษาไทย แบ่งเป็น 2 หัวข้อ: " +
      "(1) งานที่เลยกำหนดส่งแล้วยังไม่เสร็จ — ระบุชื่องานตรงๆ จากรายการที่ให้มา " +
      "(2) มติหรือบันทึกจากการประชุมก่อนหน้าที่ดูเหมือนยังไม่มีงาน (task) ใดในรายการที่ให้มารองรับ/ติดตามอย่างชัดเจน — " +
      "เทียบเนื้อหามติ/บันทึกกับชื่องานที่มีอยู่เอง แล้วชี้เฉพาะรายการที่น่าสงสัยว่ายังค้างจริงๆ พร้อมเหตุผลสั้นๆ " +
      "ใช้เฉพาะข้อมูลที่ได้รับมาเท่านั้น ห้ามสร้างงาน มติ หรือบันทึกที่ไม่มีอยู่จริงขึ้นมาเอง " +
      "หากหมวดใดไม่มีประเด็นค้าง ให้ระบุตรงๆ ว่าไม่มี อย่าข้ามหัวข้อไปเฉยๆ",
    messages: [
      {
        role: "user",
        content: `นี่คือข้อมูลงานและประวัติการประชุมที่เกี่ยวข้อง กรุณาวิเคราะห์ประเด็นค้าง:\n\n${context}`,
      },
    ],
  });

  return textFrom(response);
}

// --- FR-17: New Agenda Context (suggest an agenda for the next meeting) --

export interface AgendaSuggestionInput {
  topic: string;
  projectName: string | null;
  overdueTasks: { title: string; status: string; priority: string; dueDate: Date }[];
  openTasks: { title: string; status: string; priority: string; dueDate: Date | null }[];
  decisions: { content: string; meetingTitle: string }[];
  notes: { content: string; meetingTitle: string }[];
}

/**
 * Suggests an agenda for the *next* meeting by merging a user-typed topic
 * with the same pending-issues context FR-16 analyzes — so a new meeting
 * doesn't start from a blank page, but also doesn't just repeat FR-16's
 * output verbatim; it turns that context plus the new topic into a
 * ready-to-use agenda item list.
 */
export async function generateAgendaSuggestion(input: AgendaSuggestionInput): Promise<string> {
  const anthropic = getClient();

  const context = [
    input.projectName ? `โปรเจกต์: ${input.projectName}` : null,
    input.overdueTasks.length
      ? `งานที่เลยกำหนดส่งแล้วแต่ยังไม่เสร็จ:\n${input.overdueTasks
          .map((t) => `- ${t.title} (กำหนดส่ง ${t.dueDate.toLocaleDateString("th-TH")})`)
          .join("\n")}`
      : null,
    input.openTasks.length
      ? `งานอื่นที่ยังไม่เสร็จ:\n${input.openTasks.map((t) => `- ${t.title}`).join("\n")}`
      : null,
    input.decisions.length
      ? `มติจากการประชุมก่อนหน้า:\n${input.decisions.map((d) => `- [${d.meetingTitle}] ${d.content}`).join("\n")}`
      : null,
    input.notes.length
      ? `บันทึกจากการประชุมก่อนหน้า:\n${input.notes.map((n) => `- [${n.meetingTitle}] ${n.content}`).join("\n")}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1200,
    system:
      "คุณเป็นผู้ช่วยร่างวาระ (agenda) การประชุมครั้งถัดไปสำหรับระบบ Smart Meeting ขององค์กร " +
      "ผู้ใช้จะระบุหัวข้อหลักที่ต้องการประชุมครั้งถัดไป และให้ข้อมูลประเด็นค้างจากงาน/มติ/บันทึกของโปรเจกต์เดียวกัน " +
      "หน้าที่ของคุณคือผสานทั้งสองอย่างเป็นรายการวาระการประชุม (agenda) ที่พร้อมใช้งานจริง เรียงลำดับตามความสำคัญ " +
      "แต่ละวาระให้ระบุสั้นๆ ว่ามาจากหัวข้อที่ผู้ใช้ระบุ หรือมาจากประเด็นค้างรายการใด " +
      "ตอบเป็นภาษาไทย รูปแบบลิสต์ลำดับเลข ใช้เฉพาะข้อมูลที่ได้รับมาเท่านั้น ห้ามสร้างข้อมูลที่ไม่มีอยู่จริงขึ้นมาเอง",
    messages: [
      {
        role: "user",
        content:
          `หัวข้อหลักที่จะประชุมครั้งถัดไป: ${input.topic}\n\n` +
          `ประเด็นค้างจากโปรเจกต์เดียวกัน:\n${context || "(ไม่มีประเด็นค้าง)"}\n\n` +
          `กรุณาแนะนำ agenda สำหรับการประชุมครั้งถัดไป โดยผสานหัวข้อหลักเข้ากับประเด็นค้างข้างต้น`,
      },
    ],
  });

  return textFrom(response);
}

export interface TaskForScheduling {
  id: string;
  title: string;
  priority: string;
  dueDate: Date | null;
  status: string;
  projectName: string | null;
}

/** Suggests a priority order / working schedule for a user's open action items. */
export async function generateTaskSchedule(tasks: TaskForScheduling[]): Promise<string> {
  const anthropic = getClient();

  const taskList = tasks
    .map(
      (t, i) =>
        `${i + 1}. [${t.priority}] ${t.title} — สถานะ: ${t.status}${
          t.dueDate ? `, กำหนดส่ง: ${t.dueDate.toLocaleDateString("th-TH")}` : ""
        }${t.projectName ? `, โปรเจกต์: ${t.projectName}` : ""}`
    )
    .join("\n");

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1200,
    system:
      "คุณเป็นผู้ช่วยจัดลำดับความสำคัญของงาน (action items) สำหรับผู้ใช้คนหนึ่งในระบบ Smart Meeting " +
      "วิเคราะห์รายการงานที่ได้รับ แล้วเสนอลำดับการทำงานที่แนะนำ พร้อมเหตุผลสั้นๆ ต่อรายการ " +
      "โดยพิจารณาจากกำหนดส่ง ความสำคัญ (priority) และสถานะปัจจุบัน ตอบเป็นภาษาไทย รูปแบบลิสต์ลำดับเลข",
    messages: [
      {
        role: "user",
        content: `นี่คือรายการงานที่ยังไม่เสร็จของฉัน กรุณาช่วยจัดลำดับว่าควรทำอะไรก่อนหลัง:\n\n${taskList}`,
      },
    ],
  });

  return textFrom(response);
}
