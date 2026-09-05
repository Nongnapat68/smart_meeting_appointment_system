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
