import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { ticketExportCsv, ticketExportRange, ticketExportRow, ticketExportSelect } from "./ticket-export";

export const EXPORT_BATCH_SIZE = 250;
const EXPORT_TIMEOUT_MS = 240_000;
type Range = ReturnType<typeof ticketExportRange>;
type Id = { id: string };

/** Independent indexable date scans, then UNION removes tickets matching more
 * than one milestone. Only IDs and ordering keys enter the deduplication/sort.
 * Keep the literal event predicate aligned with the partial index rollout SQL.
 */
export function ticketExportCandidates(range: Range) {
  if (!range.gte && !range.lt) return Prisma.sql`SELECT t.id, t."createdAt" FROM "Ticket" t`;
  function dates(column: Prisma.Sql) {
    return Prisma.join([
      ...(range.gte ? [Prisma.sql`${column} >= (${range.gte}::timestamptz AT TIME ZONE 'UTC')`] : []),
      ...(range.lt ? [Prisma.sql`${column} < (${range.lt}::timestamptz AT TIME ZONE 'UTC')`] : []),
    ], " AND ");
  }
  return Prisma.sql`
    SELECT t.id, t."createdAt" FROM "Ticket" t WHERE ${dates(Prisma.sql`t."createdAt"`)}
    UNION
    SELECT t.id, t."createdAt" FROM "TicketEvent" e JOIN "Ticket" t ON t.id = e."ticketId"
    WHERE ${dates(Prisma.sql`e."createdAt"`)} AND (
      e.label = 'Approved by Finance' OR e.label = 'Cleared by Finance'
      OR e.label LIKE 'Partially approved by Finance (%'
    )`;
}

async function details(tx: Prisma.TransactionClient, ids: Id[]) {
  if (!ids.length) return [];
  return tx.ticket.findMany({
    where: { id: { in: ids.map(({ id }) => id) } }, select: ticketExportSelect,
    relationLoadStrategy: "join", orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
}

export async function ticketExportPreview(range: Range) {
  const candidates = ticketExportCandidates(range);
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    await tx.$executeRaw`SET LOCAL statement_timeout = '30s'`;
    const [total] = await tx.$queryRaw<{ count: bigint }[]>`SELECT COUNT(*) AS count FROM (${candidates}) matching`;
    const ids = await tx.$queryRaw<Id[]>`SELECT id FROM (${candidates}) matching ORDER BY "createdAt" DESC, id DESC LIMIT 5`;
    const tickets = await details(tx, ids);
    return { count: Number(total.count), rows: tickets.map(ticketExportRow) };
  }, { isolationLevel: "RepeatableRead", timeout: 60_000 });
}

/** The cursor scans the matching IDs once. Fetches and CSV chunks stay bounded,
 * with backpressure from the browser. The read-only snapshot includes related
 * events/amounts, and is released on completion, disconnect, failure or timeout.
 */
export async function ticketExportStream(range: Range, signal: AbortSignal): Promise<ReadableStream<Uint8Array>> {
  signal.throwIfAborted();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let stopped = false;
  let resume: (() => void) | undefined;
  let resolveReady!: () => void;
  let rejectReady!: (reason: unknown) => void;
  const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const encoder = new TextEncoder();
  const cancelled = () => new DOMException("Export cancelled", "AbortError");
  function stop(error: unknown, notifyReader: boolean) {
    if (stopped) return;
    stopped = true;
    rejectReady(error);
    if (notifyReader) controller.error(error);
    resume?.();
    signal.removeEventListener("abort", onAbort);
  }
  function onAbort() { stop(signal.reason ?? cancelled(), true); }
  async function demand() {
    while (!stopped && controller.desiredSize! <= 0) {
      await new Promise<void>((resolve) => { resume = resolve; });
      resume = undefined;
    }
    if (stopped) throw cancelled();
  }
  async function send(text: string) {
    await demand();
    controller.enqueue(encoder.encode(text));
  }
  const stream = new ReadableStream<Uint8Array>({
    start(value) { controller = value; },
    pull() { resume?.(); },
    async cancel() {
      stop(cancelled(), false);
      await work;
    },
  }, { highWaterMark: 1 });
  signal.addEventListener("abort", onAbort, { once: true });

  const work = prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    await tx.$executeRaw`SET LOCAL statement_timeout = '30s'`;
    // NO SCROLL avoids rewind storage. WITHOUT HOLD closes on commit/rollback.
    await tx.$executeRaw`DECLARE ticket_history_export NO SCROLL CURSOR WITHOUT HOLD FOR
      SELECT id FROM (${ticketExportCandidates(range)}) matching ORDER BY "createdAt" DESC, id DESC`;
    async function batch() {
      const ids = await tx.$queryRaw<Id[]>(Prisma.sql`FETCH FORWARD ${Prisma.raw(String(EXPORT_BATCH_SIZE))} FROM ticket_history_export`);
      if (stopped) throw cancelled();
      return details(tx, ids);
    }
    let tickets = await batch();
    if (stopped) throw cancelled();
    // Fail initial SQL before returning CSV headers to the browser.
    resolveReady();
    await send(ticketExportCsv([]));
    while (tickets.length) {
      await send(ticketExportCsv(tickets.map(ticketExportRow), false));
      if (tickets.length < EXPORT_BATCH_SIZE) break;
      await demand();
      tickets = await batch();
    }
    await tx.$executeRaw`CLOSE ticket_history_export`;
  }, { isolationLevel: "RepeatableRead", timeout: EXPORT_TIMEOUT_MS, maxWait: 5000 }).then(() => {
    if (!stopped) { stopped = true; controller.close(); }
    signal.removeEventListener("abort", onAbort);
  }, (error: unknown) => { stop(error, true); });

  await ready;
  return stream;
}
