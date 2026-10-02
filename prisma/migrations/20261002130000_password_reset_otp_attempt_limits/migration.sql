-- Rate limits for the password-reset OTP flow (see src/lib/otp.ts).
--
-- 1. "attempts" counts wrong guesses against one issued code. The app claims
--    an attempt with a single conditional UPDATE (... WHERE attempts < 5) and
--    refunds it on a correct guess, so after 5 wrong guesses the code can
--    never verify again and the user has to request a new one. NOT NULL
--    DEFAULT 0 backfills existing rows as "no attempts yet" — a metadata-only
--    change on PG 11+, no table rewrite.
--
-- 2. The per-user request limit (3 codes / 15 min) counts existing rows by
--    createdAt, so it needs no new column — only an index on
--    (userId, createdAt). That index also serves the "newest unused code"
--    lookup and every plain userId lookup, so it replaces the old
--    single-column userId index instead of sitting next to it.
--
-- RLS on this table stays deny-all (20260911120000_enable_rls_policies); it
-- is only ever touched by the server through Prisma.

-- AlterTable
ALTER TABLE "PasswordResetOtp" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;

-- DropIndex
DROP INDEX "PasswordResetOtp_userId_idx";

-- CreateIndex
CREATE INDEX "PasswordResetOtp_userId_createdAt_idx" ON "PasswordResetOtp"("userId", "createdAt");
