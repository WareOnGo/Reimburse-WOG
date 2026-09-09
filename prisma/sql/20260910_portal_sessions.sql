-- Additive change for the shared database. Apply before deploying session code.
-- Do not use prisma db push/migrate against the shared introspected schema.
CREATE TABLE IF NOT EXISTS "ReimbursementSession" (
  "tokenHash" TEXT PRIMARY KEY,
  "email" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX IF NOT EXISTS "ReimbursementSession_expiresAt_idx"
  ON "ReimbursementSession" ("expiresAt");

-- Supabase may grant API roles access to new public tables by default. No
-- policies are provided: only the trusted server DB owner/BYPASSRLS role may
-- access sessions. Browser anon/authenticated roles must not create sessions.
ALTER TABLE "ReimbursementSession" ENABLE ROW LEVEL SECURITY;
