import { prisma } from "@/lib/prisma";
import { getDownloadUrl } from "@/lib/r2";
import AdminEntriesTable, { AdminEntry } from "./_components/AdminEntriesTable";

export const dynamic = "force-dynamic";

function formatINR(n: number): string {
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

// Renders a status cell as the amount (primary) with the ticket count beneath.
// `count` can be 0 while `amount` > 0 — e.g. the rejected column picks up the
// unapproved shortfall of partial approvals that have no fully-rejected tickets.
function statCell(count: number, amount: number) {
  if (count === 0 && amount === 0) {
    return <span style={{ color: "var(--slate)" }}>—</span>;
  }
  return (
    <>
      <div style={{ fontWeight: 600 }}>{formatINR(amount)}</div>
      <div style={{ color: "var(--slate)", fontSize: "0.78rem" }}>
        {count > 0
          ? `${count} ${count === 1 ? "ticket" : "tickets"}`
          : "from partial approvals"}
      </div>
    </>
  );
}

export default async function AdminPage() {
  const tickets = await prisma.ticket.findMany({
    orderBy: { createdAt: "desc" },
    relationLoadStrategy: "join",
    include: {
      submittedBy: {
        include: { verifiedNumber: { select: { email: true, name: true } } },
      },
      attachments: { select: { id: true, name: true, kind: true, sizeBytes: true, r2Key: true, contentType: true } },
    },
  });

  type Row = {
    empID: string;
    name: string;
    email: string;
    pendingCount: number;
    pendingAmount: number;
    approvedCount: number;
    approvedAmount: number;
    clearedCount: number;
    clearedAmount: number;
    rejectedCount: number;
    rejectedAmount: number;
  };

  const byUser = new Map<string, Row>();
  const entries: AdminEntry[] = [];

  for (const t of tickets) {
    const u = t.submittedBy;
    const vn = u.verifiedNumber;
    const email = vn?.email ?? "";
    const submitterName = vn?.name ?? email.split("@")[0] ?? u.empID;
    const amount = Number(t.amount);

    if (!byUser.has(u.empID)) {
      byUser.set(u.empID, {
        empID: u.empID,
        name: submitterName,
        email,
        pendingCount: 0,
        pendingAmount: 0,
        approvedCount: 0,
        approvedAmount: 0,
        clearedCount: 0,
        clearedAmount: 0,
        rejectedCount: 0,
        rejectedAmount: 0,
      });
    }
    const row = byUser.get(u.empID)!;
    if (t.status === "PENDING" || t.status === "REVIEW") {
      row.pendingCount += 1;
      row.pendingAmount += amount;
    } else if (t.status === "APPROVED" || t.status === "CLEARED") {
      // approvedAmount holds the (possibly partial) sanctioned amount; null = full.
      const sanctioned = t.approvedAmount != null ? Number(t.approvedAmount) : amount;
      if (t.status === "APPROVED") {
        row.approvedCount += 1;
        row.approvedAmount += sanctioned;
      } else {
        row.clearedCount += 1;
        row.clearedAmount += sanctioned;
      }
      // The unapproved portion of a partial approval counts as rejected money.
      if (t.approvedAmount != null && sanctioned < amount) {
        row.rejectedAmount += amount - sanctioned;
      }
    } else if (t.status === "REJECTED") {
      row.rejectedCount += 1;
      row.rejectedAmount += amount;
    }

    const attachmentsWithUrls = await Promise.all(
      t.attachments.map(async (a) => ({
        id: a.id,
        name: a.name,
        kind: a.kind,
        sizeBytes: a.sizeBytes,
        previewUrl: await getDownloadUrl(a.r2Key, 600, { contentType: a.contentType }),
      })),
    );

    entries.push({
      id: t.id,
      shortCode: t.shortCode,
      title: t.title,
      description: t.description,
      category: t.category,
      amount,
      approvedAmount: t.approvedAmount != null ? Number(t.approvedAmount) : null,
      expenseDate: t.expenseDate ? t.expenseDate.toISOString().slice(0, 10) : null,
      status: t.status,
      createdAt: t.createdAt.toISOString().slice(0, 10),
      submitterName,
      submitterEmail: email,
      empID: u.empID,
      attachments: attachmentsWithUrls,
    });
  }

  const employeeRows = Array.from(byUser.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Admin · Reimbursement review</h1>
          <div className="sub">
            Review pending submissions and act on them. Approvals are final.
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: "1.5rem", padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "1rem 1.25rem", borderBottom: "var(--stroke) solid var(--blue)" }}>
          <h2 style={{ margin: 0 }}>Employees</h2>
          <div className="sub" style={{ fontSize: "0.85rem", color: "var(--slate)" }}>
            Pending, approved, cleared and rejected counts and amounts, by employee.
            Rejected amount includes the unapproved portion of partial approvals.
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Employee</th>
                <th className="num">Pending</th>
                <th className="num">Approved</th>
                <th className="num">Cleared</th>
                <th className="num">Rejected</th>
              </tr>
            </thead>
            <tbody>
              {employeeRows.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ textAlign: "center", color: "var(--slate)" }}>
                    No employees yet.
                  </td>
                </tr>
              )}
              {employeeRows.map((r) => (
                <tr key={r.empID}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{r.name}</div>
                    <div style={{ color: "var(--slate)", fontSize: "0.78rem" }}>
                      {r.email ? `${r.email} · ` : ""}{r.empID}
                    </div>
                  </td>
                  <td className="num">{statCell(r.pendingCount, r.pendingAmount)}</td>
                  <td className="num">{statCell(r.approvedCount, r.approvedAmount)}</td>
                  <td className="num">{statCell(r.clearedCount, r.clearedAmount)}</td>
                  <td className="num">{statCell(r.rejectedCount, r.rejectedAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <AdminEntriesTable entries={entries} />
    </>
  );
}
