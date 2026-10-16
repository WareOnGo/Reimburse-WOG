import { beforeEach, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
const m = vi.hoisted(() => ({ execute: vi.fn(), query: vi.fn(), details: vi.fn(), transaction: vi.fn(), finished: vi.fn() }));
vi.mock("./prisma", () => ({ prisma: { $transaction: m.transaction } }));
import { EXPORT_BATCH_SIZE, ticketExportCandidates, ticketExportPreview, ticketExportStream } from "./ticket-export-data";
import { ticketExportRange, ticketExportRow } from "./ticket-export";
const ticket: Parameters<typeof ticketExportRow>[0] = {
  id: "one", shortCode: "RB-1", title: "Travel", category: "Travel", description: "Client visit",
  amount: new Prisma.Decimal("1250.75"), approvedAmount: new Prisma.Decimal("750.25"), status: "CLEARED",
  submittedByEmpID: "EMP-1", submittedBy: { verifiedNumber: { name: "Asha", email: "asha@example.test" } },
  createdAt: new Date("2026-09-09T18:30:00Z"), updatedAt: new Date("2026-09-11T00:00:00Z"),
  expenseDate: null, clientName: null, dealName: null,
  events: [{ label: "Cleared by Finance", createdAt: new Date("2026-09-11T00:00:00Z") }],
};
const tx = { $executeRaw: m.execute, $queryRaw: m.query, ticket: { findMany: m.details } };
const sql = (query: Prisma.Sql | TemplateStringsArray) => "sql" in query ? query.sql : query.join("?");
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
beforeEach(() => {
  vi.resetAllMocks(); m.execute.mockResolvedValue(0);
  m.query.mockImplementation(async (query: Prisma.Sql | TemplateStringsArray) => sql(query).includes("COUNT") ? [{ count: 1n }] : [{ id: ticket.id }]);
  m.details.mockResolvedValue([ticket]);
  m.transaction.mockImplementation(async (callback) => { try { return await callback(tx); } finally { m.finished(); } });
});

it("uses parameterized independent date scans with duplicate removal, and skips event scans for all history", () => {
  expect(ticketExportCandidates({}).sql).not.toContain("TicketEvent");
  for (const query of ["from=2026-09-10", "to=2026-09-10", "from=2026-09-10&to=2026-09-11"]) {
    const statement = ticketExportCandidates(ticketExportRange(new URLSearchParams(query)));
    expect(statement.sql).toContain("UNION"); expect(statement.sql).not.toContain("OFFSET");
    expect(statement.sql).toContain("AT TIME ZONE 'UTC'");
    expect(statement.sql).not.toContain("2026-");
    expect(statement.values.every((value) => value instanceof Date)).toBe(true);
  }
});

it("counts and loads only five preview tickets in one read-only snapshot", async () => {
  expect(await ticketExportPreview({})).toEqual({ count: 1, rows: [ticketExportRow(ticket)] });
  expect(sql(m.query.mock.calls[1][0])).toContain("LIMIT 5");
  expect(m.details.mock.calls[0][0].where).toEqual({ id: { in: ["one"] } });
  expect(m.transaction.mock.calls[0][1].isolationLevel).toBe("RepeatableRead");
  expect(sql(m.execute.mock.calls[0][0])).toBe("SET TRANSACTION READ ONLY");
});
it("does not query ticket details for an empty preview", async () => {
  m.query.mockResolvedValueOnce([{ count: 0n }]).mockResolvedValueOnce([]);
  expect(await ticketExportPreview({})).toEqual({ count: 0, rows: [] });
  expect(m.details).not.toHaveBeenCalled();
});

it("waits for demand between batches and outputs one BOM/header with exact amounts", async () => {
  const first = Array.from({ length: EXPORT_BATCH_SIZE }, (_, index) => ({ ...ticket, id: `id-${index}`, shortCode: `RB-${index}` }));
  m.query.mockResolvedValueOnce(first.map(({ id }) => ({ id }))).mockResolvedValueOnce([{ id: "last" }]);
  m.details.mockResolvedValueOnce(first).mockResolvedValueOnce([{ ...ticket, id: "last", shortCode: "LAST" }]);
  const stream = await ticketExportStream({}, new AbortController().signal);
  await tick(); expect(m.query).toHaveBeenCalledTimes(1);
  const reader = stream.getReader();
  const header = (await reader.read()).value!;
  expect([...header.slice(0, 3)]).toEqual([239, 187, 191]);
  await tick(); expect(m.query).toHaveBeenCalledTimes(1);
  const firstChunk = new TextDecoder().decode((await reader.read()).value);
  expect(firstChunk.match(/^"RB-/gm)).toHaveLength(EXPORT_BATCH_SIZE);
  const last = new TextDecoder().decode((await reader.read()).value);
  expect(last).toContain('"LAST"'); expect(last).toContain('"1250.75","750.25","750.25"');
  expect(firstChunk + last).not.toContain("Current requested amount");
  expect((await reader.read()).done).toBe(true); expect(m.finished).toHaveBeenCalledOnce();
  expect(m.query.mock.calls.every(([query]) => sql(query) === `FETCH FORWARD ${EXPORT_BATCH_SIZE} FROM ticket_history_export`)).toBe(true);
  expect(sql(m.execute.mock.calls.at(-1)![0])).toBe("CLOSE ticket_history_export");
});
it("exports just the header when nothing matches", async () => {
  m.query.mockResolvedValue([]);
  const text = await new Response(await ticketExportStream({}, new AbortController().signal)).text();
  expect(text.split("\r\n")).toHaveLength(2); expect(m.details).not.toHaveBeenCalled();
});

it.each(["reader", "request"])("releases the snapshot on %s cancellation while backpressured", async (kind) => {
  m.details.mockResolvedValue(Array.from({ length: EXPORT_BATCH_SIZE }, () => ticket));
  const abort = new AbortController();
  const reader = (await ticketExportStream({}, abort.signal)).getReader();
  await reader.read(); await tick();
  if (kind === "reader") await reader.cancel();
  else { abort.abort(); await expect(reader.read()).rejects.toMatchObject({ name: "AbortError" }); await tick(); }
  expect(m.finished).toHaveBeenCalledOnce(); expect(m.query).toHaveBeenCalledTimes(1);
});
it("does not open a transaction for an already-aborted request", async () => {
  const abort = new AbortController(); abort.abort();
  await expect(ticketExportStream({}, abort.signal)).rejects.toMatchObject({ name: "AbortError" });
  expect(m.transaction).not.toHaveBeenCalled();
});
it("handles cancellation during the initial database query without returning a stream", async () => {
  let resolve!: (ids: { id: string }[]) => void;
  m.query.mockReturnValue(new Promise((done) => { resolve = done; }));
  const abort = new AbortController();
  const pending = ticketExportStream({}, abort.signal);
  const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
  await tick(); abort.abort(); await rejected; resolve([{ id: "one" }]); await tick();
  expect(m.details).not.toHaveBeenCalled(); expect(m.finished).toHaveBeenCalledOnce();
});
it("fails before response headers on an initial query or connection failure", async () => {
  m.query.mockRejectedValueOnce(new Error("database offline"));
  await expect(ticketExportStream({}, new AbortController().signal)).rejects.toThrow("database offline");
  m.transaction.mockRejectedValueOnce(new Error("pool exhausted"));
  await expect(ticketExportStream({}, new AbortController().signal)).rejects.toThrow("pool exhausted");
});
it("errors the body instead of completing a truncated CSV when a later fetch fails", async () => {
  m.details.mockResolvedValue(Array.from({ length: EXPORT_BATCH_SIZE }, () => ticket));
  m.query.mockResolvedValueOnce([{ id: "one" }]).mockRejectedValueOnce(new Error("connection lost"));
  const response = new Response(await ticketExportStream({}, new AbortController().signal));
  await expect(response.text()).rejects.toThrow("connection lost"); expect(m.finished).toHaveBeenCalledOnce();
});
it("unblocks the producer and fails a slow download when its transaction times out", async () => {
  let timeout!: (error: Error) => void;
  m.transaction.mockImplementation((callback) => Promise.race([
    callback(tx).finally(m.finished), new Promise((_, reject) => { timeout = reject; }),
  ]));
  const reader = (await ticketExportStream({}, new AbortController().signal)).getReader();
  timeout(new Error("transaction timed out"));
  await tick(); await expect(reader.read()).rejects.toThrow("transaction timed out");
  expect(m.finished).toHaveBeenCalledOnce();
});
