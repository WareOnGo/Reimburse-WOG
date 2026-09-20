import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  user: vi.fn(), transaction: vi.fn(),
  ticket: { findMany: vi.fn(), updateMany: vi.fn() },
  ticketEvent: { createMany: vi.fn() },
}));
vi.mock("@/lib/auth", () => ({ getCurrentUser: m.user }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: m.transaction } }));
import { PATCH } from "./route";

const updatedAt = new Date("2026-09-20T00:00:00Z");
const tickets = ["first", "second"].map((id) => ({ id, status: "APPROVED", updatedAt }));
const request = (body: unknown) => new Request("http://portal.test/api/tickets/bulk-clear", {
  method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});
function noWrites() {
  expect(m.ticket.updateMany).not.toHaveBeenCalled();
  expect(m.ticketEvent.createMany).not.toHaveBeenCalled();
}
beforeEach(() => {
  vi.resetAllMocks();
  m.user.mockResolvedValue({ empID: "FINANCE", isAdmin: true });
  m.transaction.mockImplementation(async (fn: (tx: typeof m) => Promise<void>) => fn(m));
  m.ticket.findMany.mockResolvedValue(tickets);
  m.ticket.updateMany.mockResolvedValue({ count: 2 });
  m.ticketEvent.createMany.mockResolvedValue({ count: 2 });
});

describe("bulk clearance", () => {
  it.each([[null, 401], [{ empID: "EMP-1", isAdmin: false }, 403]])("requires admin authorization (%j)", async (user, status) => {
    m.user.mockResolvedValue(user);
    expect((await PATCH(request({ ids: ["first", "second"] }))).status).toBe(status);
    expect(m.transaction).not.toHaveBeenCalled(); noWrites();
  });
  it.each([null, [], {}, { ids: "first" }, { ids: [] }, { ids: [null] }, { ids: [1] }, { ids: [" "] }, { ids: [{}] }])("rejects invalid input %j", async (body) => {
    expect((await PATCH(request(body))).status).toBe(400);
    expect(m.transaction).not.toHaveBeenCalled(); noWrites();
  });
  it("rejects invalid JSON before starting a transaction", async () => {
    expect((await PATCH(new Request("http://portal.test", { method: "PATCH", body: "{" }))).status).toBe(400);
    expect(m.transaction).not.toHaveBeenCalled(); noWrites();
  });
  it("clears unique IDs with version checks and audit events, leaving money untouched", async () => {
    vi.spyOn(Date, "now").mockReturnValue(updatedAt.getTime());
    const response = await PATCH(request({ ids: [" first ", "second", "first"] }));
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ ok: true, count: 2 });
    expect(m.transaction).toHaveBeenCalledOnce();
    expect(m.ticket.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["first", "second"] } }, select: { id: true, status: true, updatedAt: true },
    });
    expect(m.ticket.updateMany).toHaveBeenCalledExactlyOnceWith({
      where: { status: "APPROVED", OR: [{ id: "first", updatedAt }, { id: "second", updatedAt }] },
      data: { status: "CLEARED", updatedAt: new Date(updatedAt.getTime() + 1) },
    });
    expect(m.ticketEvent.createMany).toHaveBeenCalledExactlyOnceWith({ data: [
      { ticketId: "first", label: "Cleared by Finance" }, { ticketId: "second", label: "Cleared by Finance" },
    ] });
  });
  it.each(["PENDING", "REVIEW", "CLEARED", "REJECTED", "CANCELLED"])("rejects the entire selection when one ticket is %s", async (status) => {
    m.ticket.findMany.mockResolvedValue([tickets[0], { ...tickets[1], status }]);
    const response = await PATCH(request({ ids: ["first", "second"] }));
    expect(response.status).toBe(409); expect(await response.json()).toEqual({ error: expect.stringContaining("no longer approved") }); noWrites();
  });
  it("rejects a selection containing a missing ticket", async () => {
    m.ticket.findMany.mockResolvedValue([tickets[0]]);
    expect((await PATCH(request({ ids: ["first", "missing"] }))).status).toBe(409); noWrites();
  });
  it("aborts the transaction when a concurrent edit prevents a complete update", async () => {
    m.ticket.updateMany.mockResolvedValue({ count: 1 });
    expect((await PATCH(request({ ids: ["first", "second"] }))).status).toBe(409);
    expect(m.ticketEvent.createMany).not.toHaveBeenCalled();
    await expect(m.transaction.mock.results[0].value).rejects.toThrow();
  });
  it("propagates persistence failure without recording clearance events", async () => {
    m.ticket.updateMany.mockRejectedValue(new Error("database offline"));
    await expect(PATCH(request({ ids: ["first", "second"] }))).rejects.toThrow("database offline");
    expect(m.ticketEvent.createMany).not.toHaveBeenCalled();
  });
});
