import { NextResponse } from "next/server";
import { Prisma, type User } from "@prisma/client";
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

// Every custom message in lib/validations.ts is Thai and already names the
// field ("รหัสผ่านต้องมี...") — prefixing the internal key ("newPassword: ...")
// only leaks the API's field names into the UI. The key is kept for Zod's own
// generic (English) messages, where it is the only hint of which field failed.
const THAI_RE = /[฀-๿]/;

function formatZodError(error: ZodError): string {
  return error.issues
    .map((i) => (THAI_RE.test(i.message) ? i.message : `${i.path.join(".") || "value"}: ${i.message}`))
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
      // A request whose body isn't valid JSON (or has the wrong Content-Type)
      // makes `await request.json()` reject with a SyntaxError deep in the
      // handler — a client input error, so surface it as 400 rather than the
      // generic 500 below. (No route parses JSON with JSON.parse inside a
      // handler, so a SyntaxError here can only come from the request body.)
      if (err instanceof SyntaxError) {
        return jsonError(400, "รูปแบบข้อมูลไม่ถูกต้อง");
      }
      // Common Prisma write errors that are the *caller's* fault, not a server
      // bug: a foreign key that points at a non-existent row (P2003, e.g. a
      // task created with an unknown meetingId) is a 400, and an update/delete
      // that matched no row (P2025) is a 404 — instead of the generic 500.
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        if (err.code === "P2003") {
          return jsonError(400, "ข้อมูลอ้างอิงไม่ถูกต้อง (ไม่พบรหัสที่อ้างถึง)");
        }
        if (err.code === "P2025") {
          return jsonError(404, "ไม่พบข้อมูลที่ต้องการ");
        }
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
