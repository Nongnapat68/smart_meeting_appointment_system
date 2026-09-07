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
        title: "รองศาสตราจารย์ ดร. (หัวหน้าภาควิชา)",
        department: "ภาควิชาวิศวกรรมคอมพิวเตอร์ คณะวิศวกรรมศาสตร์",
        phone: "081-234-5678",
        role: "ADMIN",
      },
    }),
    prisma.user.create({
      data: {
        email: "siriporn@smartmeeting.dev",
        passwordHash,
        name: "ศิริพร ใจดี",
        title: "ผู้ช่วยศาสตราจารย์ ดร. (รองคณบดีฝ่ายวิจัย)",
        department: "คณะวิศวกรรมศาสตร์",
        phone: "081-234-5679",
      },
    }),
    prisma.user.create({
      data: {
        email: "wichai@smartmeeting.dev",
        passwordHash,
        name: "วิชัย พงษ์สวัสดิ์",
        title: "อาจารย์ประจำภาควิชา",
        department: "ภาควิชาวิศวกรรมคอมพิวเตอร์",
        phone: "081-234-5680",
      },
    }),
    prisma.user.create({
      data: {
        email: "narin@smartmeeting.dev",
        passwordHash,
        name: "นรินทร์ ชัยเจริญ",
        title: "ผู้ช่วยวิจัย (Research Assistant)",
        department: "ห้องปฏิบัติการวิจัย AI Lab",
        phone: "081-234-5681",
      },
    }),
    prisma.user.create({
      data: {
        email: "kittichai@smartmeeting.dev",
        passwordHash,
        name: "กิตติชัย นามดี",
        title: "เจ้าหน้าที่สนับสนุนระบบสารสนเทศ",
        department: "สำนักคอมพิวเตอร์",
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
  // Third external contact (สมทรง แซ่ตั้ง) is created here too but never
  // referenced afterward by name — left out of the destructure rather than
  // bound to an unused variable; Promise.all still awaits and creates it.
  const [pVichit, pSomying] = await Promise.all([
    prisma.person.create({
      data: {
        name: "วิชิต พงษ์สวัสดิ์",
        email: "wichit@partner-univ.ac.th",
        title: "ผู้ทรงคุณวุฒิภายนอก (อาจารย์ประจำสถาบันพันธมิตร)",
        department: "มหาวิทยาลัยพันธมิตร",
        type: "EXTERNAL",
        status: "ACTIVE",
      },
    }),
    prisma.person.create({
      data: {
        name: "สมหญิง รักการงาน",
        email: "somying@example.com",
        title: "นักวิจัยรับเชิญ (Visiting Researcher)",
        type: "EXTERNAL",
        status: "ACTIVE",
      },
    }),
    prisma.person.create({
      data: {
        name: "สมทรง แซ่ตั้ง",
        email: "somsong.s@example.com",
        title: "อดีตผู้ช่วยวิจัย",
        department: "ภาควิชาวิศวกรรมคอมพิวเตอร์",
        type: "INTERNAL",
        status: "INACTIVE",
      },
    }),
  ]);

  // --- Students (FR-02: "กลุ่มนักศึกษา" needs actual student contacts) ---
  const [pPiya, pArunee] = await Promise.all([
    prisma.person.create({
      data: {
        name: "ปิยะ วงศ์สุข",
        email: "piya.w@example.com",
        title: "นักศึกษาปริญญาโท",
        department: "ภาควิชาวิศวกรรมคอมพิวเตอร์",
        type: "EXTERNAL",
        status: "ACTIVE",
      },
    }),
    prisma.person.create({
      data: {
        name: "อรุณี ทองแท้",
        email: "arunee.t@example.com",
        title: "นักศึกษาปริญญาเอก",
        department: "ภาควิชาวิศวกรรมคอมพิวเตอร์",
        type: "EXTERNAL",
        status: "ACTIVE",
      },
    }),
  ]);

  // --- Contact groups ---
  // Covers every example group FR-02 lists: ทีมโครงการ, คณะกรรมการ, กลุ่มอาจารย์,
  // กลุ่มนักศึกษา, ทีมวิจัย.
  const researchGroup = await prisma.contactGroup.create({
    data: {
      name: "ทีมวิจัย AI Lab",
      description: "กลุ่มสำหรับประสานงานและวางแผนงานวิจัยของ AI Lab",
      icon: "science",
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
      name: "ทีมโครงงานนักศึกษา A",
      description: "ทีมงานหลักของโครงงานวิจัย ระบบผู้ช่วย AI สำหรับการเตรียมประชุม",
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
      name: "คณะกรรมการบริหารหลักสูตร",
      description: "คณะกรรมการสำหรับการตัดสินใจด้านหลักสูตรและวิชาการของภาควิชา",
      icon: "gavel",
      createdById: somchai.id,
      members: { create: [{ personId: pSomchai.id, role: "LEADER" }, { personId: pVichit.id, role: "MEMBER" }] },
    },
  });
  await prisma.contactGroup.create({
    data: {
      name: "กลุ่มอาจารย์ภาควิชาวิศวกรรมคอมพิวเตอร์",
      description: "รวมอาจารย์ประจำภาควิชาสำหรับนัดประชุมภาควิชา",
      icon: "school",
      createdById: somchai.id,
      members: {
        create: [
          { personId: pSomchai.id, role: "LEADER" },
          { personId: pSiriporn.id, role: "MEMBER" },
          { personId: pWichai.id, role: "MEMBER" },
        ],
      },
    },
  });
  await prisma.contactGroup.create({
    data: {
      name: "กลุ่มนักศึกษาระดับบัณฑิตศึกษา",
      description: "นักศึกษาปริญญาโท-เอกที่อยู่ภายใต้การดูแลของทีมวิจัย",
      icon: "groups",
      createdById: siriporn.id,
      members: {
        create: [
          { personId: pPiya.id, role: "LEADER" },
          { personId: pArunee.id, role: "MEMBER" },
        ],
      },
    },
  });
  await prisma.contactGroup.create({
    data: {
      name: "กลุ่มผู้บริหารคณะ",
      description: "รวมผู้บริหารระดับคณะ/ภาควิชาสำหรับการประชุมเชิงนโยบายและบริหารจัดการ",
      icon: "supervisor_account",
      createdById: siriporn.id,
      members: {
        create: [
          { personId: pSiriporn.id, role: "LEADER" },
          { personId: pSomchai.id, role: "MEMBER" },
        ],
      },
    },
  });

  // --- Projects ---
  const researchProject = await prisma.project.create({
    data: {
      name: "งานวิจัย: ระบบผู้ช่วย AI สำหรับการเตรียมประชุม",
      description:
        "การพัฒนาและทดสอบระบบ AI ที่ช่วยเตรียมข้อมูลก่อนการประชุมสำหรับงานวิจัยที่มีบริบทต่อเนื่อง เพื่อรองรับการต่อยอดผลงานในปีถัดไป จำเป็นต้องประสานงานกับทุกฝ่ายที่เกี่ยวข้อง",
      status: "ACTIVE",
      startDate: new Date("2024-07-01"),
      endDate: new Date("2024-12-31"),
      managerId: somchai.id,
      members: { create: [{ personId: pSomchai.id }, { personId: pWichai.id }, { personId: pKittichai.id }] },
    },
  });
  const aiLabProject = await prisma.project.create({
    data: {
      name: "โครงการทุนวิจัย AI Lab ปี 2569",
      description:
        "โครงการวิจัยที่ได้รับทุนสนับสนุนประจำปี 2569 มุ่งเน้นการพัฒนาและทดสอบต้นแบบระบบ พร้อมเผยแพร่ผลงานสู่วารสารวิชาการภายในปีงบประมาณ",
      status: "ACTIVE",
      startDate: new Date("2024-07-01"),
      endDate: new Date("2024-09-30"),
      managerId: siriporn.id,
      members: { create: [{ personId: pSiriporn.id }, { personId: pSomying.id }, { personId: pNarin.id }] },
    },
  });
  await prisma.project.create({
    data: {
      name: "ปรับปรุงเว็บไซต์ภาควิชาวิศวกรรมคอมพิวเตอร์",
      description: "ปรับปรุงหน้าเว็บไซต์หลักของภาควิชาให้ทันสมัย รองรับการใช้งานบนมือถือมากขึ้น",
      status: "PENDING",
      managerId: wichai.id,
      members: { create: [{ personId: pWichai.id }] },
    },
  });
  await prisma.project.create({
    data: {
      name: "ตรวจสอบความปลอดภัยระบบสารสนเทศ ปี 2567",
      description: "ตรวจสอบความปลอดภัยของระบบโครงสร้างพื้นฐานทั้งหมดของภาควิชา (ติดปัญหาเอกสาร)",
      status: "DELAYED",
      managerId: kittichai.id,
      members: { create: [{ personId: pKittichai.id }] },
    },
  });

  const now = new Date();
  const days = (n: number) => new Date(now.getTime() + n * 24 * 60 * 60 * 1000);
  const hours = (base: Date, h: number) => new Date(base.getTime() + h * 60 * 60 * 1000);

  // --- Reusable online meeting links (FR-07/BR-09/BR-10) ---
  // Two meetings below point at `googleMeetPartner` to demonstrate reuse: editing
  // its name/url in one place would update both, and neither meeting stores its
  // own copy of the URL.
  const zoomRoomB = await prisma.onlineMeetingResource.create({
    data: { name: "Zoom Room B — ทีมวิจัย AI Lab", url: "https://zoom.us/j/1234567890", createdById: siriporn.id },
  });
  const googleMeetPartner = await prisma.onlineMeetingResource.create({
    data: {
      name: "Google Meet — ความร่วมมือกับสถาบันพันธมิตร",
      url: "https://meet.google.com/abc-defg-hij",
      createdById: siriporn.id,
    },
  });

  // --- Meetings ---
  const pastMeeting = await prisma.meeting.create({
    data: {
      title: "ประชุมเริ่มต้นโครงการวิจัย (Kickoff)",
      description: "ประชุมวางแผนเริ่มต้นงานวิจัยและกำหนดเป้าหมาย",
      type: "PROJECT",
      status: "COMPLETED",
      startTime: days(-30),
      endTime: hours(days(-30), 1.5),
      location: "ห้องประชุมภาควิชา ชั้น 4",
      organizerId: somchai.id,
      organizerPersonId: pSomchai.id,
      projectId: researchProject.id,
      participants: {
        create: [
          { personId: pSomchai.id, role: "ORGANIZER", rsvpStatus: "ACCEPTED", source: "DIRECT" },
          // These two came in because "ทีมโครงงานนักศึกษา A" was added wholesale —
          // demonstrates BR-04's source tracking (GROUP + which group).
          { personId: pWichai.id, role: "ATTENDEE", rsvpStatus: "ACCEPTED", source: "GROUP", sourceGroupId: projectTeamGroup.id },
          { personId: pKittichai.id, role: "ATTENDEE", rsvpStatus: "ACCEPTED", source: "GROUP", sourceGroupId: projectTeamGroup.id },
        ],
      },
    },
  });

  const activeMeeting = await prisma.meeting.create({
    data: {
      title: "ประชุมความคืบหน้างานวิจัย AI Lab และพิจารณางบประมาณ",
      description:
        "1. ทบทวนงบประมาณทุนวิจัยระยะที่ 1\n2. ตรวจสอบความคืบหน้าการเก็บข้อมูลเทียบกับแผน\n3. หารือแผนการตีพิมพ์ผลงานสำหรับไตรมาสหน้า",
      type: "PROJECT",
      status: "ACTIVE",
      startTime: days(2),
      endTime: hours(days(2), 1.5),
      onlineMeetingResourceId: zoomRoomB.id,
      organizerId: siriporn.id,
      organizerPersonId: pSiriporn.id,
      projectId: aiLabProject.id,
      participants: {
        create: [
          { personId: pSiriporn.id, role: "ORGANIZER", rsvpStatus: "ACCEPTED", source: "DIRECT" },
          { personId: pSomying.id, role: "ATTENDEE", rsvpStatus: "ACCEPTED", source: "GROUP", sourceGroupId: researchGroup.id },
          { personId: pNarin.id, role: "ATTENDEE", rsvpStatus: "PENDING", source: "GROUP", sourceGroupId: researchGroup.id },
          // Illustrates the EXTERNAL source: added by typing their address into
          // "อีเมลภายนอก" rather than picked from the directory or a group.
          { personId: pVichit.id, role: "ATTENDEE", rsvpStatus: "PENDING", source: "EXTERNAL" },
        ],
      },
    },
  });

  await prisma.meeting.create({
    data: {
      title: "ประชุมทีมพัฒนาระบบ AI Lab ประจำสัปดาห์",
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
      title: "ประชุมหารือความร่วมมือวิจัยกับสถาบันพันธมิตร",
      description: "แนะนำระบบและกระบวนการทำงานให้กับสถาบันพันธมิตรใหม่",
      type: "SINGLE",
      status: "PENDING",
      startTime: days(4),
      endTime: hours(days(4), 1),
      onlineMeetingResourceId: googleMeetPartner.id,
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

  // Second meeting reusing `googleMeetPartner` — same link, independent record,
  // proving reuse doesn't require copy-pasting the URL again (BR-09).
  await prisma.meeting.create({
    data: {
      title: "ประชุมทบทวนบันทึกข้อตกลงความร่วมมือ (MOU) ประจำไตรมาส",
      description: "ทบทวนเงื่อนไข MOU และข้อตกลงการวิจัยร่วมกับสถาบันพันธมิตรก่อนต่ออายุ",
      type: "SINGLE",
      status: "PENDING",
      startTime: days(9),
      endTime: hours(days(9), 1),
      onlineMeetingResourceId: googleMeetPartner.id,
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
      title: "วางแผน Sprint การออกแบบเว็บไซต์ภาควิชา",
      description: "วางแผน sprint การออกแบบสำหรับปรับปรุงเว็บไซต์ภาควิชาวิศวกรรมคอมพิวเตอร์",
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
        content: "ทีมเห็นตรงกันว่าจะเริ่มเก็บข้อมูลชุดแรกของงานวิจัยในเดือนหน้า โดยเริ่มจากกลุ่มตัวอย่างนักศึกษาปีที่ 4 ก่อน",
        authorId: somchai.id,
      },
      {
        meetingId: pastMeeting.id,
        content: "วิชัยรับผิดชอบเตรียมแผนการเก็บและเตรียมข้อมูล (Data Preparation Plan) เบื้องต้น ส่งภายในสัปดาห์หน้า",
        authorId: somchai.id,
      },
    ],
  });

  await prisma.decision.createMany({
    data: [
      {
        meetingId: pastMeeting.id,
        content: "อนุมัติงบประมาณระยะที่ 1 ของโครงการวิจัยที่ 250,000 บาท",
        decidedById: somchai.id,
      },
      {
        meetingId: pastMeeting.id,
        content: "เลือกใช้แพลตฟอร์ม Cloud เดิม (AWS) สำหรับจัดเก็บข้อมูลวิจัย แทนการเปลี่ยนผู้ให้บริการ",
        decidedById: somchai.id,
      },
    ],
  });

  await prisma.relatedResource.createMany({
    data: [
      {
        meetingId: pastMeeting.id,
        title: "แผนงานวิจัย (Research Master Plan)",
        url: "https://drive.example.com/research-master-plan",
        type: "DOCUMENT",
        addedById: somchai.id,
      },
      {
        meetingId: activeMeeting.id,
        title: "แนวทางการเขียนรายงานวิจัยประจำไตรมาส",
        url: "https://drive.example.com/research-report-guideline-q3",
        type: "DOCUMENT",
        addedById: siriporn.id,
      },
      {
        meetingId: activeMeeting.id,
        title: "Dashboard ความคืบหน้าการเก็บข้อมูลวิจัย Real-time",
        url: "https://dashboard.example.com/research-progress",
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
        "สรุปประเด็นต่อเนื่องสำหรับงานวิจัย AI Lab:\n\n" +
        "1. สถานะงานค้าง (Pending Tasks):\n" +
        "- ทีมเก็บข้อมูลต้องส่งมอบชุดข้อมูลทดสอบชุดที่ 2 ภายในวันพรุ่งนี้\n" +
        "- การสรุปรายชื่อผู้เชี่ยวชาญที่จะเชิญร่วม Peer Review ยังอยู่ระหว่างดำเนินการ\n\n" +
        "2. ประเด็นที่ควรพิจารณา (Related Issues):\n" +
        "- งบประมาณสำหรับงานวิจัยในไตรมาสหน้ายังไม่ได้รับการอนุมัติ\n" +
        "- ควรติดตามความคืบหน้ากับทีมพัฒนาเรื่องต้นแบบระบบที่อาจล่าช้า",
      sources: JSON.stringify([{ label: "ตรวจสอบและยืนยันชุดข้อมูลทดสอบชุดที่ 2", refType: "task", refId: "seed" }]),
    },
  });

  // --- Tasks ---
  await prisma.task.create({
    data: {
      title: "เตรียมเอกสารประกอบการขอทุนวิจัยเพิ่มเติม",
      description: "รวบรวมข้อมูลผลการทดลองจากไตรมาสที่ผ่านมาและจัดทำเป็น Presentation 15 หน้า เน้นย้ำผลลัพธ์เบื้องต้นที่ได้",
      status: "IN_PROGRESS",
      priority: "HIGH",
      dueDate: days(4),
      assigneeId: somchai.id,
      assigneePersonId: pSomchai.id,
      createdById: siriporn.id,
      projectId: aiLabProject.id,
      meetingId: activeMeeting.id,
      comments: {
        create: [
          { authorId: siriporn.id, content: "ผมได้อัปโหลดข้อมูลดิบเบื้องต้นจากฝั่งเก็บข้อมูลไว้ใน Shared Drive โฟลเดอร์ Q3_RawData แล้วนะครับ" },
          { authorId: somchai.id, content: "รับทราบครับ กำลังดำเนินการรวบรวมและจะส่งดราฟแรกให้ตรวจสอบภายในพรุ่งนี้เช้าครับ" },
        ],
      },
    },
  });

  await prisma.task.create({
    data: {
      title: "ตรวจสอบและยืนยันชุดข้อมูลทดสอบชุดที่ 2",
      description: "ตรวจสอบและยืนยันความถูกต้องของชุดข้อมูลก่อนเริ่มการทดลองรอบถัดไป",
      status: "NOT_STARTED",
      priority: "HIGH",
      dueDate: days(-2), // overdue
      assigneeId: siriporn.id,
      assigneePersonId: pSiriporn.id,
      createdById: siriporn.id,
      projectId: aiLabProject.id,
    },
  });

  await prisma.task.create({
    data: {
      title: "สรุปรายชื่อผู้เชี่ยวชาญสำหรับเชิญ Peer Review",
      status: "NOT_STARTED",
      priority: "MEDIUM",
      dueDate: days(-1), // overdue
      assigneeId: siriporn.id,
      assigneePersonId: pSiriporn.id,
      createdById: siriporn.id,
      projectId: aiLabProject.id,
    },
  });

  await prisma.task.create({
    data: {
      title: "ทบทวนบันทึกข้อตกลงความร่วมมือ (MOU) กับสถาบันพันธมิตร",
      description: "ตรวจสอบเงื่อนไขข้อตกลงฉบับใหม่ที่งานนิติการมหาวิทยาลัยเพิ่งส่งมา เพื่อเตรียมสำหรับการต่ออายุปีหน้า",
      status: "NOT_STARTED",
      priority: "MEDIUM",
      dueDate: days(6),
      assigneeId: wichai.id,
      assigneePersonId: pWichai.id,
      createdById: somchai.id,
      projectId: researchProject.id,
    },
  });

  await prisma.task.create({
    data: {
      title: "สัมภาษณ์ผู้สมัครทุนผู้ช่วยวิจัย (Research Assistant)",
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
      title: "สรุปงบประมาณไตรมาส 4",
      description: "จาก: ประชุมวางแผนประจำไตรมาส",
      status: "IN_PROGRESS",
      priority: "HIGH",
      dueDate: days(-3), // overdue
      assigneeId: somchai.id,
      assigneePersonId: pSomchai.id,
      createdById: somchai.id,
      projectId: researchProject.id,
    },
  });

  await prisma.task.create({
    data: {
      title: "ส่งมอบเอกสาร API ให้ทีมทดสอบระบบ",
      status: "COMPLETED",
      priority: "MEDIUM",
      dueDate: days(-10),
      completedAt: days(-9),
      assigneeId: wichai.id,
      assigneePersonId: pWichai.id,
      createdById: somchai.id,
      projectId: researchProject.id,
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
      status: "PENDING",
    },
  });
  await prisma.reminder.create({
    data: {
      meetingId: activeMeeting.id,
      scheduledAt: hours(days(2), -0.5),
      status: "PENDING",
    },
  });
  await prisma.reminder.create({
    data: {
      meetingId: pastMeeting.id,
      scheduledAt: hours(days(-30), -0.5),
      status: "SENT",
      sentAt: hours(days(-30), -0.5),
      retryCount: 1,
    },
  });
  await prisma.reminder.create({
    data: {
      meetingId: cancelledMeeting.id,
      scheduledAt: hours(days(-2), -0.5),
      status: "FAILED",
      failureReason: "ไม่สามารถเชื่อมต่อผู้ให้บริการอีเมลได้ (SMTP timeout)",
      retryCount: 2,
    },
  });
  await prisma.reminder.create({
    data: {
      meetingId: cancelledMeeting.id,
      scheduledAt: hours(days(-2), -1),
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
        body: "เตรียมเอกสารประกอบการขอทุนวิจัยเพิ่มเติม",
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
