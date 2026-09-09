import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma, TicketStatus } from "@prisma/client";

const m = vi.hoisted(() => ({
  user: vi.fn(), ticket: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  attachment: { findUnique: vi.fn(), findMany: vi.fn(), deleteMany: vi.fn() },
  ticketEvent: { create: vi.fn(), createMany: vi.fn() }, query: vi.fn(), transaction: vi.fn(),
  email: vi.fn(), remove: vi.fn(), download: vi.fn(), upload: vi.fn(), metadata: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ getCurrentUser: m.user }));
vi.mock("@/lib/prisma", () => ({ prisma: { ...m, $queryRaw: m.query, $transaction: m.transaction } }));
vi.mock("@/lib/email", () => ({ sendPartialApprovalEmail: m.email }));
vi.mock("@/lib/r2", async (original) => ({ ...await original<typeof import("@/lib/r2")>(),
  getUploadUrl: m.upload, getDownloadUrl: m.download, getObjectMetadata: m.metadata, deleteObject: m.remove,
}));
import { GET as list, POST as create } from "./tickets/route";
import { PATCH as patch } from "./tickets/[id]/route";
import { GET as download } from "./attachments/[id]/url/route";
import { POST as sign } from "./r2/sign/route";

const employee = { empID: "EMP-1", email: "employee@example.test", name: "Employee", isAdmin: false };
const existing = { id: "ticket-1", shortCode: "RB-2001", submittedByEmpID: "EMP-1", status: "PENDING" as TicketStatus,
  updatedAt: new Date("2026-09-10T00:00:00Z"), amount: new Prisma.Decimal(5000), approvedAmount: null,
  title: "Old title", dealName: "Old deal", clientName: "Old client",
  submittedBy: { verifiedNumber: { email: employee.email, name: "Employee" } },
};
const valid = { title: "Dinner", category: "Meals", description: "Client meeting", amount: 1250, dealName: "Deal", clientName: "Client" };
const file = { name: "receipt.pdf", kind: "DOCUMENT", contentType: "application/pdf", sizeBytes: 123,
  r2Key: "tickets/employees/EMP-1/draft/uuid-receipt.pdf" };
const request = (body: unknown, method = "POST") => new Request("http://portal.test/api/tickets", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const ctx = (id = "RB-2001") => ({ params: Promise.resolve({ id }) });
const edit = (body: unknown) => patch(request(body, "PATCH"), ctx());
const badJson = () => new Request("http://portal.test/api/tickets", { method: "POST", body: "{" });
const tx = { ticket: m.ticket, attachment: m.attachment, $queryRaw: m.query };
function noWrites() {
  expect(m.ticket.create).not.toHaveBeenCalled(); expect(m.ticket.update).not.toHaveBeenCalled();
  expect(m.attachment.deleteMany).not.toHaveBeenCalled(); expect(m.remove).not.toHaveBeenCalled();
  expect(m.email).not.toHaveBeenCalled(); expect(m.ticketEvent.createMany).not.toHaveBeenCalled();
}
beforeEach(() => {
  vi.resetAllMocks();
  m.user.mockResolvedValue(employee);
  m.ticket.findMany.mockResolvedValue([{ id: "ticket-1" }]);
  m.ticket.findFirst.mockResolvedValue(existing);
  m.ticket.create.mockResolvedValue({ id: "ticket-2", shortCode: "RB-2002" });
  m.ticket.update.mockResolvedValue({ id: "ticket-1" });
  m.query.mockResolvedValue([{ next: 2002n }]);
  m.transaction.mockImplementation(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx));
  m.attachment.findMany.mockResolvedValue([]);
  m.attachment.findUnique.mockResolvedValue({ ...file, ticket: { submittedByEmpID: "EMP-1" } });
  m.attachment.deleteMany.mockResolvedValue({ count: 1 });
  m.ticketEvent.create.mockResolvedValue({}); m.ticketEvent.createMany.mockResolvedValue({ count: 1 });
  m.email.mockResolvedValue(true); m.remove.mockResolvedValue(undefined);
  m.download.mockResolvedValue("https://storage.test/receipt.pdf");
  m.upload.mockImplementation(async (key: string, _type: string, expiresIn: number) => ({ key, url: "https://storage.test/put", expiresIn }));
  m.metadata.mockResolvedValue({ ContentLength: 123 });
});

describe("ticket collection", () => {
  it("restricts employee reads and returns the tickets", async () => {
    const response = await list();
    expect(response.status).toBe(200); expect(await response.json()).toEqual([{ id: "ticket-1" }]);
    expect(m.ticket.findMany.mock.calls[0][0]).toMatchObject({ where: { submittedByEmpID: "EMP-1" }, orderBy: { createdAt: "desc" } });
  });
  it("allows admins to list all tickets", async () => {
    m.user.mockResolvedValue({ ...employee, isAdmin: true });
    await list(); expect(m.ticket.findMany.mock.calls[0][0].where).toEqual({});
  });
  it("rejects unauthenticated reads and creation", async () => {
    m.user.mockResolvedValue(null);
    expect((await list()).status).toBe(401); expect((await create(request(valid))).status).toBe(401);
    expect(m.ticket.findMany).not.toHaveBeenCalled(); noWrites();
  });
  it("creates with normalized fields and authenticated ownership inside a transaction", async () => {
    const response = await create(request({ ...valid, title: " Dinner ", expenseDate: "2026-09-09", submittedByEmpID: "someone-else", attachments: [file] }));
    expect(response.status).toBe(201); expect(await response.json()).toEqual({ id: "ticket-2", shortCode: "RB-2002" });
    expect(m.ticket.create).toHaveBeenCalledWith({ data: { ...valid, expenseDate: new Date("2026-09-09T00:00:00Z"), submittedByEmpID: "EMP-1", shortCode: "RB-2002", attachments: { create: [file] } }, select: { id: true, shortCode: true } });
    expect(m.transaction).toHaveBeenCalledOnce(); expect(m.query).toHaveBeenCalledTimes(2);
    expect(m.metadata).toHaveBeenCalledWith(file.r2Key);
    expect(m.ticketEvent.create).toHaveBeenCalledWith({ data: { ticketId: "ticket-2", label: "Ticket submitted" } });
  });
  it("allows zero and omitted optional fields; audit failure is nonfatal", async () => {
    m.ticketEvent.create.mockRejectedValue(new Error("audit offline"));
    expect((await create(request({ ...valid, amount: 0 }))).status).toBe(201);
    expect(m.ticket.create.mock.calls[0][0].data).toMatchObject({ amount: 0, expenseDate: null, attachments: undefined });
  });
  it.each([null, [], "body", { ...valid, title: "  " }, { ...valid, amount: -1 }, { ...valid, dealName: null }, { ...valid, expenseDate: "2026-02-30" }, { ...valid, attachments: [null] }])("rejects malformed creation %j without writes", async (body) => {
    expect((await create(request(body))).status).toBe(400); noWrites();
  });
  it("rejects invalid JSON", async () => { expect((await create(badJson())).status).toBe(400); noWrites(); });
  it("does not write an event when ticket persistence fails", async () => {
    m.ticket.create.mockRejectedValue(new Error("database unavailable"));
    await expect(create(request(valid))).rejects.toThrow("database unavailable"); expect(m.ticketEvent.create).not.toHaveBeenCalled();
  });
});

describe("ticket PATCH authorization", () => {
  it("advances the conflict version even when the clock has not advanced", async () => {
    vi.spyOn(Date, "now").mockReturnValue(existing.updatedAt.getTime());
    expect((await edit({ title: "Same millisecond edit" })).status).toBe(200);
    expect(m.ticket.update.mock.calls[0][0].data.updatedAt.getTime()).toBe(existing.updatedAt.getTime() + 1);
  });
  it("rejects anonymous requests and missing tickets", async () => {
    m.user.mockResolvedValue(null); expect((await edit({ title: "New" })).status).toBe(401);
    m.user.mockResolvedValue(employee); m.ticket.findFirst.mockResolvedValue(null);
    expect((await edit({ title: "New" })).status).toBe(404); noWrites();
  });
  it.each([false, true])("rejects edits by a non-owner (admin=%s)", async (isAdmin) => {
    m.user.mockResolvedValue({ ...employee, empID: "EMP-2", isAdmin });
    expect((await edit({ title: "New" })).status).toBe(403); noWrites();
  });
  it.each(["PENDING", "REVIEW"] as const)("allows owner edits in %s", async (status) => {
    m.ticket.findFirst.mockResolvedValue({ ...existing, status });
    expect((await edit({ title: " New ", expenseDate: null })).status).toBe(200);
    expect(m.ticket.findFirst.mock.calls[0][0].where).toEqual({ OR: [{ id: "RB-2001" }, { shortCode: "RB-2001" }] });
    expect(m.ticket.update.mock.calls[0][0]).toMatchObject({ where: { id: "ticket-1", updatedAt: existing.updatedAt, status }, data: { title: "New", expenseDate: null, dealName: undefined, approvedAmount: undefined } });
    expect(m.ticketEvent.createMany.mock.calls[0][0].data).toEqual([{ ticketId: "ticket-1", label: "Ticket edited" }]);
  });
  it.each(["APPROVED", "CLEARED", "REJECTED", "CANCELLED"] as const)("blocks owner editing and cancellation in %s", async (status) => {
    m.ticket.findFirst.mockResolvedValue({ ...existing, status });
    expect((await edit({ title: "New" })).status).toBe(409); expect((await edit({ status: "CANCELLED" })).status).toBe(409); noWrites();
  });
  it.each(["PENDING", "REVIEW"] as const)("allows owner cancellation in %s", async (status) => {
    m.ticket.findFirst.mockResolvedValue({ ...existing, status });
    expect((await edit({ status: "CANCELLED" })).status).toBe(200);
  });
  it("rejects another employee cancelling but permits an admin", async () => {
    m.user.mockResolvedValue({ ...employee, empID: "EMP-2" }); expect((await edit({ status: "CANCELLED" })).status).toBe(403); noWrites();
    m.user.mockResolvedValue({ ...employee, empID: "EMP-2", isAdmin: true }); expect((await edit({ status: "CANCELLED" })).status).toBe(200);
  });
  it.each(["APPROVED", "CLEARED", "REJECTED", "REVIEW", "PENDING"])("prevents employee setting %s", async (status) => { expect((await edit({ status })).status).toBe(403); noWrites(); });
  it.each(["APPROVED", "CLEARED", "REJECTED", "REVIEW", "PENDING"])("preserves admin status capability %s", async (status) => {
    m.user.mockResolvedValue({ ...employee, isAdmin: true, empID: "EMP-2" }); expect((await edit({ status })).status).toBe(200);
  });
  it.each([null, [], {}, { title: "" }, { clientName: null }, { amount: 1.001 }, { status: "toString" }, { status: "__proto__" }, { approvedAmount: 5 }])("rejects malformed patch %j before persistence", async (body) => {
    expect((await edit(body)).status).toBe(400); noWrites();
  });
  it("rejects invalid JSON", async () => { expect((await patch(badJson(), ctx())).status).toBe(400); noWrites(); });
});

describe("approval and side effects", () => {
  beforeEach(() => m.user.mockResolvedValue({ ...employee, isAdmin: true }));
  it.each([undefined, null, 5000])("stores full approval as null for %s without partial email", async (approvedAmount) => {
    expect((await edit({ status: "APPROVED", approvedAmount })).status).toBe(200);
    expect(m.ticket.update.mock.calls[0][0].data.approvedAmount).toBeNull(); expect(m.email).not.toHaveBeenCalled();
  });
  it("uses final fields in same-request partial approval and email", async () => {
    expect((await edit({ title: "Updated", dealName: " Deal2 ", clientName: " Client2 ", amount: 4000, status: "APPROVED", approvedAmount: 3000 })).status).toBe(200);
    expect(m.email).toHaveBeenCalledExactlyOnceWith({ to: employee.email, name: "Employee", shortCode: "RB-2001", title: "Updated", requestedAmount: 4000, approvedAmount: 3000, dealName: "Deal2", clientName: "Client2" });
    expect(m.ticketEvent.createMany.mock.calls[0][0].data[0].label).toBe("Partially approved by Finance (₹3,000 of ₹4,000)");
  });
  it("rejects approval greater than the final edited request", async () => { expect((await edit({ amount: 1000, status: "APPROVED", approvedAmount: 3000 })).status).toBe(400); noWrites(); });
  it.each([0, -1, 5000.01, "3000"])("rejects invalid approved amount %s", async (approvedAmount) => { expect((await edit({ status: "APPROVED", approvedAmount })).status).toBe(400); noWrites(); });
  it("preserves a cleared partial when reverting without explicit amount", async () => {
    m.ticket.findFirst.mockResolvedValue({ ...existing, status: "CLEARED", approvedAmount: new Prisma.Decimal(3000) });
    expect((await edit({ status: "APPROVED" })).status).toBe(200);
    expect(m.ticket.update.mock.calls[0][0].data.approvedAmount).toBeUndefined(); expect(m.email).not.toHaveBeenCalled();
  });
  it("does not resend unchanged partial approval", async () => {
    m.ticket.findFirst.mockResolvedValue({ ...existing, status: "APPROVED", approvedAmount: new Prisma.Decimal(3000) });
    await edit({ status: "APPROVED", approvedAmount: 3000 }); expect(m.email).not.toHaveBeenCalled();
  });
  it("skips notification without an employee email and allows legacy fields", async () => {
    m.ticket.findFirst.mockResolvedValue({ ...existing, dealName: null, clientName: null, submittedBy: { verifiedNumber: { email: null } } });
    expect((await edit({ status: "APPROVED", approvedAmount: 3000 })).status).toBe(200); expect(m.email).not.toHaveBeenCalled();
  });
  it("waits for notification completion and tolerates a false result", async () => {
    let finish!: (value: boolean) => void;
    m.email.mockReturnValue(new Promise<boolean>((resolve) => { finish = resolve; }));
    let done = false;
    const result = edit({ status: "APPROVED", approvedAmount: 3000 }).then((r) => { done = true; return r; });
    await vi.waitFor(() => expect(m.email).toHaveBeenCalledOnce());
    expect(done).toBe(false); finish(false); expect((await result).status).toBe(200);
  });
  it("only deletes matching attachment IDs and awaits best-effort cleanup", async () => {
    m.attachment.findMany.mockResolvedValue([{ id: "ours", r2Key: file.r2Key }]);
    m.remove.mockRejectedValue(new Error("storage offline")); m.ticketEvent.createMany.mockRejectedValue(new Error("audit offline"));
    expect((await edit({ removeAttachmentIds: ["ours", "foreign"] })).status).toBe(200);
    expect(m.attachment.findMany).toHaveBeenCalledWith({ where: { id: { in: ["ours", "foreign"] }, ticketId: "ticket-1" }, select: { id: true, r2Key: true } });
    expect(m.attachment.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["ours"] }, ticketId: "ticket-1" } });
    expect(m.remove).toHaveBeenCalledExactlyOnceWith(file.r2Key);
  });
  it("does not delete attachments or notify when the update fails", async () => {
    m.ticket.update.mockRejectedValue(new Error("write failed"));
    await expect(edit({ title: "New", removeAttachmentIds: ["ours"] })).rejects.toThrow("write failed");
    expect(m.attachment.deleteMany).not.toHaveBeenCalled(); expect(m.remove).not.toHaveBeenCalled(); expect(m.email).not.toHaveBeenCalled();
  });
  it("returns 409 when the conditional update loses a race", async () => {
    m.ticket.update.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("changed", { code: "P2025", clientVersion: "5.22.0" }));
    expect((await edit({ status: "APPROVED" })).status).toBe(409); expect(m.email).not.toHaveBeenCalled();
  });
});

describe("upload ownership and signing", () => {
  it.each(["foreign", "tickets/employees/EMP-2/draft/receipt.pdf"])("rejects another namespace %s", async (r2Key) => {
    expect((await create(request({ ...valid, attachments: [{ ...file, r2Key }] }))).status).toBe(400);
    expect(m.metadata).not.toHaveBeenCalled(); noWrites();
  });
  it("rejects missing or incomplete uploaded bytes", async () => {
    m.metadata.mockResolvedValue({ ContentLength: 1 }); expect((await create(request({ ...valid, attachments: [file] }))).status).toBe(400);
    m.metadata.mockRejectedValue(new Error("missing")); expect((await edit({ addAttachments: [file] })).status).toBe(400); noWrites();
  });
  it("adds an owned, completed attachment", async () => {
    expect((await edit({ addAttachments: [file] })).status).toBe(200);
    expect(m.ticket.update.mock.calls[0][0].data.attachments).toEqual({ create: [file] });
  });
  it("requires authentication before signing", async () => { m.user.mockResolvedValue(null); expect((await sign(request({}))).status).toBe(401); expect(m.upload).not.toHaveBeenCalled(); });
  it.each([undefined, "RB-42"])("signs a safe employee-scoped key with hint %s", async (ticketId) => {
    const response = await sign(request({ filename: "receipt (1).pdf", contentType: "application/pdf", ticketId }));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.key).toMatch(new RegExp(`^tickets/employees/EMP-1/${ticketId ?? "draft"}/[a-f0-9-]+-receipt_1_.pdf$`));
    expect(m.upload).toHaveBeenCalledWith(data.key, "application/pdf", 300);
  });
  it.each([null, [], {}, { filename: 123, contentType: "application/pdf" }, { filename: "a", contentType: "text/html" }, { filename: "a", contentType: "image/png", ticketId: "../other" }])("rejects malformed signing input %j", async (body) => { expect((await sign(request(body))).status).toBe(400); expect(m.upload).not.toHaveBeenCalled(); });
  it("rejects invalid signing JSON and reports signer failures", async () => {
    expect((await sign(badJson())).status).toBe(400);
    m.upload.mockRejectedValue(new Error("sign failed"));
    expect((await sign(request({ filename: "a.png", contentType: "image/png" }))).status).toBe(500);
  });
});

describe("download access", () => {
  const get = () => download(new Request("http://portal.test"), ctx("attachment-1"));
  it("rejects unauthenticated, missing, and foreign attachments without signing", async () => {
    m.user.mockResolvedValue(null); expect((await get()).status).toBe(401);
    m.user.mockResolvedValue({ ...employee, empID: "EMP-2" }); expect((await get()).status).toBe(403);
    m.attachment.findUnique.mockResolvedValue(null); expect((await get()).status).toBe(404); expect(m.download).not.toHaveBeenCalled();
  });
  it.each([false, true])("allows owner/admin access (admin=%s) with stored content type", async (isAdmin) => {
    m.user.mockResolvedValue({ ...employee, empID: isAdmin ? "EMP-2" : "EMP-1", isAdmin });
    const response = await get(); expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ url: "https://storage.test/receipt.pdf", name: "receipt.pdf", contentType: "application/pdf" });
    expect(m.download).toHaveBeenCalledExactlyOnceWith(file.r2Key, 300, { contentType: "application/pdf" });
  });
  it("reports a signing failure", async () => { m.download.mockRejectedValue(new Error("unavailable")); expect((await get()).status).toBe(500); });
});
