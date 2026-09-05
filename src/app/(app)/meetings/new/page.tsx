import { MeetingForm } from "@/components/meetings/MeetingForm";

export default async function NewMeetingPage({
  searchParams,
}: {
  searchParams: Promise<{ personId?: string; groupId?: string }>;
}) {
  const { personId, groupId } = await searchParams;
  return <MeetingForm prefillPersonId={personId} prefillGroupId={groupId} />;
}
