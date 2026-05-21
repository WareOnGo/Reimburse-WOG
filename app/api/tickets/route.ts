import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";

type AttachmentInput = {
  name: string;
  kind: "IMAGE" | "DOCUMENT";
  contentType: string;
  sizeBytes: number;
  r2Key: string;
};

type CreateBody = {
  title: string;
  category: string;
  amount: number;
  description: string;
  attachments?: AttachmentInput[];
};

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
  let body: CreateBody;
  try {
    body = (await req.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  if (!body.title || !body.category || !body.description) {
    return NextResponse.json({ error: "missing required fields" }, { status: 400 });
  }
  if (typeof body.amount !== "number" || !isFinite(body.amount) || body.amount < 0) {
    return NextResponse.json({ error: "amount must be a non-negative number" }, { status: 400 });
  }

  // Parallel: auth + last-shortcode lookup. Saves one round-trip.
  const [user, last] = await Promise.all([
    getCurrentUser(),
    prisma.ticket.findFirst({
      orderBy: { createdAt: "desc" },
      select: { shortCode: true },
    }),
  ]);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const nextNum = last?.shortCode ? Number(last.shortCode.replace(/^RB-/, "")) + 1 : 2001;
  const shortCode = `RB-${nextNum}`;

  // Create ticket (with attachments if any — required for referential atomicity).
  // Event creation is a separate, fire-and-forget audit insert.
  const ticket = await prisma.ticket.create({
    data: {
      shortCode,
      title: body.title,
      category: body.category,
      amount: body.amount,
      description: body.description,
      submittedByEmpID: user.empID,
      attachments: body.attachments?.length ? { create: body.attachments } : undefined,
    },
    select: { id: true, shortCode: true },
  });

  prisma.ticketEvent
    .create({ data: { ticketId: ticket.id, label: "Ticket submitted" } })
    .catch(() => {
      // best-effort audit
    });

  return NextResponse.json(ticket, { status: 201 });
}
