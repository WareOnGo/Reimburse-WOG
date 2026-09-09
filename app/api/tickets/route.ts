import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { InputError } from "@/lib/validation";
import { nextTicketCode, parseCreateTicket } from "@/lib/tickets";
import { verifyAttachments } from "@/lib/attachment-access";

export const runtime = "nodejs";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const where = user.isAdmin ? {} : { submittedByEmpID: user.empID };

  const tickets = await prisma.ticket.findMany({
    where,
    orderBy: { createdAt: "desc" },
    relationLoadStrategy: "join",
    include: {
      submittedBy: {
        include: { verifiedNumber: { select: { email: true, name: true } } },
      },
      attachments: true,
      events: { orderBy: { createdAt: "asc" } },
    },
  });
  return NextResponse.json(tickets);
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let json: unknown;
  try { json = await req.json(); }
  catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  try {
    const { attachments, ...fields } = parseCreateTicket(json);
    await verifyAttachments(attachments, user.empID);
    const ticket = await prisma.$transaction(async (tx) => {
      const shortCode = await nextTicketCode(tx);
      return tx.ticket.create({
        data: { ...fields, shortCode, submittedByEmpID: user.empID,
          attachments: attachments.length ? { create: attachments } : undefined },
        select: { id: true, shortCode: true },
      });
    });
    // Best-effort audit is awaited so the runtime can complete the attempt.
    await prisma.ticketEvent.create({ data: { ticketId: ticket.id, label: "Ticket submitted" } }).catch(() => {});
    return NextResponse.json(ticket, { status: 201 });
  } catch (error) {
    if (error instanceof InputError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
