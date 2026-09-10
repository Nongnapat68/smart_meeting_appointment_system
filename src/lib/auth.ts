import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import type { User } from "@prisma/client";

// Login/session/password-verification now go through Supabase Auth (see
// src/lib/supabase/server.ts, src/proxy.ts, and the auth/* + users/me/password
// route handlers). bcrypt is still used here for the OTP flow below, which
// stays hand-rolled on purpose (PasswordResetOtp) — unrelated to how a user's
// account password is verified.

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/** Loads the full current user row, or null if not authenticated / the
 * profile row doesn't exist for an otherwise-valid Supabase session. */
export async function getCurrentUser(): Promise<User | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims) return null;
  return prisma.user.findUnique({ where: { id: data.claims.sub } });
}

/** Finds the most recent unused, unexpired OTP for this email and checks it against `otp`. */
export async function verifyOtpForEmail(
  email: string,
  otp: string
): Promise<{ valid: boolean; userId?: string; otpRecordId?: string }> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return { valid: false };

  const record = await prisma.passwordResetOtp.findFirst({
    where: { userId: user.id, usedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (!record) return { valid: false };

  const matches = await verifyPassword(otp, record.otpHash);
  if (!matches) return { valid: false };

  return { valid: true, userId: user.id, otpRecordId: record.id };
}
