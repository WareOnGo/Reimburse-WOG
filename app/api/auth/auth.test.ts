import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), delete: vi.fn(), session: vi.fn(), clear: vi.fn(), verified: vi.fn(), upsert: vi.fn(), fetch: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: m.get, set: m.set, delete: m.delete }) }));
vi.mock("@/lib/prisma", () => ({ prisma: { verifiedNumber: { findUnique: m.verified }, employee: { upsert: m.upsert } } }));
vi.mock("@/lib/auth", () => ({ setSessionEmail: m.session, clearSession: m.clear }));
import { GET as start } from "./google/route";
import { GET as callback } from "./google/callback/route";
import { POST as logout } from "./logout/route";
const call = (query = "code=code-1&state=state-1") => callback(new Request(`http://portal.test/api/auth/google/callback?${query}`));
const location = (response: Response) => response.headers.get("location");
const profile = { email: "employee@example.test", name: "Employee", email_verified: true };
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("GOOGLE_CLIENT_ID", "client-id"); vi.stubEnv("GOOGLE_CLIENT_SECRET", "client-secret"); vi.stubEnv("GOOGLE_REDIRECT_URI", "http://portal.test/api/auth/google/callback");
  vi.stubGlobal("fetch", m.fetch);
  m.fetch.mockImplementation(async (url: string) => {
    if (url === "https://oauth2.googleapis.com/token") return Response.json({ access_token: "access-1" });
    if (url === "https://www.googleapis.com/oauth2/v3/userinfo") return Response.json(profile);
    throw new Error(`Unexpected URL: ${url}`);
  });
  m.get.mockReturnValue({ value: "state-1" });
  m.verified.mockResolvedValue({ empID: "EMP-1", is_active: true });
  m.upsert.mockResolvedValue({ empID: "EMP-1" }); m.session.mockResolvedValue(undefined); m.clear.mockResolvedValue(undefined);
});
describe("OAuth start", () => {
  it("sets unique state and matches it in the provider redirect", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const response = await start(new Request("http://portal.test/api/auth/google"));
    const url = new URL(location(response)!);
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(Object.fromEntries(url.searchParams)).toEqual({ client_id: "client-id", redirect_uri: "http://portal.test/api/auth/google/callback", response_type: "code", scope: "openid email profile", state: expect.stringMatching(/^[a-f0-9]{32}$/), access_type: "online", prompt: "select_account" });
    expect(m.set).toHaveBeenCalledWith("rp_oauth_state", url.searchParams.get("state"), { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 600 });
    await start(new Request("http://portal.test/api/auth/google"));
    expect(m.set.mock.calls[0][1]).not.toBe(m.set.mock.calls[1][1]);
  });
  it.each(["GOOGLE_CLIENT_ID", "GOOGLE_REDIRECT_URI"])("reports missing %s", async (name) => {
    vi.stubEnv(name, ""); expect(location(await start(new Request("http://portal.test/api/auth/google")))).toBe("http://portal.test/?error=oauth_not_configured"); expect(m.set).not.toHaveBeenCalled();
  });
});
describe("OAuth callback", () => {
  it.each([["error=access_denied", "access_denied"], ["code=code-1", "missing_code"], ["state=state-1", "missing_code"], ["", "missing_code"]])("handles early error %s", async (query, error) => {
    expect(location(await call(query))).toBe(`http://portal.test/?error=${error}`); expect(m.fetch).not.toHaveBeenCalled(); expect(m.session).not.toHaveBeenCalled();
  });
  it.each([undefined, { value: "wrong" }])("rejects invalid state %j and consumes the cookie", async (cookie) => {
    m.get.mockReturnValue(cookie); expect(location(await call())).toBe("http://portal.test/?error=invalid_state"); expect(m.delete).toHaveBeenCalledWith("rp_oauth_state"); expect(m.fetch).not.toHaveBeenCalled();
  });
  it.each(["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI"])("rejects missing %s", async (name) => {
    vi.stubEnv(name, ""); expect(location(await call())).toContain("error=oauth_not_configured"); expect(m.fetch).not.toHaveBeenCalled();
  });
  it("exchanges the code, verifies identity, and establishes the session", async () => {
    expect(location(await call())).toBe("http://portal.test/dashboard");
    const [url, init] = m.fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://oauth2.googleapis.com/token"); expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "content-type": "application/x-www-form-urlencoded" });
    expect(Object.fromEntries(init.body as URLSearchParams)).toEqual({ code: "code-1", client_id: "client-id", client_secret: "client-secret", redirect_uri: "http://portal.test/api/auth/google/callback", grant_type: "authorization_code" });
    expect(m.fetch.mock.calls[1]).toEqual(["https://www.googleapis.com/oauth2/v3/userinfo", { headers: { Authorization: "Bearer access-1" } }]);
    expect(m.verified).toHaveBeenCalledWith({ where: { email: profile.email }, select: { empID: true, is_active: true } });
    expect(m.upsert).toHaveBeenCalledWith({ where: { empID: "EMP-1" }, create: { empID: "EMP-1" }, update: {} }); expect(m.session).toHaveBeenCalledExactlyOnceWith(profile.email);
  });
  it("handles token HTTP failure", async () => { m.fetch.mockResolvedValueOnce(new Response("bad", { status: 400 })); expect(location(await call())).toContain("error=token_exchange_failed"); expect(m.session).not.toHaveBeenCalled(); });
  it.each([{}, null, { access_token: 123 }])("rejects missing or mistyped access token %j", async (body) => { m.fetch.mockResolvedValueOnce(Response.json(body)); expect(location(await call())).toContain("error=no_access_token"); expect(m.session).not.toHaveBeenCalled(); });
  it("handles profile HTTP failure", async () => {
    m.fetch.mockResolvedValueOnce(Response.json({ access_token: "access-1" })).mockResolvedValueOnce(new Response("bad", { status: 503 }));
    expect(location(await call())).toContain("error=userinfo_failed"); expect(m.session).not.toHaveBeenCalled();
  });
  it.each([{}, null, { ...profile, email_verified: false }, { ...profile, email_verified: "true" }, { ...profile, email: 5 }])("requires a verified, correctly typed identity %j", async (body) => {
    m.fetch.mockResolvedValueOnce(Response.json({ access_token: "access-1" })).mockResolvedValueOnce(Response.json(body));
    expect(location(await call())).toContain("error=email_not_verified"); expect(m.upsert).not.toHaveBeenCalled(); expect(m.session).not.toHaveBeenCalled();
  });
  it.each([null, { empID: null, is_active: true }])("rejects an unregistered employee %j", async (row) => {
    m.verified.mockResolvedValue(row); expect(location(await call())).toBe("http://portal.test/?error=not_on_file&email=employee%40example.test"); expect(m.upsert).not.toHaveBeenCalled(); expect(m.session).not.toHaveBeenCalled();
  });
  it("rejects an inactive employee", async () => {
    m.verified.mockResolvedValue({ empID: "EMP-1", is_active: false }); expect(location(await call())).toContain("error=inactive"); expect(m.session).not.toHaveBeenCalled();
  });
  it("handles network and malformed provider JSON without an uncaught error", async () => {
    m.fetch.mockRejectedValueOnce(new Error("network offline")); expect(location(await call())).toContain("error=oauth_failed");
    m.fetch.mockResolvedValueOnce(new Response("not json")); expect(location(await call())).toContain("error=oauth_failed"); expect(m.session).not.toHaveBeenCalled();
  });
  it("does not issue a session when the employee upsert fails", async () => {
    m.upsert.mockRejectedValue(new Error("database offline")); expect(location(await call())).toContain("error=oauth_failed"); expect(m.session).not.toHaveBeenCalled();
  });
});
it("logout awaits revocation and returns the JSON contract", async () => {
  const response = await logout(); expect(m.clear).toHaveBeenCalledOnce(); expect(response.status).toBe(200); expect(await response.json()).toEqual({ ok: true });
});
