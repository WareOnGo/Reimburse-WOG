import { prisma } from "@/lib/prisma";
import { getDownloadUrl } from "@/lib/r2";
import AdminEntriesTable, { AdminEntry } from "./_components/AdminEntriesTable";

export const dynamic = "force-dynamic";

function formatINR(n: number): string {
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export default async function AdminPage() {
  const tickets = await prisma.ticket.findMany({
    orderBy: { createdAt: "desc" },
    relationLoadStrategy: "join",
    include: {
      submittedBy: {
        include: { verifiedNumber: { select: { email: true, name: true } } },
      },
      attachments: { select: { id: true, name: true, kind: true, sizeBytes: true, r2Key: true } },
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
      });
    }
    const row = byUser.get(u.empID)!;
    if (t.status === "PENDING" || t.status === "REVIEW") {
      row.pendingCount += 1;
      row.pendingAmount += amount;
    } else if (t.status === "APPROVED") {
      row.approvedCount += 1;
      row.approvedAmount += t.approvedAmount != null ? Number(t.approvedAmount) : amount;
    }

    const attachmentsWithUrls = await Promise.all(
      t.attachments.map(async (a) => ({
        id: a.id,
        name: a.name,
        kind: a.kind,
        sizeBytes: a.sizeBytes,
        previewUrl: await getDownloadUrl(a.r2Key, 600),
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
            Pending and approved counts and amounts, by employee.
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Employee ID</th>
                <th>Name</th>
                <th>Email</th>
                <th className="num">Pending</th>
                <th className="num">Pending amount</th>
                <th className="num">Approved</th>
                <th className="num">Approved amount</th>
              </tr>
            </thead>
            <tbody>
              {employeeRows.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ textAlign: "center", color: "var(--slate)" }}>
                    No employees yet.
                  </td>
                </tr>
              )}
              {employeeRows.map((r) => (
                <tr key={r.empID}>
                  <td style={{ fontFamily: "var(--font-mono, ui-monospace)", fontSize: "0.8rem" }}>
                    {r.empID}
                  </td>
                  <td>{r.name}</td>
                  <td style={{ color: "var(--slate)" }}>{r.email}</td>
                  <td className="num">{r.pendingCount}</td>
                  <td className="num">{formatINR(r.pendingAmount)}</td>
                  <td className="num">{r.approvedCount}</td>
                  <td className="num">{formatINR(r.approvedAmount)}</td>
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
