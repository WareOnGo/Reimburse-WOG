import type { TicketStatus } from "@prisma/client";

type Amount = number | string | { toString(): string };
type FinancialTicket = { status: TicketStatus; amount: Amount; approvedAmount: Amount | null };
type Group = "pending" | "approved" | "cleared" | "rejected";
type Bucket = { count: number; cents: number };
function buckets(): Record<Group, Bucket> {
  return { pending: { count: 0, cents: 0 }, approved: { count: 0, cents: 0 }, cleared: { count: 0, cents: 0 }, rejected: { count: 0, cents: 0 } };
}
function add(totals: Record<Group, Bucket>, ticket: FinancialTicket) {
  const requested = Math.round(Number(ticket.amount) * 100);
  if (ticket.status === "CANCELLED") return;
  const group: Group = ticket.status === "PENDING" || ticket.status === "REVIEW" ? "pending"
    : ticket.status === "APPROVED" ? "approved" : ticket.status === "CLEARED" ? "cleared" : "rejected";
  const approved = group === "approved" || group === "cleared";
  const cents = approved && ticket.approvedAmount != null ? Math.round(Number(ticket.approvedAmount) * 100) : requested;
  totals[group].count++;
  totals[group].cents += cents;
  if (approved) totals.rejected.cents += Math.max(0, requested - cents);
}
function result(totals: Record<Group, Bucket>) {
  return {
    pendingCount: totals.pending.count, pendingAmount: totals.pending.cents / 100,
    approvedCount: totals.approved.count, approvedAmount: totals.approved.cents / 100,
    clearedCount: totals.cleared.count, clearedAmount: totals.cleared.cents / 100,
    rejectedCount: totals.rejected.count, rejectedAmount: totals.rejected.cents / 100,
  };
}
export function ticketTotals(tickets: readonly FinancialTicket[]) {
  const totals = buckets();
  for (const ticket of tickets) add(totals, ticket);
  return result(totals);
}
export function employeeTotals(tickets: readonly (FinancialTicket & { submittedByEmpID: string })[]) {
  const grouped = new Map<string, ReturnType<typeof buckets>>();
  for (const ticket of tickets) {
    const totals = grouped.get(ticket.submittedByEmpID) ?? buckets();
    add(totals, ticket);
    grouped.set(ticket.submittedByEmpID, totals);
  }
  return new Map([...grouped].map(([id, totals]) => [id, result(totals)]));
}
