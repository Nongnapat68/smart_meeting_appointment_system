import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createSessionToken, hashPassword, setSessionCookie } from "@/lib/auth";
import { signUpSchema } from "@/lib/validations";
import { ApiError, parseBody, withApiErrors } from "@/lib/api-helpers";

export const POST = withApiErrors(async (request: Request) => {
  const body = parseBody(signUpSchema, await request.json());
  const email = body.email.toLowerCase();

  try {
    const passwordHash = await hashPassword(body.password);
    const user = await prisma.$transaction(async (tx) => {
      const createdUser = await tx.user.create({
        data: { name: body.name.trim(), email, passwordHash },
      });
      // Every account has a contact record, so it can immediately be invited.
      await tx.person.create({
        data: { userId: createdUser.id, name: createdUser.name, email, type: "INTERNAL" },
      });
      return createdUser;
    });

    const { token, maxAge } = await createSessionToken(user.id, user.email);
    await setSessionCookie(token, maxAge);
    return NextResponse.json(
      { user: { id: user.id, name: user.name, email: user.email, role: user.role } },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new ApiError(409, "อีเมลนี้ถูกใช้งานแล้ว กรุณาเข้าสู่ระบบหรือใช้อีเมลอื่น");
    }
    throw error;
  }
});
