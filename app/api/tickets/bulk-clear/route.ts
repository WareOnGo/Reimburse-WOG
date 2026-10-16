import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { InputError, record, requiredText } from "@/lib/validation";

export const runtime = "nodejs";

class BulkClearConflict extends Error {}

export async function PATCH(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!user.isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  let json: unknown;
  try { json = await req.json(); }
  catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }

  try {
    const body = record(json);
    if (!Array.isArray(body.ids) || body.ids.length === 0) {
      throw new InputError("select at least one ticket to clear");
    }
    const ids = [...new Set(body.ids.map((id) => requiredText(id, "ticket id")))];

    await prisma.$transaction(async (tx) => {
      const tickets = await tx.ticket.findMany({
        where: { id: { in: ids } },
        select: { id: true, status: true, updatedAt: true },
      });
      if (tickets.length !== ids.length || tickets.some((ticket) => ticket.status !== "APPROVED")) {
        throw new BulkClearConflict();
      }

      // Match every version read above. A competing edit rolls back the whole
      // batch, including any rows this update successfully matched.
      const changedAt = new Date(tickets.reduce((latest, ticket) => Math.max(latest, ticket.updatedAt.getTime() + 1), Date.now()));
      const updated = await tx.ticket.updateMany({
        where: {
          status: "APPROVED",
          OR: tickets.map(({ id, updatedAt }) => ({ id, updatedAt })),
        },
        data: {
          status: "CLEARED",
          updatedAt: changedAt,
        },
      });
      if (updated.count !== ids.length) throw new BulkClearConflict();

      await tx.ticketEvent.createMany({
        data: ids.map((ticketId) => ({ ticketId, label: "Cleared by Finance", createdAt: changedAt })),
      });
    });

    return NextResponse.json({ ok: true, count: ids.length });
  } catch (error) {
    if (error instanceof InputError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof BulkClearConflict) {
      return NextResponse.json({ error: "Selected entries changed or are no longer approved. Refresh and try again." }, { status: 409 });
    }
    throw error;
  }
}
