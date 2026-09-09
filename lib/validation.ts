import { TicketStatus } from "@prisma/client";

export class InputError extends Error {}
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new InputError("body must be an object");
  }
  return value as Record<string, unknown>;
}

export function requiredText(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new InputError(`${label} is required`);
  return value.trim();
}

/** Decimal(12,2), without silently rounding amounts supplied by clients. */
export function money(value: unknown, label = "amount"): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 9_999_999_999.99) {
    throw new InputError(`${label} must be a non-negative number at most 9999999999.99`);
  }
  if (Number(value.toFixed(2)) !== value) {
    throw new InputError(`${label} must have at most two decimal places`);
  }
  return value;
}

export function expenseDate(value: unknown): Date | null {
  if (value === null || value === "" || value === undefined) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new InputError("invalid expense date");
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new InputError("invalid expense date");
  return date;
}

export function ticketStatus(value: unknown): TicketStatus {
  if (typeof value !== "string" || !Object.hasOwn(TicketStatus, value)) throw new InputError("invalid status");
  return value as TicketStatus;
}

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export type AttachmentInput = {
  name: string; kind: "IMAGE" | "DOCUMENT"; contentType: string; sizeBytes: number; r2Key: string;
};
export function attachments(value: unknown): AttachmentInput[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new InputError("attachments must be an array");
  const result = value.map((v) => {
    const a = record(v);
    const name = requiredText(a.name, "attachment name");
    const r2Key = requiredText(a.r2Key, "attachment key");
    const contentType = requiredText(a.contentType, "attachment content type");
    const kind = contentType.startsWith("image/") ? "IMAGE" : "DOCUMENT";
    if (a.kind !== kind || (!contentType.startsWith("image/") && contentType !== "application/pdf")) {
      throw new InputError("invalid attachment type");
    }
    if (typeof a.sizeBytes !== "number" || !Number.isSafeInteger(a.sizeBytes) || a.sizeBytes < 0 || a.sizeBytes > MAX_ATTACHMENT_BYTES) {
      throw new InputError("invalid attachment size (maximum 25 MB)");
    }
    return { name, r2Key, contentType, kind, sizeBytes: a.sizeBytes } satisfies AttachmentInput;
  });
  if (new Set(result.map((a) => a.r2Key)).size !== result.length) throw new InputError("duplicate attachment key");
  return result;
}

export function attachmentIds(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new InputError("removeAttachmentIds must be an array");
  return [...new Set(value.map((id) => requiredText(id, "attachment id")))];
}
