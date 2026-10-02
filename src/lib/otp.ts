import { prisma } from "@/lib/prisma";
import { hashPassword, verifyPassword } from "@/lib/auth";
import { generateOtp } from "@/lib/email";

// Password-reset OTP flow (forgot-password → verify-otp → reset-password).
// A 6-digit code has only 10^6 possibilities, so it is only safe together
// with these limits — without them it can be brute-forced in minutes.
export const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes (independent of the UI's 60s resend-cooldown)
export const OTP_MAX_FAILED_ATTEMPTS = 5; // wrong guesses allowed per issued code
export const OTP_REQUEST_WINDOW_MS = 15 * 60 * 1000;
export const OTP_MAX_REQUESTS_PER_WINDOW = 3; // codes issued per user per window
// Daily cap on top of the short window: 3 per 15 min alone still allows
// ~288 codes (≈1,440 guesses) a day against one account; 10 per day caps that
// at 50 guesses.
export const OTP_DAILY_WINDOW_MS = 24 * 60 * 60 * 1000;
export const OTP_MAX_REQUESTS_PER_DAY = 10;

// One message for every failure (wrong, expired, locked out, unknown email)
// so the response can't be used to tell which case applies — or whether the
// email is registered at all.
export const OTP_INVALID_MESSAGE = `รหัส OTP ไม่ถูกต้องหรือหมดอายุแล้ว (หากกรอกผิดเกิน ${OTP_MAX_FAILED_ATTEMPTS} ครั้ง กรุณากดส่งรหัสใหม่)`;

/**
 * Issues a new OTP for `userId` and returns the plaintext code to email, or
 * null if the user already requested OTP_MAX_REQUESTS_PER_WINDOW codes in the
 * last OTP_REQUEST_WINDOW_MS, or OTP_MAX_REQUESTS_PER_DAY in the last
 * OTP_DAILY_WINDOW_MS. Both counts reuse PasswordResetOtp.createdAt
 * (every issued code is a row), so no separate request log is needed.
 */
export async function issuePasswordResetOtp(userId: string): Promise<string | null> {
  const otp = generateOtp();
  // bcrypt is slow on purpose — hash before opening the transaction so the
  // lock below is held for milliseconds, not the whole hash.
  const otpHash = await hashPassword(otp);

  const issued = await prisma.$transaction(async (tx) => {
    // Serializes concurrent requests for the same user so a burst of parallel
    // calls can't all read the same count and slip past the limit. A
    // transaction-scoped advisory lock is released on commit/rollback, so it
    // is safe behind the transaction-mode pooler.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"password-reset-otp:" + userId}))`;

    const now = Date.now();
    // Sequential, not Promise.all: an interactive transaction runs on one connection.
    const recent = await tx.passwordResetOtp.count({
      where: { userId, createdAt: { gt: new Date(now - OTP_REQUEST_WINDOW_MS) } },
    });
    const today = await tx.passwordResetOtp.count({
      where: { userId, createdAt: { gt: new Date(now - OTP_DAILY_WINDOW_MS) } },
    });
    if (recent >= OTP_MAX_REQUESTS_PER_WINDOW || today >= OTP_MAX_REQUESTS_PER_DAY) return false;

    await tx.passwordResetOtp.create({
      data: { userId, otpHash, expiresAt: new Date(Date.now() + OTP_TTL_MS) },
    });
    return true;
  });

  return issued ? otp : null;
}

/**
 * Checks `otp` against the most recent unused, unexpired code for this email.
 * Each wrong guess counts against that code; after OTP_MAX_FAILED_ATTEMPTS it
 * can never succeed again and the user must request a new one.
 */
export async function verifyOtpForEmail(
  email: string,
  otp: string
): Promise<{ valid: boolean; userId?: string; otpRecordId?: string }> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return { valid: false };

  // Deliberately not filtered on attempts: if the newest code is locked out,
  // falling back to an older still-unexpired one would hand out extra guesses.
  const record = await prisma.passwordResetOtp.findFirst({
    where: { userId: user.id, usedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (!record) return { valid: false };

  // Claim an attempt *before* comparing, in one conditional UPDATE: Postgres
  // re-checks `attempts < max` under the row lock, so parallel guesses can't
  // all read the same count and exceed the limit.
  const claimed = await prisma.passwordResetOtp.updateMany({
    where: { id: record.id, usedAt: null, attempts: { lt: OTP_MAX_FAILED_ATTEMPTS } },
    data: { attempts: { increment: 1 } },
  });
  if (claimed.count === 0) return { valid: false };

  const matches = await verifyPassword(otp, record.otpHash);
  if (!matches) return { valid: false };

  // Only wrong guesses count — give the slot back. verify-otp and then
  // reset-password both check the same code, so a user who made a few typos
  // before getting it right must not be locked out on the second check.
  await prisma.passwordResetOtp.update({
    where: { id: record.id },
    data: { attempts: { decrement: 1 } },
  });

  return { valid: true, userId: user.id, otpRecordId: record.id };
}
