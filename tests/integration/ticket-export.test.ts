import { afterAll, beforeEach, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { open, readFile, writeFile } from "node:fs/promises";
import { prisma } from "@/lib/prisma";
import { EXPORT_BATCH_SIZE, ticketExportCandidates, ticketExportPreview, ticketExportStream } from "@/lib/ticket-export-data";
import { ticketExportRange, ticketExportWhere } from "@/lib/ticket-export";

const database = new URL(process.env.ERP_TEST_DATABASE_URL!);
if (database.hostname !== "127.0.0.1" || database.pathname !== "/erp_test") throw new Error("Disposable database required");
beforeEach(async () => { await prisma.ticket.deleteMany(); });
afterAll(() => prisma.$disconnect());

async function seed(count: number) {
  await prisma.$executeRaw`
    INSERT INTO "Ticket" (id, "shortCode", title, category, description, amount, "approvedAmount", status, "submittedByEmpID", "createdAt", "updatedAt")
    SELECT 'load-' || lpad(i::text, 6, '0'), 'LOAD-' || lpad(i::text, 6, '0'),
      CASE WHEN i % 1000 = 0 THEN '=1+1' ELSE 'Benchmark "trip", Bengaluru' END,
      'Travel', repeat('Export benchmark ', 32) || E'\nTransport', 1000.25,
      CASE WHEN i % 2 = 0 THEN 750.15 ELSE NULL END,
      (CASE i % 3 WHEN 0 THEN 'CLEARED' WHEN 1 THEN 'APPROVED' ELSE 'PENDING' END)::"TicketStatus",
      CASE WHEN i % 2 = 0 THEN 'EMP-1' ELSE 'EMP-2' END,
      timestamp '2025-01-01' + (i % 365) * interval '1 day',
      timestamp '2026-01-01'
    FROM generate_series(1, ${count}::int) i`;
  await prisma.$executeRaw`
    INSERT INTO "TicketEvent" (id, "ticketId", label, "createdAt")
    SELECT t.id || '-event-' || n, t.id,
      CASE n WHEN 0 THEN 'Ticket submitted' WHEN 1 THEN
        CASE WHEN t."approvedAmount" IS NULL THEN 'Approved by Finance' ELSE 'Partially approved by Finance (₹750.15 of ₹1,000.25)' END
        WHEN 2 THEN 'Ticket edited' ELSE 'Cleared by Finance' END,
      t."createdAt" + n * interval '1 day'
    FROM "Ticket" t CROSS JOIN generate_series(0, 3) n`;
}

it("streams beyond multiple batch boundaries with one snapshot despite concurrent changes", async () => {
  const count = EXPORT_BATCH_SIZE * 2 + 3;
  await seed(count);
  const expected = await prisma.ticket.findMany({ select: { id: true, shortCode: true }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
  const stream = await ticketExportStream({}, new AbortController().signal);
  const reader = stream.getReader();
  const header = (await reader.read()).value!;
  const late = expected.at(-1)!;
  await prisma.ticket.update({ where: { id: late.id }, data: { amount: 999.99, status: "REJECTED" } });
  await prisma.ticketEvent.create({ data: { ticketId: late.id, label: "Changed during export" } });
  await prisma.ticket.create({ data: { id: "new-after-snapshot", shortCode: "NEW", title: "New", description: "New", category: "Meals", amount: 1, submittedByEmpID: "EMP-1" } });
  let text = new TextDecoder().decode(header);
  for (;;) { const chunk = await reader.read(); if (chunk.done) break; text += new TextDecoder().decode(chunk.value); }
  expect([...text.matchAll(/^"(LOAD-\d+)"/gm)].map((match) => match[1])).toEqual(expected.map((ticket) => ticket.shortCode));
  expect(text).not.toContain("999.99"); expect(text).not.toContain("Changed during export"); expect(text).not.toContain('"NEW"');
  expect(text.match(/"Current requested amount \(INR\)"/g)).toHaveLength(1);
});

it("releases a cancelled cursor transaction and keeps matching dates independent of the database timezone", async () => {
  await seed(EXPORT_BATCH_SIZE * 2);
  const controller = new AbortController();
  const stream = await ticketExportStream({}, controller.signal);
  const reader = stream.getReader(); await reader.read();
  controller.abort(); await expect(reader.read()).rejects.toMatchObject({ name: "AbortError" });
  // Query the same pool after cancellation; no cursor/snapshot blocks writes.
  await prisma.ticket.updateMany({ data: { status: "APPROVED" } });
  const params = new URLSearchParams("from=2025-06-15&to=2025-06-15");
  const expected = await prisma.ticket.findMany({ where: ticketExportWhere(params), select: { id: true } });
  const actual = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL TIME ZONE 'America/New_York'`;
    return tx.$queryRaw<{ id: string }[]>(ticketExportCandidates(ticketExportRange(params)));
  });
  expect(actual.map(({ id }) => id).sort()).toEqual(expected.map(({ id }) => id).sort());
});

it("exports 100,000 tickets with bounded batches and records query plans and resource use", async () => {
  const count = 100_000;
  await seed(count);
  const params = new URLSearchParams("from=2025-06-15&to=2025-06-15");
  const range = ticketExportRange(params);
  const indexes = await readFile("prisma/sql/20261017_ticket_export_indexes.sql", "utf8");
  // Only this freshly-created disposable database is changed for the comparison.
  await prisma.$executeRaw`DROP INDEX "Ticket_createdAt_id_idx"`;
  await prisma.$executeRaw`DROP INDEX "TicketEvent_ticketId_createdAt_id_idx"`;
  await prisma.$executeRaw`DROP INDEX "TicketEvent_export_milestone_date_idx"`;
  await prisma.$executeRaw`ANALYZE "Ticket"`; await prisma.$executeRaw`ANALYZE "TicketEvent"`;
  const oldQuery = Prisma.sql`SELECT t.id, t."createdAt" FROM "Ticket" t WHERE
    (t."createdAt" >= ${range.gte} AND t."createdAt" < ${range.lt}) OR EXISTS (
      SELECT 1 FROM "TicketEvent" e WHERE e."ticketId" = t.id AND e."createdAt" >= ${range.gte} AND e."createdAt" < ${range.lt}
      AND (e.label = 'Approved by Finance' OR e.label = 'Cleared by Finance' OR e.label LIKE 'Partially approved by Finance (%')
    ) ORDER BY t."createdAt" DESC, t.id DESC`;
  type Plan = { "Execution Time": number; Plan: { "Actual Rows": number; [key: string]: unknown } };
  async function explain(query: Prisma.Sql) {
    const [result] = await prisma.$queryRaw<{ "QUERY PLAN": Plan[] }[]>(Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query}`);
    return result["QUERY PLAN"][0];
  }
  const before = await explain(oldQuery);
  for (const statement of indexes.split(";").filter((sql) => sql.trim())) await prisma.$executeRawUnsafe(statement);
  const after = await explain(Prisma.sql`SELECT * FROM (${ticketExportCandidates(range)}) matching ORDER BY "createdAt" DESC, id DESC`);
  expect(after.Plan["Actual Rows"]).toBe(before.Plan["Actual Rows"]);
  expect(JSON.stringify(after.Plan)).toContain("TicketEvent_export_milestone_date_idx");
  const preview = await ticketExportPreview({});
  expect(preview.count).toBe(count); expect(preview.rows).toHaveLength(5);

  const file = await open("/tmp/erp-large-export.csv", "w");
  const initial = process.memoryUsage();
  let peakHeap = initial.heapUsed; let peakRss = initial.rss;
  let bytes = 0; let chunks = 0; let largestChunk = 0;
  const started = performance.now();
  try {
    const stream = await ticketExportStream({}, new AbortController().signal);
    const reader = stream.getReader();
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      await file.writeFile(value); bytes += value.byteLength; chunks++;
      largestChunk = Math.max(largestChunk, value.byteLength);
      const memory = process.memoryUsage(); peakHeap = Math.max(peakHeap, memory.heapUsed); peakRss = Math.max(peakRss, memory.rss);
    }
  } finally { await file.close(); }
  expect(chunks).toBe(1 + Math.ceil(count / EXPORT_BATCH_SIZE));
  expect(largestChunk).toBeLessThan(1_000_000);
  const report = { tickets: count, events: count * 4, bytes, chunks, largestChunk, batchSize: EXPORT_BATCH_SIZE,
    durationMs: Math.round(performance.now() - started),
    heapGrowthMiB: +(Math.max(0, peakHeap - initial.heapUsed) / 1024 ** 2).toFixed(2),
    rssGrowthMiB: +(Math.max(0, peakRss - initial.rss) / 1024 ** 2).toFixed(2),
    matchingRows: after.Plan["Actual Rows"], beforeQueryMs: before["Execution Time"], afterQueryMs: after["Execution Time"],
    before, after,
  };
  await writeFile("/tmp/erp-large-export-report.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, before: undefined, after: undefined }));
}, 180_000);
