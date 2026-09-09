import Link from "next/link";
import { ticketTotals } from "@/lib/totals";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import HistoryFilter from "@/app/_components/HistoryFilter";
import { TicketCardData } from "@/app/_components/TicketCard";
import { IconPlus } from "@/app/_components/Icons";

export const dynamic = "force-dynamic";

function fmtINR(n: number): string {
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default async function DashboardHome() {
  const user = await requireUser();

  const tickets = await prisma.ticket.findMany({
    where: { submittedByEmpID: user.empID },
    orderBy: { createdAt: "desc" },
    relationLoadStrategy: "join",
    include: { attachments: { select: { id: true } } },
  });

  const { pendingCount, pendingAmount, approvedCount, approvedAmount, clearedCount, clearedAmount } = ticketTotals(tickets);

  const cards: TicketCardData[] = tickets.map((t) => ({
    shortCode: t.shortCode,
    title: t.title,
    category: t.category,
    amount: Number(t.amount),
    approvedAmount: t.approvedAmount != null ? Number(t.approvedAmount) : null,
    status: t.status,
    createdAt: fmtDate(t.createdAt),
    attachmentCount: t.attachments.length,
  }));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Welcome back, {user.name}</h1>
          <div className="sub">Manage your reimbursement requests in one place.</div>
        </div>
        <Link href="/dashboard/new" className="btn btn-primary">
          <IconPlus /> Raise a ticket
        </Link>
      </div>

      <div className="stat-grid" style={{ marginBottom: "1.5rem" }}>
        <div className="card stat-card stat-card--pending">
          <p className="stat-label">Pending</p>
          <div className="stat-value">{pendingCount}</div>
          <p className="stat-sub">
            {pendingCount === 0 ? (
              "Nothing awaiting review"
            ) : (
              <>
                <span className="stat-amount">{fmtINR(pendingAmount)}</span> awaiting review
              </>
            )}
          </p>
        </div>
        <div className="card stat-card stat-card--approved">
          <p className="stat-label">Approved</p>
          <div className="stat-value">{approvedCount}</div>
          <p className="stat-sub">
            {approvedCount === 0 ? (
              "No approvals yet"
            ) : (
              <>
                <span className="stat-amount">{fmtINR(approvedAmount)}</span> approved
              </>
            )}
          </p>
        </div>
        <div className="card stat-card stat-card--cleared">
          <p className="stat-label">Cleared</p>
          <div className="stat-value">{clearedCount}</div>
          <p className="stat-sub">
            {clearedCount === 0 ? (
              "Nothing reimbursed yet"
            ) : (
              <>
                <span className="stat-amount">{fmtINR(clearedAmount)}</span> reimbursed
              </>
            )}
          </p>
        </div>
      </div>

      <div className="section-label" style={{ marginTop: 0 }}>Your tickets</div>

      <HistoryFilter tickets={cards} />
    </>
  );
}
