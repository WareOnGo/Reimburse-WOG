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
  title?: string;
  category?: string;
  amount?: number;
  description?: string;
  addAttachments?: AttachmentInput[];
  removeAttachmentIds?: string[];
};

const STATUS_LABEL: Record<TicketStatus, string> = {
  APPROVED: "Approved by Finance",
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
      select: { id: true, status: true, submittedByEmpID: true },
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

  // Build event labels for the audit timeline (created after the main update, fire-and-forget)
  const eventLabels: string[] = [];
  if (editingStatus) eventLabels.push(STATUS_LABEL[body.status as TicketStatus]);
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
        status: editingStatus ? body.status : undefined,
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
