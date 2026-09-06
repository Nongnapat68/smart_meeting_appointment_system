/**
 * Minimal email delivery abstraction.
 *
 * In development (no SMTP_* env vars set) this just logs to the server
 * console so OTP codes and notifications are visible without any setup.
 * In production, SMTP settings are required and delivery failures are thrown
 * to the caller so records are never incorrectly marked as sent.
 */

interface SendEmailInput {
  to: string;
  subject: string;
  text: string;
}

export async function sendEmail({ to, subject, text }: SendEmailInput): Promise<void> {
  const host = process.env.SMTP_HOST;

  if (!host) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("SMTP_HOST must be configured in production");
    }
    console.log(
      [
        "\n──────── [dev email — not actually sent] ────────",
        `To:      ${to}`,
        `Subject: ${subject}`,
        "",
        text,
        "───────────────────────────────────────────────────\n",
      ].join("\n")
    );
    return;
  }

  const { createTransport } = await import("nodemailer");
  const port = Number(process.env.SMTP_PORT ?? "587");
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;
  const from = process.env.SMTP_FROM;
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !user || !pass || !from) {
    throw new Error("SMTP_PORT, SMTP_USER, SMTP_PASSWORD and SMTP_FROM must be configured with SMTP_HOST");
  }

  const transport = createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
  await transport.sendMail({ from, to, subject, text });
}

export function generateOtp(): string {
  // crypto.randomInt avoids the predictable Math.random sequence.
  return randomInt(100000, 1_000_000).toString();
}
import { randomInt } from "crypto";
