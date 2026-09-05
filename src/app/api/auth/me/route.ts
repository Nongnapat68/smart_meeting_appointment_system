import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { withApiErrors } from "@/lib/api-helpers";

export const GET = withApiErrors(async () => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ user: null }, { status: 200 });
  return NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      role: user.role,
      title: user.title,
      department: user.department,
    },
  });
});
