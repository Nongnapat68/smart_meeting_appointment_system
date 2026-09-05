import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import type { User } from "@prisma/client";

export const SESSION_COOKIE = "sm_session";
const SESSION_TTL_DEFAULT = 60 * 60 * 24 * 7; // 7 days
const SESSION_TTL_REMEMBER = 60 * 60 * 24 * 30; // 30 days

function getSecretKey() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("AUTH_SECRET is not set. Copy .env.example to .env and set it.");
  }
  return new TextEncoder().encode(secret);
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export interface SessionPayload extends JWTPayload {
  sub: string; // user id
  email: string;
}

export async function createSessionToken(userId: string, email: string, remember = false) {
  const ttl = remember ? SESSION_TTL_REMEMBER : SESSION_TTL_DEFAULT;
  const token = await new SignJWT({ email })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttl)
    .sign(getSecretKey());
  return { token, maxAge: ttl };
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    if (!payload.sub) return null;
    return payload as SessionPayload;
  } catch {
    return null;
  }
}

/** Reads and verifies the session cookie for the current request (Server Components / Route Handlers). */
export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

/** Loads the full current user row, or null if not authenticated / user was deleted. */
export async function getCurrentUser(): Promise<User | null> {
  const session = await getSession();
  if (!session) return null;
  return prisma.user.findUnique({ where: { id: session.sub } });
}

export async function setSessionCookie(token: string, maxAge: number) {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge,
  });
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
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
