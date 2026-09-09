import { cache } from "react";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";

const COOKIE_NAME = "rp_session";
const MAX_AGE = 60 * 60 * 24 * 30;

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function validToken(token: string | undefined): token is string {
  return typeof token === "string" && /^[a-f0-9]{64}$/.test(token);
}

export type CurrentUser = {
  empID: string;
  email: string;
  name: string;
  isAdmin: boolean;
};

function adminEmails(): Set<string> {
  return new Set(
    (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

export async function setSessionEmail(email: string): Promise<void> {
  if (!email.trim()) throw new Error("Session email is required");
  const c = await cookies();
  const token = randomBytes(32).toString("hex");
  // Revoke an existing session when signing in again on this browser.
  const previous = c.get(COOKIE_NAME)?.value;
  if (validToken(previous)) {
    await prisma.reimbursementSession.deleteMany({ where: { tokenHash: tokenHash(previous) } });
  }
  await prisma.reimbursementSession.create({ data: {
    tokenHash: tokenHash(token), email, expiresAt: new Date(Date.now() + MAX_AGE * 1000),
  } });
  c.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function clearSession(): Promise<void> {
  const c = await cookies();
  const token = c.get(COOKIE_NAME)?.value;
  if (validToken(token)) {
    await prisma.reimbursementSession.deleteMany({ where: { tokenHash: tokenHash(token) } });
  }
  c.delete(COOKIE_NAME);
}

export async function getSessionEmail(): Promise<string | null> {
  const c = await cookies();
  const token = c.get(COOKIE_NAME)?.value;
  if (!validToken(token)) return null;
  const session = await prisma.reimbursementSession.findUnique({
    where: { tokenHash: tokenHash(token) },
  });
  return session && session.expiresAt.getTime() > Date.now() ? session.email : null;
}

export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const email = await getSessionEmail();
  if (!email) return null;

  const verified = await prisma.verifiedNumber.findUnique({
    where: { email },
    select: { empID: true, email: true, name: true, is_active: true },
  });
  if (!verified?.empID || verified.is_active === false) return null;

  const lower = (verified.email ?? email).toLowerCase();
  return {
    empID: verified.empID,
    email: verified.email ?? email,
    name: verified.name,
    isAdmin: adminEmails().has(lower),
  };
});

export async function requireUser(): Promise<CurrentUser> {
  const u = await getCurrentUser();
  if (!u) redirect("/");
  return u;
}

export async function requireAdmin(): Promise<CurrentUser> {
  const u = await getCurrentUser();
  if (!u) redirect("/");
  if (!u.isAdmin) redirect("/dashboard");
  return u;
}
