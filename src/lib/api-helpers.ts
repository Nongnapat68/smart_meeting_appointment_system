import { NextResponse } from "next/server";
import type { User } from "@prisma/client";
import { ZodError, type ZodType } from "zod";
import { getCurrentUser } from "@/lib/auth";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function jsonError(status: number, message: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

/** Ensures the request is authenticated; returns the user or throws a 401 ApiError. */
export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) throw new ApiError(401, "กรุณาเข้าสู่ระบบก่อนใช้งาน");
  return user;
}

export function isAdmin(user: User): boolean {
  return user.role === "ADMIN";
}

/**
 * Authorization (not just authentication) gate for mutating endpoints on a
 * specific resource — e.g. "only the meeting's organizer or an admin may
 * cancel it". `requireUser()` only proves *someone* is logged in; this is
 * the check that stops a logged-in user A from editing/deleting user B's
 * resource by guessing/enumerating its id. Throws 403 (not 404) so the
 * distinction from "resource doesn't exist" (which routes check separately)
 * stays visible in logs, while still not leaking whether the id exists to
 * an unauthorized caller beyond what a 403 already implies.
 */
export function assertOwner(user: User, ok: boolean, message = "คุณไม่มีสิทธิ์ดำเนินการนี้"): void {
  if (isAdmin(user)) return;
  if (!ok) throw new ApiError(403, message);
}

export function parseBody<T>(schema: ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new ApiError(400, formatZodError(result.error));
  }
  return result.data;
}

function formatZodError(error: ZodError): string {
  return error.issues
    .map((i) => `${i.path.join(".") || "value"}: ${i.message}`)
    .join("; ");
}

/** Wraps a route handler body, turning ApiError into a proper JSON error response
 * and unexpected errors into a generic 500, so every route doesn't need its own try/catch. */
export function withApiErrors<Args extends unknown[]>(
  handler: (...args: Args) => Promise<Response>
) {
  return async (...args: Args): Promise<Response> => {
    try {
      return await handler(...args);
    } catch (err) {
      if (err instanceof ApiError) {
        return jsonError(err.status, err.message);
      }
      console.error(err);
      return jsonError(500, "เกิดข้อผิดพลาดที่ไม่คาดคิด กรุณาลองใหม่อีกครั้ง");
    }
  };
}

export function parsePagination(searchParams: URLSearchParams) {
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const pageSizeRaw = parseInt(searchParams.get("pageSize") ?? "10", 10) || 10;
  const pageSize = Math.min(100, Math.max(1, pageSizeRaw));
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}
