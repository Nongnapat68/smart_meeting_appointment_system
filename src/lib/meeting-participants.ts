import { prisma } from "@/lib/prisma";

export interface ResolvedParticipant {
  personId: string;
  source: "DIRECT" | "GROUP" | "EXTERNAL";
  sourceGroupId: string | null;
}

/**
 * Resolves the three participant sources (direct picks, group members, raw
 * external emails) into a deduped list — while still remembering *how* each
 * person got onto the invite (BR-04), unlike a flat `Set<personId>` that
 * would throw that information away.
 *
 * Precedence when the same person appears via more than one source: DIRECT
 * wins over GROUP/EXTERNAL, since an explicit pick is the most specific
 * signal of intent; first-matching group wins if they're in more than one
 * selected group (a participant has exactly one sourceGroupId in this schema).
 *
 * Shared by both `POST /api/meetings` (create) and `PUT /api/meetings/[id]`
 * (edit) so that inviting "ทั้งกลุ่ม" produces the same GROUP-sourced
 * `MeetingParticipant` rows regardless of which endpoint is used.
 */
export async function resolveParticipants(
  personIds: string[],
  groupIds: string[],
  externalEmails: string[]
): Promise<ResolvedParticipant[]> {
  const resolved = new Map<string, ResolvedParticipant>();

  personIds.forEach((personId) => {
    resolved.set(personId, { personId, source: "DIRECT", sourceGroupId: null });
  });

  if (groupIds.length) {
    const memberships = await prisma.contactGroupMember.findMany({
      where: { groupId: { in: groupIds } },
      select: { personId: true, groupId: true },
    });
    memberships.forEach((m) => {
      if (!resolved.has(m.personId)) {
        resolved.set(m.personId, { personId: m.personId, source: "GROUP", sourceGroupId: m.groupId });
      }
    });
  }

  for (const email of externalEmails) {
    const person = await prisma.person.upsert({
      where: { email },
      update: {},
      create: { name: email.split("@")[0], email, type: "EXTERNAL" },
    });
    if (!resolved.has(person.id)) {
      resolved.set(person.id, { personId: person.id, source: "EXTERNAL", sourceGroupId: null });
    }
  }

  return Array.from(resolved.values());
}
