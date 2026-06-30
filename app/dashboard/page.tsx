import Link from "next/link";
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

  const pending = tickets.filter((t) => t.status === "PENDING" || t.status === "REVIEW");
  const approved = tickets.filter((t) => t.status === "APPROVED");
  const cleared = tickets.filter((t) => t.status === "CLEARED");

  const pendingAmount = pending.reduce((s, t) => s + Number(t.amount), 0);
  const approvedAmount = approved.reduce(
    (s, t) => s + Number(t.approvedAmount ?? t.amount),
    0,
  );
  const clearedAmount = cleared.reduce(
    (s, t) => s + Number(t.approvedAmount ?? t.amount),
    0,
  );

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
          <div className="stat-value">{pending.length}</div>
          <p className="stat-sub">
            {pending.length === 0 ? (
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
          <div className="stat-value">{approved.length}</div>
          <p className="stat-sub">
            {approved.length === 0 ? (
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
          <div className="stat-value">{cleared.length}</div>
          <p className="stat-sub">
            {cleared.length === 0 ? (
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
