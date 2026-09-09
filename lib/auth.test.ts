import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

const m = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), delete: vi.fn(), create: vi.fn(), deleteMany: vi.fn(), findUnique: vi.fn(), verified: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: m.get, set: m.set, delete: m.delete }) }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));
vi.mock("@/lib/prisma", () => ({ prisma: { reimbursementSession: m, verifiedNumber: { findUnique: m.verified } } }));
import { clearSession, getCurrentUser, getSessionEmail, requireAdmin, requireUser, setSessionEmail } from "./auth";

const token = "a".repeat(64);
const hash = createHash("sha256").update(token).digest("hex");
const identity = { empID: "EMP-1", email: "employee@example.test", name: "Employee", is_active: true };
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-10T00:00:00Z"));
  vi.stubEnv("ADMIN_EMAILS", "");
  m.get.mockReturnValue({ value: token });
  m.findUnique.mockResolvedValue({ email: identity.email, expiresAt: new Date("2026-10-10T00:00:00Z") });
  m.verified.mockResolvedValue(identity);
  m.create.mockResolvedValue({});
  m.deleteMany.mockResolvedValue({ count: 1 });
});

describe("session integrity", () => {
  it.each([undefined, "", "admin@example.test", "a".repeat(63), "A".repeat(64), "../session"])("rejects malformed or legacy cookie %s without a DB lookup", async (value) => {
    m.get.mockReturnValue(value === undefined ? undefined : { value });
    expect(await getSessionEmail()).toBeNull();
    expect(m.findUnique).not.toHaveBeenCalled();
    expect(await getCurrentUser()).toBeNull();
    expect(m.verified).not.toHaveBeenCalled();
  });
  it("looks up only the hash, and rejects an unknown/fabricated token", async () => {
    m.findUnique.mockResolvedValue(null);
    expect(await getSessionEmail()).toBeNull();
    expect(m.findUnique).toHaveBeenCalledWith({ where: { tokenHash: hash } });
  });
  it.each(["2026-09-09T23:59:59Z", "2026-09-10T00:00:00Z"])("rejects expired session at %s", async (expiry) => {
    m.findUnique.mockResolvedValue({ email: identity.email, expiresAt: new Date(expiry) });
    expect(await getSessionEmail()).toBeNull();
  });
  it("creates unpredictable tokens, stores only their hashes, and rotates the old session", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await setSessionEmail(identity.email);
    await setSessionEmail(identity.email);
    const first = m.set.mock.calls[0][1] as string;
    const second = m.set.mock.calls[1][1] as string;
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).not.toBe(second);
    expect(m.create.mock.calls[0][0].data).toEqual({ tokenHash: createHash("sha256").update(first).digest("hex"), email: identity.email, expiresAt: new Date("2026-10-10T00:00:00Z") });
    expect(m.set.mock.calls[0]).toEqual(["rp_session", first, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 2592000 }]);
    expect(m.deleteMany).toHaveBeenCalledWith({ where: { tokenHash: hash } });
  });
  it("supports HTTP development and a first sign-in", async () => {
    vi.stubEnv("NODE_ENV", "development");
    m.get.mockReturnValue(undefined);
    await setSessionEmail(identity.email);
    expect(m.set.mock.calls[0][2].secure).toBe(false);
    expect(m.deleteMany).not.toHaveBeenCalled();
  });
  it("does not issue a cookie if session persistence fails", async () => {
    m.create.mockRejectedValue(new Error("database unavailable"));
    await expect(setSessionEmail(identity.email)).rejects.toThrow("database unavailable");
    expect(m.set).not.toHaveBeenCalled();
  });
  it("rejects an empty identity when issuing a session", async () => {
    await expect(setSessionEmail("  ")).rejects.toThrow("required");
    expect(m.create).not.toHaveBeenCalled();
  });
  it("logout revokes the token before removing the cookie; replay no longer resolves", async () => {
    m.deleteMany.mockImplementation(async () => { m.findUnique.mockResolvedValue(null); return { count: 1 }; });
    await clearSession();
    expect(m.deleteMany).toHaveBeenCalledWith({ where: { tokenHash: hash } });
    expect(m.delete).toHaveBeenCalledWith("rp_session");
    expect(await getSessionEmail()).toBeNull();
  });
  it("clears a legacy cookie without treating it as a valid session", async () => {
    m.get.mockReturnValue({ value: "admin@example.test" });
    await clearSession();
    expect(m.deleteMany).not.toHaveBeenCalled();
    expect(m.delete).toHaveBeenCalledWith("rp_session");
  });
});

describe("identity and authorization", () => {
  it.each([null, { ...identity, empID: null }, { ...identity, is_active: false }])("rejects an ineligible identity %j", async (row) => {
    m.verified.mockResolvedValue(row);
    expect(await getCurrentUser()).toBeNull();
  });
  it("resolves the employee from the session and never grants admin from a role column", async () => {
    m.verified.mockResolvedValue({ ...identity, role: "ADMIN" });
    expect(await getCurrentUser()).toEqual({ empID: "EMP-1", email: identity.email, name: "Employee", isAdmin: false });
    expect(m.verified).toHaveBeenCalledWith({ where: { email: identity.email }, select: { empID: true, email: true, name: true, is_active: true } });
  });
  it("normalizes allowlist whitespace and case", async () => {
    vi.stubEnv("ADMIN_EMAILS", `  OTHER@EXAMPLE.TEST, ${identity.email.toUpperCase()}, ,`);
    expect((await getCurrentUser())?.isAdmin).toBe(true);
    expect(await requireAdmin()).toMatchObject({ empID: "EMP-1", isAdmin: true });
  });
  it("uses session email when a legacy identity has no email", async () => {
    m.verified.mockResolvedValue({ ...identity, email: null });
    expect((await getCurrentUser())?.email).toBe(identity.email);
  });
  it("returns an authenticated employee from requireUser", async () => {
    expect(await requireUser()).toMatchObject({ empID: "EMP-1" });
  });
  it("redirects signed-out callers from both guards", async () => {
    m.get.mockReturnValue(undefined);
    await expect(requireUser()).rejects.toThrow("redirect:/");
    await expect(requireAdmin()).rejects.toThrow("redirect:/");
  });
  it("redirects an employee away from admin pages", async () => {
    await expect(requireAdmin()).rejects.toThrow("redirect:/dashboard");
  });
});
