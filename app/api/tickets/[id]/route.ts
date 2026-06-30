import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { TicketStatus } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth";
import { deleteObject } from "@/lib/r2";

export const runtime = "nodejs";

type AttachmentInput = {
  name: string;
  kind: "IMAGE" | "DOCUMENT";
  contentType: string;
  sizeBytes: number;
  r2Key: string;
};

type PatchBody = {
  status?: TicketStatus;
  approvedAmount?: number | null;
  title?: string;
  category?: string;
  amount?: number;
  description?: string;
  expenseDate?: string | null;
  addAttachments?: AttachmentInput[];
  removeAttachmentIds?: string[];
};

const STATUS_LABEL: Record<TicketStatus, string> = {
  APPROVED: "Approved by Finance",
  CLEARED: "Cleared by Finance",
  REJECTED: "Rejected by Finance",
  PENDING: "Marked pending",
  REVIEW: "Marked under review",
  CANCELLED: "Cancelled",
};

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  // Parallel: auth + ticket lookup. Cuts one round-trip.
  const [user, existing] = await Promise.all([
    getCurrentUser(),
    prisma.ticket.findFirst({
      where: { OR: [{ id }, { shortCode: id }] },
      select: { id: true, status: true, submittedByEmpID: true, amount: true },
    }),
  ]);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  const isOwner = existing.submittedByEmpID === user.empID;
  const editingFields =
    body.title !== undefined ||
    body.category !== undefined ||
    body.amount !== undefined ||
    body.description !== undefined ||
    body.expenseDate !== undefined ||
    (body.addAttachments && body.addAttachments.length > 0) ||
    (body.removeAttachmentIds && body.removeAttachmentIds.length > 0);
  const editingStatus = body.status !== undefined;

  if (editingFields && !isOwner) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (editingStatus) {
    const wantCancel = body.status === "CANCELLED";
    if (wantCancel && !isOwner && !user.isAdmin) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    if (!wantCancel && !user.isAdmin) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    if (wantCancel && existing.status !== "PENDING" && existing.status !== "REVIEW") {
      return NextResponse.json(
        { error: `cannot cancel ticket in ${existing.status} state` },
        { status: 409 },
      );
    }
  }

  if (editingFields) {
    if (existing.status !== "PENDING" && existing.status !== "REVIEW") {
      return NextResponse.json(
        { error: `cannot edit ticket in ${existing.status} state` },
        { status: 409 },
      );
    }
    if (body.amount !== undefined && (typeof body.amount !== "number" || !isFinite(body.amount) || body.amount < 0)) {
      return NextResponse.json({ error: "amount must be a non-negative number" }, { status: 400 });
    }
  }
  if (editingStatus && !(body.status! in STATUS_LABEL)) {
    return NextResponse.json({ error: "invalid status" }, { status: 400 });
  }

  // Expense occurrence date: optional. Omitted ⇒ leave unchanged; null/"" ⇒ clear it.
  let expenseDateUpdate: Date | null | undefined = undefined;
  if (body.expenseDate !== undefined) {
    if (body.expenseDate === null || body.expenseDate === "") {
      expenseDateUpdate = null;
    } else {
      const d = new Date(body.expenseDate);
      if (isNaN(d.getTime())) {
        return NextResponse.json({ error: "invalid expense date" }, { status: 400 });
      }
      expenseDateUpdate = d;
    }
  }

  // Approved amount: only meaningful when approving. A null/omitted value means a full
  // approval (and clears any prior partial); a number is a partial approval and must be
  // within (0, requested amount]. Admin-only is already enforced above (non-cancel ⇒ admin).
  const requestedAmount = Number(existing.amount);
  let approvedAmountUpdate: number | null | undefined = undefined;
  if (editingStatus && body.status === "APPROVED") {
    if (existing.status === "CLEARED" && body.approvedAmount === undefined) {
      // Reverting a cleared ticket back to approved is a pure status change — preserve the
      // previously sanctioned (possibly partial) amount rather than collapsing it to full.
      // Leaving approvedAmountUpdate undefined makes Prisma skip the column. To change the
      // sanctioned amount during a revert, pass approvedAmount explicitly.
      approvedAmountUpdate = undefined;
    } else if (body.approvedAmount === undefined || body.approvedAmount === null) {
      approvedAmountUpdate = null;
    } else {
      if (
        typeof body.approvedAmount !== "number" ||
        !isFinite(body.approvedAmount) ||
        body.approvedAmount <= 0 ||
        body.approvedAmount > requestedAmount
      ) {
        return NextResponse.json(
          { error: `approved amount must be greater than 0 and at most ${requestedAmount}` },
          { status: 400 },
        );
      }
      // An approved amount equal to the request is just a full approval.
      approvedAmountUpdate = body.approvedAmount < requestedAmount ? body.approvedAmount : null;
    }
  }

  // Build event labels for the audit timeline (created after the main update, fire-and-forget)
  const eventLabels: string[] = [];
  if (editingStatus) {
    if (approvedAmountUpdate != null) {
      eventLabels.push(
        `Partially approved by Finance (₹${approvedAmountUpdate.toLocaleString("en-IN")} of ₹${requestedAmount.toLocaleString("en-IN")})`,
      );
    } else {
      eventLabels.push(STATUS_LABEL[body.status as TicketStatus]);
    }
  }
  if (editingFields && !editingStatus) eventLabels.push("Ticket edited");

  // For removed attachments: collect the R2 keys in parallel with the update
  let removedR2Keys: string[] = [];
  const attachmentCleanup =
    body.removeAttachmentIds?.length
      ? prisma.attachment
          .findMany({
            where: {
              id: { in: body.removeAttachmentIds },
              ticketId: existing.id,
            },
            select: { id: true, r2Key: true },
          })
          .then(async (rows) => {
            removedR2Keys = rows.map((r) => r.r2Key);
            if (rows.length === 0) return;
            await prisma.attachment.deleteMany({
              where: { id: { in: rows.map((r) => r.id) } },
            });
          })
      : Promise.resolve();

  // Single UPDATE (no nested writes → no implicit transaction, no extra SELECT).
  // Use updateMany so we can return just `{ count }` and rely on the prior findFirst for routing.
  await Promise.all([
    prisma.ticket.update({
      where: { id: existing.id },
      data: {
        title: body.title,
        category: body.category,
        amount: body.amount,
        description: body.description,
        expenseDate: expenseDateUpdate,
        status: editingStatus ? body.status : undefined,
        approvedAmount: approvedAmountUpdate,
        attachments: body.addAttachments?.length
          ? { create: body.addAttachments }
          : undefined,
      },
      select: { id: true },
    }),
    attachmentCleanup,
  ]);

  // Audit events: fire-and-forget. Don't block the response on this.
  if (eventLabels.length > 0) {
    prisma.ticketEvent
      .createMany({
        data: eventLabels.map((label) => ({ ticketId: existing.id, label })),
      })
      .catch(() => {
        // best-effort
      });
  }

  // R2 cleanup is already best-effort
  for (const key of removedR2Keys) {
    deleteObject(key).catch(() => {
      // best-effort
    });
  }

  return NextResponse.json({ ok: true, id: existing.id });
}
