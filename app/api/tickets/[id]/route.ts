import { NextResponse } from "next/server";
import { Prisma, TicketStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { deleteObject } from "@/lib/r2";
import { sendPartialApprovalEmail } from "@/lib/email";
import { InputError } from "@/lib/validation";
import { approvalAmount, parseTicketPatch } from "@/lib/tickets";
import { verifyAttachments } from "@/lib/attachment-access";

export const runtime = "nodejs";

const STATUS_LABEL: Record<TicketStatus, string> = {
  APPROVED: "Approved by Finance",
  CLEARED: "Cleared by Finance",
  REJECTED: "Rejected by Finance",
  PENDING: "Marked pending",
  REVIEW: "Marked under review",
  CANCELLED: "Cancelled",
};

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  let json: unknown;
  try { json = await req.json(); }
  catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  try {
    const body = parseTicketPatch(json);
    const existing = await prisma.ticket.findFirst({
      where: { OR: [{ id }, { shortCode: id }] },
      select: { id: true, status: true, updatedAt: true, submittedByEmpID: true,
        amount: true, approvedAmount: true, shortCode: true, title: true, dealName: true, clientName: true,
        submittedBy: { select: { verifiedNumber: { select: { email: true, name: true } } } },
      },
    });
    if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
    const isOwner = existing.submittedByEmpID === user.empID;
    const editable = existing.status === "PENDING" || existing.status === "REVIEW";
    if (body.editingFields && !isOwner) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    if (body.status !== undefined) {
      if (body.status === "CANCELLED") {
        if (!isOwner && !user.isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
        if (!editable) return NextResponse.json({ error: `cannot cancel ticket in ${existing.status} state` }, { status: 409 });
      } else if (!user.isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    if (body.editingFields && !editable) return NextResponse.json({ error: `cannot edit ticket in ${existing.status} state` }, { status: 409 });
    const requestedAmount = body.amount ?? Number(existing.amount);
    const approvedAmount = body.status === undefined ? undefined
      : approvalAmount(body.status, existing.status, requestedAmount, body.approvedAmount);
    await verifyAttachments(body.addAttachments, user.empID);

    // Conditional update detects another writer since our read. Attachment rows
    // are removed only within this transaction, after acquiring the ticket lock.
    const removed = await prisma.$transaction(async (tx) => {
      await tx.ticket.update({
        where: { id: existing.id, updatedAt: existing.updatedAt, status: existing.status },
        data: { title: body.title, category: body.category, amount: body.amount,
          // Always advance the version, even for writes within one millisecond
          // or after a server clock correction.
          updatedAt: new Date(Math.max(Date.now(), existing.updatedAt.getTime() + 1)),
          description: body.description, expenseDate: body.expenseDate, dealName: body.dealName, clientName: body.clientName,
          status: body.status, approvedAmount,
          attachments: body.addAttachments.length ? { create: body.addAttachments } : undefined,
        },
        select: { id: true },
      });
      if (!body.removeAttachmentIds.length) return [];
      const rows = await tx.attachment.findMany({
        where: { id: { in: body.removeAttachmentIds }, ticketId: existing.id }, select: { id: true, r2Key: true },
      });
      if (rows.length) await tx.attachment.deleteMany({ where: { id: { in: rows.map((a) => a.id) }, ticketId: existing.id } });
      return rows;
    });

    const labels: string[] = [];
    if (body.status !== undefined) labels.push(approvedAmount != null
      ? `Partially approved by Finance (₹${approvedAmount.toLocaleString("en-IN")} of ₹${requestedAmount.toLocaleString("en-IN")})`
      : STATUS_LABEL[body.status]);
    if (body.editingFields && body.status === undefined) labels.push("Ticket edited");
    await Promise.all([
      labels.length ? prisma.ticketEvent.createMany({ data: labels.map((label) => ({ ticketId: existing.id, label })) }).catch(() => {}) : Promise.resolve(),
      ...removed.map((a) => deleteObject(a.r2Key).catch(() => {})),
    ]);
    if (approvedAmount != null && Number(existing.approvedAmount ?? -1) !== approvedAmount) {
      const vn = existing.submittedBy.verifiedNumber;
      if (vn?.email) await sendPartialApprovalEmail({
        to: vn.email, name: vn.name ?? "there", shortCode: existing.shortCode,
        title: body.title ?? existing.title, requestedAmount, approvedAmount,
        dealName: body.dealName ?? existing.dealName, clientName: body.clientName ?? existing.clientName,
      });
    }
    return NextResponse.json({ ok: true, id: existing.id });
  } catch (error) {
    if (error instanceof InputError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return NextResponse.json({ error: "ticket changed; refresh and try again" }, { status: 409 });
    }
    throw error;
  }
}
