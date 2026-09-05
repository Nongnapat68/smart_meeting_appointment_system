/**
 * Minimal email delivery abstraction.
 *
 * In development (no SMTP_* env vars set) this just logs to the server
 * console so OTP codes and notifications are visible without any setup.
 * In production, set SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASSWORD/SMTP_FROM
 * and swap the body of `sendEmail` for a real transport (nodemailer, Resend,
 * SES, etc.) — every call site in this codebase goes through this one
 * function, so that's the only place that needs to change.
 */

interface SendEmailInput {
  to: string;
  subject: string;
  text: string;
}

export async function sendEmail({ to, subject, text }: SendEmailInput): Promise<void> {
  const configured = Boolean(process.env.SMTP_HOST);

  if (!configured) {
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

  // TODO: wire up a real SMTP/API transport here using SMTP_HOST/SMTP_PORT/
  // SMTP_USER/SMTP_PASSWORD/SMTP_FROM once those are set in the environment.
  console.log(`[email] would send to ${to}: ${subject}`);
}

export function generateOtp(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}
