import type { Prisma } from "@prisma/client";
import { InputError } from "./validation";

const DAY_MS = 24 * 60 * 60 * 1000;
const IST_OFFSET_MS = 330 * 60 * 1000;
const APPROVED_LABEL = "Approved by Finance";
const PARTIAL_LABEL = "Partially approved by Finance (";
const CLEARED_LABEL = "Cleared by Finance";

function parseDate(value: string | null, label: string): Date | undefined {
  if (!value) return undefined;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000-") || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new InputError(`Invalid ${label} date.`);
  }
  return new Date(date.getTime() - IST_OFFSET_MS);
}

/** Match any raised, approved or cleared date, including earlier milestones
 * on tickets whose status has subsequently changed. Each ticket appears once.
 */
export function ticketExportRange(params: URLSearchParams) {
  const from = parseDate(params.get("from"), "from");
  const to = parseDate(params.get("to"), "to");
  if (from && to && from > to) throw new InputError("From date must be on or before to date.");
  return { ...(from && { gte: from }), ...(to && { lt: new Date(to.getTime() + DAY_MS) }) };
}

export function ticketExportWhere(params: URLSearchParams): Prisma.TicketWhereInput {
  const range = ticketExportRange(params);
  if (!range.gte && !range.lt) return {};
  return {
    OR: [
      { createdAt: range },
      { events: { some: {
        createdAt: range,
        OR: [
          { label: APPROVED_LABEL },
          { label: { startsWith: PARTIAL_LABEL } },
          { label: CLEARED_LABEL },
        ],
      } } },
    ],
  };
}

export const ticketExportSelect = {
  id: true, shortCode: true, title: true, category: true, description: true,
  status: true, amount: true, approvedAmount: true, expenseDate: true,
  dealName: true, clientName: true, submittedByEmpID: true, createdAt: true, updatedAt: true,
  submittedBy: { select: { verifiedNumber: { select: { name: true, email: true } } } },
  events: { select: { label: true, createdAt: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
} satisfies Prisma.TicketSelect;

type ExportTicket = Prisma.TicketGetPayload<{ select: typeof ticketExportSelect }>;

function timestamp(date: Date): string {
  return new Date(date.getTime() + IST_OFFSET_MS).toISOString().replace("T", " ").replace("Z", "");
}

export function ticketExportRow(ticket: ExportTicket) {
  let approvedAt = "";
  let clearedAt = "";
  for (const event of ticket.events) {
    if (event.label === APPROVED_LABEL || event.label.startsWith(PARTIAL_LABEL)) approvedAt = timestamp(event.createdAt);
    if (event.label === CLEARED_LABEL) clearedAt = timestamp(event.createdAt);
  }
  // A null approvedAmount means a full approval, not zero. Clearance always
  // pays the sanctioned amount, including a partial approval, in this portal.
  const approved = ticket.status === "APPROVED" || ticket.status === "CLEARED";
  const sanctioned = (ticket.approvedAmount ?? ticket.amount).toFixed(2);
  return {
    ticketId: ticket.id,
    shortCode: ticket.shortCode,
    employeeId: ticket.submittedByEmpID,
    employeeName: ticket.submittedBy.verifiedNumber.name,
    employeeEmail: ticket.submittedBy.verifiedNumber.email ?? "",
    title: ticket.title,
    category: ticket.category,
    description: ticket.description,
    dealName: ticket.dealName ?? "",
    clientName: ticket.clientName ?? "",
    status: ticket.status,
    expenseDate: ticket.expenseDate?.toISOString().slice(0, 10) ?? "",
    raisedAt: timestamp(ticket.createdAt),
    approvedAt,
    clearedAt,
    updatedAt: timestamp(ticket.updatedAt),
    requestedAmount: ticket.amount.toFixed(2),
    approvedAmount: approved ? sanctioned : "0.00",
    clearedAmount: ticket.status === "CLEARED" ? sanctioned : "0.00",
    history: ticket.events.map((event) => `${timestamp(event.createdAt)} IST — ${event.label}`).join("\n"),
  };
}

export type TicketExportRow = ReturnType<typeof ticketExportRow>;
export type TicketExportPreview = { count: number; rows: TicketExportRow[] };

const columns: readonly [keyof TicketExportRow, string][] = [
  ["shortCode", "Ticket"], ["ticketId", "Ticket ID"], ["employeeId", "Employee ID"],
  ["employeeName", "Employee name"], ["employeeEmail", "Employee email"],
  ["title", "Title"], ["category", "Category"], ["description", "Description"],
  ["dealName", "Deal name"], ["clientName", "Client name"], ["status", "Current status"],
  ["expenseDate", "Expense date"], ["raisedAt", "Raised at (IST)"],
  ["approvedAt", "Last approved at (IST)"], ["clearedAt", "Last cleared at (IST)"],
  ["updatedAt", "Last updated at (IST)"], ["requestedAmount", "Current requested amount (INR)"],
  ["approvedAmount", "Current approved amount (INR)"], ["clearedAmount", "Current cleared amount (INR)"],
  ["history", "Recorded history (IST)"],
];

function csvCell(value: string): string {
  // Quoting alone does not stop spreadsheet formula execution. Neutralize
  // formula prefixes even behind leading whitespace/control characters.
  const safe = /^[\s\u0000-\u001f]*[=+@-]|^[\t\r\n]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function ticketExportCsv(rows: TicketExportRow[], includeHeader = true): string {
  const lines = includeHeader ? [columns.map(([, label]) => csvCell(label)).join(",")] : [];
  for (const row of rows) lines.push(columns.map(([key]) => csvCell(row[key])).join(","));
  // UTF-8 BOM keeps names and rupee symbols readable in Excel.
  return `${includeHeader ? "\uFEFF" : ""}${lines.join("\r\n")}${lines.length ? "\r\n" : ""}`;
}
