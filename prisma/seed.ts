/* eslint-disable no-console */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const DEMO_PASSWORD = "Passw0rd!";

async function hash(pw: string) {
  return bcrypt.hash(pw, 10);
}

async function main() {
  console.log("🌱 Seeding database...");

  // Clean slate — order matters because of FK constraints.
  await prisma.notification.deleteMany();
  await prisma.aISummary.deleteMany();
  await prisma.reminder.deleteMany();
  await prisma.meetingNote.deleteMany();
  await prisma.decision.deleteMany();
  await prisma.relatedResource.deleteMany();
  await prisma.taskAttachment.deleteMany();
  await prisma.taskComment.deleteMany();
  await prisma.task.deleteMany();
  await prisma.meetingParticipant.deleteMany();
  await prisma.meeting.deleteMany();
  await prisma.onlineMeetingResource.deleteMany();
  await prisma.projectMember.deleteMany();
  await prisma.project.deleteMany();
  await prisma.contactGroupMember.deleteMany();
  await prisma.contactGroup.deleteMany();
  await prisma.passwordResetOtp.deleteMany();
  await prisma.person.deleteMany();
  await prisma.user.deleteMany();

  const passwordHash = await hash(DEMO_PASSWORD);

  // --- Users (+ linked Person records so they can be invited like anyone else) ---
  const [somchai, siriporn, wichai, narin, kittichai] = await Promise.all([
    prisma.user.create({
      data: {
        email: "somchai@smartmeeting.dev",
        passwordHash,
        name: "สมชาย ใจดี",
        title: "Senior Product Manager",
        department: "Product & Engineering",
        phone: "081-234-5678",
        role: "ADMIN",
      },
    }),
    prisma.user.create({
      data: {
        email: "siriporn@smartmeeting.dev",
        passwordHash,
        name: "ศิริพร ใจดี",
        title: "ผู้อำนวยการฝ่ายการตลาด",
        department: "การตลาดและสื่อสารองค์กร",
        phone: "081-234-5679",
      },
    }),
    prisma.user.create({
      data: {
        email: "wichai@smartmeeting.dev",
        passwordHash,
        name: "วิชัย พงษ์สวัสดิ์",
        title: "Lead Designer",
        department: "Design",
        phone: "081-234-5680",
      },
    }),
    prisma.user.create({
      data: {
        email: "narin@smartmeeting.dev",
        passwordHash,
        name: "นรินทร์ ชัยเจริญ",
        title: "Sr. Graphic Designer",
        department: "Design",
        phone: "081-234-5681",
      },
    }),
    prisma.user.create({
      data: {
        email: "kittichai@smartmeeting.dev",
        passwordHash,
        name: "กิตติชัย นามดี",
        title: "IT Support",
        department: "ไอที",
        phone: "081-234-5682",
      },
    }),
  ]);

  const internalUsers = [somchai, siriporn, wichai, narin, kittichai];
  const internalPeople = await Promise.all(
    internalUsers.map((u) =>
      prisma.person.create({
        data: {
          userId: u.id,
          name: u.name,
          email: u.email,
          phone: u.phone,
          title: u.title,
          department: u.department,
          type: "INTERNAL",
          status: "ACTIVE",
        },
      })
    )
  );
  const [pSomchai, pSiriporn, pWichai, pNarin, pKittichai] = internalPeople;

  // --- External contacts ---
  const [pVichit, pSomying, pSomsong] = await Promise.all([
    prisma.person.create({
      data: {
        name: "วิชิต พงษ์สวัสดิ์",
        email: "wichit@partnercorp.com",
        title: "Account Director",
        department: "Partner Corp",
        type: "EXTERNAL",
        status: "ACTIVE",
      },
    }),
    prisma.person.create({
      data: {
        name: "สมหญิง รักการงาน",
        email: "somying@example.com",
        title: "Marketing Director",
        type: "EXTERNAL",
        status: "ACTIVE",
      },
    }),
    prisma.person.create({
      data: {
        name: "สมทรง แซ่ตั้ง",
        email: "somsong.s@company.com",
        title: "Sales Executive",
        department: "การตลาด",
        type: "INTERNAL",
        status: "INACTIVE",
      },
    }),
  ]);

  // --- Contact groups ---
  const marketingGroup = await prisma.contactGroup.create({
    data: {
      name: "ทีมการตลาด Q3",
      description: "กลุ่มสำหรับประสานงานและวางแผนแคมเปญการตลาดสำหรับไตรมาสที่ 3",
      icon: "campaign",
      createdById: somchai.id,
      members: {
        create: [
          { personId: pSiriporn.id, role: "LEADER" },
          { personId: pSomying.id, role: "MEMBER" },
          { personId: pNarin.id, role: "MEMBER" },
        ],
      },
    },
  });
  const projectTeamGroup = await prisma.contactGroup.create({
    data: {
      name: "ทีมโครงการ A",
      description: "ทีมงานหลักของโครงการ Enterprise Resource Planning Migration",
      icon: "work",
      createdById: somchai.id,
      members: {
        create: [
          { personId: pSomchai.id, role: "LEADER" },
          { personId: pWichai.id, role: "MEMBER" },
          { personId: pKittichai.id, role: "MEMBER" },
        ],
      },
    },
  });
  await prisma.contactGroup.create({
    data: {
      name: "คณะกรรมการ",
      description: "คณะกรรมการบริหารสำหรับการตัดสินใจระดับองค์กร",
      icon: "gavel",
      createdById: somchai.id,
      members: { create: [{ personId: pSomchai.id, role: "LEADER" }, { personId: pVichit.id, role: "MEMBER" }] },
    },
  });

  // --- Projects ---
  const erpProject = await prisma.project.create({
    data: {
      name: "Enterprise Resource Planning (ERP) Migration",
      description:
        "การย้ายระบบ ERP เดิมไปสู่ระบบ Cloud รูปแบบใหม่ เพื่อรองรับการขยายตัวของธุรกิจในปีหน้า จำเป็นต้องประสานงานกับทุกแผนก",
      status: "ACTIVE",
      startDate: new Date("2024-07-01"),
      endDate: new Date("2024-12-31"),
      managerId: somchai.id,
      members: { create: [{ personId: pSomchai.id }, { personId: pWichai.id }, { personId: pKittichai.id }] },
    },
  });
  const marketingProject = await prisma.project.create({
    data: {
      name: "Q3 Marketing Campaign: Product Launch",
      description:
        "แคมเปญการตลาดสำหรับไตรมาสที่ 3 เพื่อเปิดตัวผลิตภัณฑ์ใหม่ มุ่งเน้นการสร้างการรับรู้แบรนด์ในกลุ่มเป้าหมาย Gen Z และการกระตุ้นยอดขายผ่านช่องทางออนไลน์",
      status: "ACTIVE",
      startDate: new Date("2024-07-01"),
      endDate: new Date("2024-09-30"),
      managerId: siriporn.id,
      members: { create: [{ personId: pSiriporn.id }, { personId: pSomying.id }, { personId: pNarin.id }] },
    },
  });
  await prisma.project.create({
    data: {
      name: "Corporate Website Redesign",
      description: "ปรับปรุงหน้าเว็บไซต์หลักของบริษัทให้ทันสมัย รองรับการใช้งานบนมือถือมากขึ้น",
      status: "PENDING",
      managerId: wichai.id,
      members: { create: [{ personId: pWichai.id }] },
    },
  });
  await prisma.project.create({
    data: {
      name: "Security Audit 2024",
      description: "ตรวจสอบความปลอดภัยของระบบโครงสร้างพื้นฐานทั้งหมด (ติดปัญหาเอกสาร)",
      status: "DELAYED",
      managerId: kittichai.id,
      members: { create: [{ personId: pKittichai.id }] },
    },
  });

  const now = new Date();
  const days = (n: number) => new Date(now.getTime() + n * 24 * 60 * 60 * 1000);
  const hours = (base: Date, h: number) => new Date(base.getTime() + h * 60 * 60 * 1000);

  // --- Reusable online meeting links (FR-07/BR-09/BR-10) ---
  // Two meetings below point at `zoomRoomB` to demonstrate reuse: editing its
  // name/url in one place would update both, and neither meeting stores its
  // own copy of the URL.
  const zoomRoomB = await prisma.onlineMeetingResource.create({
    data: { name: "Zoom Room B — ทีมการตลาด", url: "https://zoom.us/j/1234567890", createdById: siriporn.id },
  });
  const googleMeetSales = await prisma.onlineMeetingResource.create({
    data: { name: "Google Meet — ทีมขาย/พาร์ทเนอร์", url: "https://meet.google.com/abc-defg-hij", createdById: siriporn.id },
  });

  // --- Meetings ---
  const pastMeeting = await prisma.meeting.create({
    data: {
      title: "Project Kickoff",
      description: "ประชุมวางแผนเริ่มต้นโครงการและกำหนดเป้าหมาย",
      type: "PROJECT",
      status: "COMPLETED",
      startTime: days(-30),
      endTime: hours(days(-30), 1.5),
      location: "ห้องประชุมใหญ่ ชั้น 4",
      organizerId: somchai.id,
      organizerPersonId: pSomchai.id,
      projectId: erpProject.id,
      participants: {
        create: [
          { personId: pSomchai.id, role: "ORGANIZER", rsvpStatus: "ACCEPTED", source: "DIRECT" },
          // These two came in because "ทีมโครงการ A" was added wholesale —
          // demonstrates BR-04's source tracking (GROUP + which group).
          { personId: pWichai.id, role: "ATTENDEE", rsvpStatus: "ACCEPTED", source: "GROUP", sourceGroupId: projectTeamGroup.id },
          { personId: pKittichai.id, role: "ATTENDEE", rsvpStatus: "ACCEPTED", source: "GROUP", sourceGroupId: projectTeamGroup.id },
        ],
      },
    },
  });

  const activeMeeting = await prisma.meeting.create({
    data: {
      title: "Q3 Marketing Strategy Alignment & Budget Review",
      description:
        "1. ทบทวนงบประมาณแคมเปญหลัก (Summer Sale & Back to School)\n2. ตรวจสอบยอดผู้ใช้งานใหม่เทียบกับเป้าหมาย\n3. หารือกลยุทธ์สำหรับ Q4",
      type: "PROJECT",
      status: "ACTIVE",
      startTime: days(2),
      endTime: hours(days(2), 1.5),
      onlineMeetingResourceId: zoomRoomB.id,
      organizerId: siriporn.id,
      organizerPersonId: pSiriporn.id,
      projectId: marketingProject.id,
      participants: {
        create: [
          { personId: pSiriporn.id, role: "ORGANIZER", rsvpStatus: "ACCEPTED", source: "DIRECT" },
          { personId: pSomying.id, role: "ATTENDEE", rsvpStatus: "ACCEPTED", source: "GROUP", sourceGroupId: marketingGroup.id },
          { personId: pNarin.id, role: "ATTENDEE", rsvpStatus: "PENDING", source: "GROUP", sourceGroupId: marketingGroup.id },
          // Illustrates the EXTERNAL source: added by typing their address into
          // "อีเมลภายนอก" rather than picked from the directory or a group.
          { personId: pVichit.id, role: "ATTENDEE", rsvpStatus: "PENDING", source: "EXTERNAL" },
        ],
      },
    },
  });

  await prisma.meeting.create({
    data: {
      title: "ประชุมทีมพัฒนาไตรมาส 3",
      description: "ติดตามความคืบหน้า sprint ปัจจุบันและวางแผน sprint ถัดไป",
      type: "SINGLE",
      status: "ACTIVE",
      startTime: days(1),
      endTime: hours(days(1), 1.5),
      location: "ห้องประชุมออนไลน์ A",
      organizerId: somchai.id,
      organizerPersonId: pSomchai.id,
      participants: {
        create: [
          { personId: pSomchai.id, role: "ORGANIZER", rsvpStatus: "ACCEPTED" },
          { personId: pWichai.id, role: "ATTENDEE", rsvpStatus: "ACCEPTED" },
          { personId: pKittichai.id, role: "ATTENDEE", rsvpStatus: "ACCEPTED" },
        ],
      },
    },
  });

  await prisma.meeting.create({
    data: {
      title: "Client Onboarding: Partner Corp",
      description: "แนะนำระบบและกระบวนการทำงานให้กับลูกค้าใหม่",
      type: "SINGLE",
      status: "PENDING",
      startTime: days(4),
      endTime: hours(days(4), 1),
      onlineMeetingResourceId: googleMeetSales.id,
      organizerId: siriporn.id,
      organizerPersonId: pSiriporn.id,
      participants: {
        create: [
          { personId: pSiriporn.id, role: "ORGANIZER", rsvpStatus: "ACCEPTED", source: "DIRECT" },
          { personId: pVichit.id, role: "ATTENDEE", rsvpStatus: "PENDING", source: "EXTERNAL" },
        ],
      },
    },
  });

  // Second meeting reusing `googleMeetSales` — same link, independent record,
  // proving reuse doesn't require copy-pasting the URL again (BR-09).
  await prisma.meeting.create({
    data: {
      title: "Partner Corp — ทบทวนสัญญาประจำไตรมาส",
      description: "ทบทวนเงื่อนไขสัญญาและ SLA กับ Partner Corp ก่อนต่อสัญญา",
      type: "SINGLE",
      status: "PENDING",
      startTime: days(9),
      endTime: hours(days(9), 1),
      onlineMeetingResourceId: googleMeetSales.id,
      organizerId: siriporn.id,
      organizerPersonId: pSiriporn.id,
      participants: {
        create: [
          { personId: pSiriporn.id, role: "ORGANIZER", rsvpStatus: "ACCEPTED", source: "DIRECT" },
          { personId: pVichit.id, role: "ATTENDEE", rsvpStatus: "PENDING", source: "DIRECT" },
        ],
      },
    },
  });

  const cancelledMeeting = await prisma.meeting.create({
    data: {
      title: "Emergency Server Patch Review",
      description: "ตรวจสอบแพตช์ฉุกเฉินสำหรับช่องโหว่ด้านความปลอดภัย",
      type: "SINGLE",
      status: "CANCELLED",
      startTime: days(-2),
      endTime: hours(days(-2), 0.5),
      location: "ห้องประชุม B",
      organizerId: kittichai.id,
      organizerPersonId: pKittichai.id,
      participants: { create: [{ personId: pKittichai.id, role: "ORGANIZER", rsvpStatus: "ACCEPTED" }] },
    },
  });

  await prisma.meeting.create({
    data: {
      title: "UI/UX Design Sprint Planning",
      description: "วางแผน sprint การออกแบบสำหรับ Corporate Website Redesign",
      type: "SINGLE",
      status: "POSTPONED",
      startTime: days(6),
      endTime: hours(days(6), 1),
      location: "ห้องประชุม B",
      organizerId: wichai.id,
      organizerPersonId: pWichai.id,
      participants: {
        create: [
          { personId: pWichai.id, role: "ORGANIZER", rsvpStatus: "ACCEPTED" },
          { personId: pNarin.id, role: "ATTENDEE", rsvpStatus: "PENDING" },
        ],
      },
    },
  });

  // --- Meeting Notes / Decisions / Related Resources (FR-11/12/13, BR-15) ---
  // pastMeeting is COMPLETED, so it carries the kind of post-meeting record
  // these entities exist for: what was discussed, what was decided, and what
  // was shared — several rows each, individually attributed.
  await prisma.meetingNote.createMany({
    data: [
      {
        meetingId: pastMeeting.id,
        content: "ทีมเห็นตรงกันว่าจะเริ่ม Phase 1 ของการย้ายระบบ ERP ในเดือนหน้า โดยเริ่มจากแผนก Finance ก่อน",
        authorId: somchai.id,
      },
      {
        meetingId: pastMeeting.id,
        content: "วิชัยรับผิดชอบเตรียมแผน Data Migration เบื้องต้น ส่งภายในสัปดาห์หน้า",
        authorId: somchai.id,
      },
    ],
  });

  await prisma.decision.createMany({
    data: [
      {
        meetingId: pastMeeting.id,
        content: "อนุมัติงบประมาณเฟส 1 ของโครงการ ERP Migration ที่ 2.5 ล้านบาท",
        decidedById: somchai.id,
      },
      {
        meetingId: pastMeeting.id,
        content: "เลือกใช้ผู้ให้บริการ Cloud รายเดิม (AWS) แทนการเปลี่ยนผู้ให้บริการ",
        decidedById: somchai.id,
      },
    ],
  });

  await prisma.relatedResource.createMany({
    data: [
      {
        meetingId: pastMeeting.id,
        title: "แผนโครงการ ERP Migration (Master Plan)",
        url: "https://drive.example.com/erp-master-plan",
        type: "DOCUMENT",
        addedById: somchai.id,
      },
      {
        meetingId: activeMeeting.id,
        title: "Brand Guideline ผลิตภัณฑ์ใหม่ Q3",
        url: "https://drive.example.com/brand-guideline-q3",
        type: "DOCUMENT",
        addedById: siriporn.id,
      },
      {
        meetingId: activeMeeting.id,
        title: "Dashboard ยอดขาย Real-time",
        url: "https://dashboard.example.com/sales",
        type: "LINK",
        addedById: siriporn.id,
      },
    ],
  });

  // --- AI Summary (pre-generated example, not calling the live API during seed) ---
  await prisma.aISummary.create({
    data: {
      meetingId: activeMeeting.id,
      model: "claude-opus-5",
      content:
        "สรุปประเด็นต่อเนื่องสำหรับ Q3 Marketing Campaign:\n\n" +
        "1. สถานะงานค้าง (Pending Tasks):\n" +
        "- ทีม Design ต้องส่งมอบ Artwork สำหรับ Facebook Ads ภายในวันพรุ่งนี้\n" +
        "- การสรุปรายชื่อ KOLs สำหรับแคมเปญยังอยู่ระหว่างดำเนินการ\n\n" +
        "2. ประเด็นที่ควรพิจารณา (Related Issues):\n" +
        "- งบประมาณสำหรับ Marketing Campaign ในไตรมาสหน้ายังไม่ได้รับการอนุมัติ\n" +
        "- ควรติดตามความคืบหน้ากับทีม Production เรื่องวิดีโอโฆษณาที่อาจล่าช้า",
      sources: JSON.stringify([{ label: "อนุมัติ Artwork สำหรับ Facebook Ads", refType: "task", refId: "seed" }]),
    },
  });

  // --- Tasks ---
  await prisma.task.create({
    data: {
      title: "เตรียมเอกสาร Pitching ลูกค้าใหม่",
      description: "รวบรวมข้อมูลสถิติจากไตรมาสที่ผ่านมาและจัดทำเป็น Presentation 15 หน้า เน้นย้ำเรื่อง ROI ที่คาดหวัง",
      status: "IN_PROGRESS",
      priority: "HIGH",
      dueDate: days(4),
      assigneeId: somchai.id,
      assigneePersonId: pSomchai.id,
      createdById: siriporn.id,
      projectId: marketingProject.id,
      meetingId: activeMeeting.id,
      comments: {
        create: [
          { authorId: siriporn.id, content: "ผมได้อัปโหลดข้อมูลดิบเบื้องต้นจากฝั่งยอดขายไว้ใน Shared Drive โฟลเดอร์ Q3_RawData แล้วนะครับ" },
          { authorId: somchai.id, content: "รับทราบครับ กำลังดำเนินการรวบรวมและจะส่งดราฟแรกให้ตรวจสอบภายในพรุ่งนี้เช้าครับ" },
        ],
      },
    },
  });

  await prisma.task.create({
    data: {
      title: "อนุมัติ Artwork สำหรับ Facebook Ads",
      description: "ตรวจสอบและอนุมัติ Artwork ชุดใหม่ก่อนเริ่มยิงโฆษณา",
      status: "NOT_STARTED",
      priority: "HIGH",
      dueDate: days(-2), // overdue
      assigneeId: siriporn.id,
      assigneePersonId: pSiriporn.id,
      createdById: siriporn.id,
      projectId: marketingProject.id,
    },
  });

  await prisma.task.create({
    data: {
      title: "สรุปรายชื่อ KOLs สำหรับแคมเปญ",
      status: "NOT_STARTED",
      priority: "MEDIUM",
      dueDate: days(-1), // overdue
      assigneeId: siriporn.id,
      assigneePersonId: pSiriporn.id,
      createdById: siriporn.id,
      projectId: marketingProject.id,
    },
  });

  await prisma.task.create({
    data: {
      title: "ทบทวนสัญญาจ้างซัพพลายเออร์",
      description: "ตรวจสอบเงื่อนไข SLA ใหม่ที่ฝ่ายกฎหมายเพิ่งส่งมา เพื่อเตรียมสำหรับการต่อสัญญาปีหน้า",
      status: "NOT_STARTED",
      priority: "MEDIUM",
      dueDate: days(6),
      assigneeId: wichai.id,
      assigneePersonId: pWichai.id,
      createdById: somchai.id,
      projectId: erpProject.id,
    },
  });

  await prisma.task.create({
    data: {
      title: "สัมภาษณ์ผู้สมัครตำแหน่ง Senior Dev",
      status: "IN_PROGRESS",
      priority: "MEDIUM",
      dueDate: days(8),
      assigneeId: somchai.id,
      assigneePersonId: pSomchai.id,
      createdById: somchai.id,
    },
  });

  await prisma.task.create({
    data: {
      title: "สรุปงบประมาณ Q4",
      description: "จาก: ประชุมวางแผนประจำไตรมาส",
      status: "IN_PROGRESS",
      priority: "HIGH",
      dueDate: days(-3), // overdue
      assigneeId: somchai.id,
      assigneePersonId: pSomchai.id,
      createdById: somchai.id,
      projectId: erpProject.id,
    },
  });

  await prisma.task.create({
    data: {
      title: "ส่งมอบ API Docs ให้ทีม QA",
      status: "COMPLETED",
      priority: "MEDIUM",
      dueDate: days(-10),
      completedAt: days(-9),
      assigneeId: wichai.id,
      assigneePersonId: pWichai.id,
      createdById: somchai.id,
      projectId: erpProject.id,
      meetingId: pastMeeting.id,
    },
  });

  // --- Reminders (mix of statuses, tied to real meetings) ---
  // activeMeeting gets two reminders at different offsets — demonstrates
  // BR-11 (a meeting can have more than one reminder), which the create-meeting
  // flow now supports via `reminderOffsetMinutes` instead of always hardcoding
  // a single "30 minutes before" row.
  await prisma.reminder.create({
    data: {
      meetingId: activeMeeting.id,
      scheduledAt: hours(days(2), -24),
      offsetMinutes: 24 * 60,
      status: "PENDING",
    },
  });
  await prisma.reminder.create({
    data: {
      meetingId: activeMeeting.id,
      scheduledAt: hours(days(2), -0.5),
      offsetMinutes: 30,
      status: "PENDING",
    },
  });
  await prisma.reminder.create({
    data: {
      meetingId: pastMeeting.id,
      scheduledAt: hours(days(-30), -0.5),
      offsetMinutes: 30,
      status: "SENT",
      sentAt: hours(days(-30), -0.5),
      retryCount: 1,
    },
  });
  await prisma.reminder.create({
    data: {
      meetingId: cancelledMeeting.id,
      scheduledAt: hours(days(-2), -0.5),
      offsetMinutes: 30,
      status: "FAILED",
      failureReason: "ไม่สามารถเชื่อมต่อผู้ให้บริการอีเมลได้ (SMTP timeout)",
      retryCount: 2,
    },
  });
  await prisma.reminder.create({
    data: {
      meetingId: cancelledMeeting.id,
      scheduledAt: hours(days(-2), -1),
      offsetMinutes: 60,
      status: "CANCELLED",
    },
  });

  // --- Notifications ---
  await prisma.notification.createMany({
    data: [
      {
        userId: siriporn.id,
        type: "MEETING_INVITE",
        title: "คำเชิญเข้าร่วมประชุมใหม่",
        body: activeMeeting.title,
        relatedId: activeMeeting.id,
      },
      {
        userId: somchai.id,
        type: "TASK_ASSIGNED",
        title: "คุณได้รับมอบหมายงานใหม่",
        body: "เตรียมเอกสาร Pitching ลูกค้าใหม่",
        isRead: true,
      },
    ],
  });

  console.log("✅ Seed complete.");
  console.log("");
  console.log("Demo accounts (all use the same password):");
  internalUsers.forEach((u) => console.log(`  - ${u.email}`));
  console.log(`  password: ${DEMO_PASSWORD}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
