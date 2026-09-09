import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { createHash, randomBytes } from "node:crypto";

const cookies = vi.hoisted(() => ({ value: "" }));
const head = vi.hoisted(() => vi.fn(async () => ({ ContentLength: 123 })));
vi.mock("next/headers", () => ({ cookies: async () => ({
  get: () => ({ value: cookies.value }), set: (_name: string, value: string) => { cookies.value = value; }, delete: () => { cookies.value = ""; },
}) }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));
vi.mock("@/lib/r2", () => ({ deleteObject: async () => {}, getObjectMetadata: head }));
vi.mock("@/lib/email", () => ({ sendPartialApprovalEmail: async () => false }));
import { prisma } from "@/lib/prisma";
import { clearSession, getCurrentUser, getSessionEmail, setSessionEmail } from "@/lib/auth";
import { GET, POST } from "@/app/api/tickets/route";
import { PATCH } from "@/app/api/tickets/[id]/route";

const url = new URL(process.env.ERP_TEST_DATABASE_URL!);
if (url.hostname !== "127.0.0.1" || url.pathname !== "/erp_test") throw new Error("Disposable test DB required");
const valid = { title: "Dinner", category: "Meals", description: "Client meeting", amount: 1250.25, expenseDate: "2026-09-10", dealName: "Deal", clientName: "Client" };
const request = (body: unknown) => new Request("http://test.local/api/tickets", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const file = { name: "receipt.pdf", kind: "DOCUMENT", contentType: "application/pdf", sizeBytes: 123, r2Key: "tickets/employees/EMP-1/draft/receipt.pdf" };
async function make(body = valid) {
  const response = await POST(request(body)); expect(response.status).toBe(201);
  return response.json() as Promise<{ id: string; shortCode: string }>;
}
async function signIn(email: string) { cookies.value = ""; await setSessionEmail(email); }
beforeEach(async () => {
  await prisma.ticket.deleteMany(); await prisma.reimbursementSession.deleteMany(); await signIn("employee@example.test");
});
afterAll(() => prisma.$disconnect());

it("round-trips Decimal/date, identity, attachments, and the audit event", async () => {
  const ticket = await make({ ...valid, attachments: [file] } as typeof valid);
  const saved = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id }, include: { attachments: true, events: true } });
  expect(saved.amount.toString()).toBe("1250.25"); expect(saved.expenseDate?.toISOString()).toBe("2026-09-10T00:00:00.000Z");
  expect(saved.submittedByEmpID).toBe("EMP-1"); expect(saved.attachments).toHaveLength(1); expect(saved.events.map((event) => event.label)).toEqual(["Ticket submitted"]);
  const response = await GET(); expect(response.status).toBe(200); expect(await response.json()).toHaveLength(1);
});
it("allocates unique sequential codes under concurrent creation", async () => {
  const created = await Promise.all(Array.from({ length: 6 }, () => make()));
  expect(created.map((ticket) => ticket.shortCode).sort()).toEqual(["RB-2001", "RB-2002", "RB-2003", "RB-2004", "RB-2005", "RB-2006"]);
  expect(await prisma.ticket.count()).toBe(6);
});
it("allocates above the highest numeric code even if the latest ticket has a lower or malformed code", async () => {
  const first = await make(); await prisma.ticket.update({ where: { id: first.id }, data: { shortCode: "RB-9999" } });
  await prisma.ticket.create({ data: { ...valid, expenseDate: null, shortCode: "legacy", submittedByEmpID: "EMP-1" } });
  expect((await make()).shortCode).toBe("RB-10000");
});
it("rolls back ticket creation when a nested attachment violates uniqueness", async () => {
  await make({ ...valid, attachments: [file] } as typeof valid);
  await expect(POST(request({ ...valid, attachments: [file] }))).rejects.toMatchObject({ code: "P2002" });
  expect(await prisma.ticket.count()).toBe(1); expect(await prisma.attachment.count()).toBe(1);
});
it("rolls back both the edit and attachment removal if deletion fails", async () => {
  const ticket = await make({ ...valid, attachments: [file] } as typeof valid);
  const attachment = await prisma.attachment.findFirstOrThrow();
  await prisma.$executeRawUnsafe(`CREATE FUNCTION reject_test_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'simulated deletion failure'; END $$`);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER reject_test_delete BEFORE DELETE ON "Attachment" FOR EACH ROW EXECUTE FUNCTION reject_test_delete()`);
  try {
    await expect(PATCH(request({ title: "Changed", removeAttachmentIds: [attachment.id] }), { params: Promise.resolve({ id: ticket.id }) })).rejects.toThrow();
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).title).toBe("Dinner"); expect(await prisma.attachment.count()).toBe(1);
  } finally {
    await prisma.$executeRawUnsafe('DROP TRIGGER reject_test_delete ON "Attachment"'); await prisma.$executeRawUnsafe("DROP FUNCTION reject_test_delete()");
  }
});
it("rejects invalid mixed approval without changing persisted money", async () => {
  const ticket = await make(); await signIn("employee@example.test");
  vi.stubEnv("ADMIN_EMAILS", "employee@example.test");
  try {
    const response = await PATCH(request({ amount: 100, status: "APPROVED", approvedAmount: 300 }), { params: Promise.resolve({ id: ticket.id }) });
    expect(response.status).toBe(400); const saved = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(saved.status).toBe("PENDING"); expect(saved.amount.toString()).toBe("1250.25"); expect(saved.approvedAmount).toBeNull();
  } finally { vi.unstubAllEnvs(); }
});
it("preserves partial money through clearing and reversal", async () => {
  const ticket = await make(); await signIn("finance@example.test");
  for (const body of [{ status: "APPROVED", approvedAmount: 750.25 }, { status: "CLEARED" }, { status: "APPROVED" }]) {
    expect((await PATCH(request(body), { params: Promise.resolve({ id: ticket.shortCode }) })).status).toBe(200);
  }
  const saved = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } }); expect(saved.status).toBe("APPROVED"); expect(saved.approvedAmount?.toString()).toBe("750.25");
});
it("enforces employee ownership with actual Prisma relations", async () => {
  const ticket = await make(); await signIn("other@example.test");
  expect(await (await GET()).json()).toEqual([]);
  expect((await PATCH(request({ title: "Not mine" }), { params: Promise.resolve({ id: ticket.id }) })).status).toBe(403);
});
it("returns a conflict when an edit races with approval of the same version", async () => {
  const ticket = await make(); vi.stubEnv("ADMIN_EMAILS", "employee@example.test");
  // Hold external object verification after the ticket reads so both real
  // transactions start from one version; Prisma itself remains unmocked.
  let count = 0;
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => { release = resolve; });
  head.mockImplementation(async () => {
    if (++count === 2) release();
    await barrier;
    return { ContentLength: 123 };
  });
  try {
    const responses = await Promise.all([
      PATCH(request({ title: "Concurrent edit", addAttachments: [file] }), { params: Promise.resolve({ id: ticket.id }) }),
      PATCH(request({ status: "APPROVED", approvedAmount: 500, addAttachments: [{ ...file, r2Key: "tickets/employees/EMP-1/draft/approval.pdf" }] }), { params: Promise.resolve({ id: ticket.id }) }),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const saved = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    if (responses[0].status === 200) {
      expect(saved.title).toBe("Concurrent edit"); expect(saved.status).toBe("PENDING"); expect(saved.approvedAmount).toBeNull();
    } else {
      expect(saved.title).toBe("Dinner"); expect(saved.status).toBe("APPROVED"); expect(saved.approvedAmount?.toString()).toBe("500");
    }
  } finally { head.mockImplementation(async () => ({ ContentLength: 123 })); vi.unstubAllEnvs(); }
});
it("rejects tampered/expired sessions and revokes logout tokens in Postgres", async () => {
  expect((await getCurrentUser())?.empID).toBe("EMP-1"); const old = cookies.value;
  await clearSession(); cookies.value = old; expect(await getSessionEmail()).toBeNull();
  cookies.value = randomBytes(32).toString("hex"); expect(await getSessionEmail()).toBeNull();
  cookies.value = "finance@example.test"; expect(await getSessionEmail()).toBeNull();
  await signIn("employee@example.test");
  await prisma.reimbursementSession.update({ where: { tokenHash: createHash("sha256").update(cookies.value).digest("hex") }, data: { expiresAt: new Date(0) } });
  expect(await getSessionEmail()).toBeNull();
});
it("blocks direct session reads and inserts by non-server database roles", async () => {
  await prisma.$executeRawUnsafe("CREATE ROLE erp_test_browser NOLOGIN");
  await prisma.$executeRawUnsafe('GRANT SELECT, INSERT ON "ReimbursementSession" TO erp_test_browser');
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL ROLE erp_test_browser");
      expect(await tx.reimbursementSession.findMany()).toEqual([]);
    });
    await expect(prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL ROLE erp_test_browser");
      await tx.reimbursementSession.create({ data: { tokenHash: "forged", email: "finance@example.test", expiresAt: new Date(Date.now() + 60000) } });
    })).rejects.toThrow(/row-level security/i);
  } finally {
    await prisma.$executeRawUnsafe('REVOKE ALL ON "ReimbursementSession" FROM erp_test_browser');
    await prisma.$executeRawUnsafe("DROP ROLE erp_test_browser");
  }
});
