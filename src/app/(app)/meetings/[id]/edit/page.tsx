import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { MeetingForm } from "@/components/meetings/MeetingForm";
import { getCurrentUser } from "@/lib/auth";
import { canEditMeeting } from "@/lib/permissions";

export default async function EditMeetingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const meeting = await prisma.meeting.findUnique({
    where: { id },
    include: { participants: { include: { person: true } }, groups: true },
  });
  if (!meeting) notFound();

  // N12: the page used to hand the full edit form to any signed-in user who
  // could reach the URL, including fellow attendees — saving then failed deep
  // inside update_meeting_with_participants()'s own organizer check. Follows
  // the "update_organizer_or_admin" RLS policy the save itself goes through
  // (see src/lib/permissions.ts), and sends them back to the read-only
  // meeting page instead of a form they cannot submit.
  const user = await getCurrentUser();
  if (!canEditMeeting(meeting, user)) redirect(`/meetings/${meeting.id}`);

  // A cancelled meeting is kept only as history (its reminders are already
  // cancelled by trg_cancel_meeting_reminders and MeetingActions.tsx hides
  // edit/reschedule/cancel once status is CANCELLED). This page is still
  // reachable by URL, so guard it here too and send the user back to the
  // read-only detail page instead of an editable form.
  if (meeting.status === "CANCELLED") redirect(`/meetings/${meeting.id}`);

  return <MeetingForm initial={{ meeting }} />;
}
