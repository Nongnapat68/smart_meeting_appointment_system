/**
 * N12 — client-side permission checks that mirror the live RLS policies
 * exactly, so the UI stops offering buttons that the database is going to
 * refuse anyway.
 *
 * These are NOT the security boundary: every one of these writes goes through
 * supabase-js as the signed-in user, so the matching RLS policy is what
 * actually allows or blocks it. Hiding a button is about not showing people a
 * door that leads nowhere (and not making them think an action they can't
 * perform is available) — if a check here is ever out of sync with its
 * policy, the write is still refused by the database.
 *
 * Each function names the policy it mirrors so the pair stays easy to audit.
 */

/**
 * The caller's identity as far as these checks care. Deliberately loose:
 * `useCurrentUser()` (client components, role: string from /api/auth/me) and
 * a full Prisma `User` row (server components) both satisfy it, so pages can
 * use whichever source they already have. `role` stays `string` rather than
 * the `UserRole` enum because the /api/auth/me payload is not enum-typed.
 */
export type PermissionUser = { id: string; role: string };

/** admin-or-self, the shape every policy uses via public.is_admin(). */
function isAdmin(user: PermissionUser | null): boolean {
  return user?.role === "ADMIN";
}

/**
 * Mirrors "update_organizer_or_admin" on "Meeting" (and therefore the cancel
 * button, which is a status UPDATE): only the organizer or an admin.
 */
export function canEditMeeting(meeting: { organizerId: string | null }, user: PermissionUser | null): boolean {
  if (!user) return false;
  return isAdmin(user) || meeting.organizerId === user.id;
}

/**
 * Mirrors "update_unlinked_or_owner_or_admin" on "Person": an unlinked
 * contact (userId NULL, i.e. an external person with no login) may be edited
 * by anyone, a linked one only by its owner or an admin.
 */
export function canEditPerson(person: { userId: string | null }, user: PermissionUser | null): boolean {
  if (!user) return false;
  return isAdmin(user) || person.userId === null || person.userId === user.id;
}

/**
 * Mirrors "delete_admin_only" on "Person": contacts are shared records that
 * other people's meeting history points at (MeetingParticipant.personId is
 * ON DELETE RESTRICT), so deleting one is an admin-only operation.
 */
export function canDeletePerson(user: PermissionUser | null): boolean {
  return isAdmin(user);
}

/**
 * Who may manage a contact group and its membership: mirrors the
 * "update_creator_or_admin" / "delete_creator_or_admin" policies on
 * "ContactGroup" and "insert_group_creator_or_admin" /
 * "delete_group_creator_or_admin" on "ContactGroupMember" — all four use the
 * same rule, so one check covers adding a member, removing a member and
 * deleting the group.
 */
export function canManageGroup(group: { createdById: string | null }, user: PermissionUser | null): boolean {
  if (!user) return false;
  return isAdmin(user) || group.createdById === user.id;
}

/**
 * Mirrors the narrowed "update_author_or_organizer_or_admin" /
 * "delete_author_or_organizer_or_admin" policies on "MeetingNote": only an
 * admin, the meeting's organizer, or the note's own author may edit or delete
 * it. The same rule governs both, so one check covers both buttons.
 */
export function canEditMeetingNote(
  note: { authorId: string | null },
  meeting: { organizerId: string | null },
  user: PermissionUser | null
): boolean {
  if (!user) return false;
  return isAdmin(user) || meeting.organizerId === user.id || note.authorId === user.id;
}

/**
 * Mirrors the narrowed "update_author_or_organizer_or_admin" /
 * "delete_author_or_organizer_or_admin" policies on "Decision": an admin, the
 * meeting's organizer, or the decision's own author.
 */
export function canEditDecision(
  decision: { decidedById: string | null },
  meeting: { organizerId: string | null },
  user: PermissionUser | null
): boolean {
  if (!user) return false;
  return isAdmin(user) || meeting.organizerId === user.id || decision.decidedById === user.id;
}

/**
 * Mirrors the narrowed "update_author_or_organizer_or_admin" /
 * "delete_author_or_organizer_or_admin" policies on "RelatedResource": an
 * admin, the meeting's organizer, or the resource's own author.
 */
export function canEditRelatedResource(
  resource: { addedById: string | null },
  meeting: { organizerId: string | null },
  user: PermissionUser | null
): boolean {
  if (!user) return false;
  return isAdmin(user) || meeting.organizerId === user.id || resource.addedById === user.id;
}
