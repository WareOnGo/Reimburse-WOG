import { Prisma, TicketStatus } from "@prisma/client";
import { attachmentIds, attachments, expenseDate, InputError, money, record, requiredText, ticketStatus } from "./validation";

const textFields = ["title", "category", "description", "dealName", "clientName"] as const;
export function parseCreateTicket(value: unknown) {
  const body = record(value);
  return {
    title: requiredText(body.title, "title"), category: requiredText(body.category, "category"),
    description: requiredText(body.description, "description"),
    dealName: requiredText(body.dealName, "deal name"), clientName: requiredText(body.clientName, "client name"),
    amount: money(body.amount), expenseDate: expenseDate(body.expenseDate), attachments: attachments(body.attachments),
  };
}

export function parseTicketPatch(value: unknown) {
  const body = record(value);
  const fields: Partial<Record<typeof textFields[number], string>> = {};
  for (const key of textFields) if (body[key] !== undefined) fields[key] = requiredText(body[key], key);
  const result = {
    ...fields,
    amount: body.amount === undefined ? undefined : money(body.amount),
    expenseDate: body.expenseDate === undefined ? undefined : expenseDate(body.expenseDate),
    status: body.status === undefined ? undefined : ticketStatus(body.status),
    approvedAmount: body.approvedAmount === undefined || body.approvedAmount === null
      ? body.approvedAmount : money(body.approvedAmount, "approved amount"),
    addAttachments: attachments(body.addAttachments), removeAttachmentIds: attachmentIds(body.removeAttachmentIds),
  };
  if (result.approvedAmount !== undefined && result.status !== "APPROVED") {
    throw new InputError("approved amount requires APPROVED status");
  }
  const editingFields = Object.keys(fields).length > 0 || result.amount !== undefined || result.expenseDate !== undefined
    || result.addAttachments.length > 0 || result.removeAttachmentIds.length > 0;
  if (!editingFields && result.status === undefined) throw new InputError("no ticket changes supplied");
  return { ...result, editingFields };
}

export function approvalAmount(status: TicketStatus, previousStatus: TicketStatus, requested: number, approved: number | null | undefined) {
  if (status !== "APPROVED") return undefined;
  if (previousStatus === "CLEARED" && approved === undefined) return undefined;
  if (approved == null) return null;
  if (approved <= 0 || approved > requested) throw new InputError(`approved amount must be greater than 0 and at most ${requested}`);
  return approved === requested ? null : approved;
}

/** Serialize code allocation within the same transaction as ticket creation.
 * The lock is scoped to this portal; MAX ignores legacy/malformed codes.
 */
export async function nextTicketCode(tx: Prisma.TransactionClient): Promise<string> {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(7272001)::text`;
  const [row] = await tx.$queryRaw<{ next: bigint }[]>`
    SELECT COALESCE(MAX(SUBSTRING("shortCode" FROM '^RB-([0-9]+)$')::bigint), 2000) + 1 AS next FROM "Ticket"
  `;
  return `RB-${row.next}`;
}
