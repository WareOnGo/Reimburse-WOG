"use client";

import { useMemo, useState } from "react";
import AdminReviewDialog, { ReviewTicket } from "./AdminReviewDialog";

type AttachmentLite = {
  id: string;
  name: string;
  kind: "IMAGE" | "DOCUMENT";
  sizeBytes: number;
  previewUrl: string;
};

export type AdminEntry = {
  id: string;
  shortCode: string;
  title: string;
  description: string;
  category: string;
  amount: number;
  approvedAmount: number | null;
  status: "PENDING" | "REVIEW" | "APPROVED" | "CLEARED" | "REJECTED" | "CANCELLED";
  createdAt: string;
  submitterName: string;
  submitterEmail: string;
  empID: string;
  attachments: AttachmentLite[];
};

type StatusFilter = "all" | "pending" | "approved" | "cleared" | "rejected" | "cancelled";

const STATUS_TABS: { id: StatusFilter; label: string }[] = [
  { id: "all",       label: "All" },
  { id: "pending",   label: "Pending" },
  { id: "approved",  label: "Approved" },
  { id: "cleared",   label: "Cleared" },
  { id: "rejected",  label: "Rejected" },
  { id: "cancelled", label: "Cancelled" },
];

function matchesStatus(filter: StatusFilter, status: AdminEntry["status"]): boolean {
  switch (filter) {
    case "all":       return true;
    case "pending":   return status === "PENDING" || status === "REVIEW";
    case "approved":  return status === "APPROVED";
    case "cleared":   return status === "CLEARED";
    case "rejected":  return status === "REJECTED";
    case "cancelled": return status === "CANCELLED";
  }
}

function formatINR(n: number): string {
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function toReviewTicket(e: AdminEntry): ReviewTicket {
  return {
    id: e.id,
    shortCode: e.shortCode,
    title: e.title,
    category: e.category,
    amount: e.amount,
    approvedAmount: e.approvedAmount,
    description: e.description,
    status: e.status,
    createdAt: e.createdAt,
    submitterName: e.submitterName,
    submitterEmail: e.submitterEmail,
    empID: e.empID,
    attachments: e.attachments,
  };
}

export default function AdminEntriesTable({ entries }: { entries: AdminEntry[] }) {
  const [status, setStatus] = useState<StatusFilter>("all");
  const [employee, setEmployee] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<AdminEntry | null>(null);

  const employees = useMemo(() => {
    const seen = new Map<string, string>();
    for (const e of entries) seen.set(e.empID, e.submitterName);
    return Array.from(seen.entries())
      .map(([empID, name]) => ({ empID, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [entries]);

  const counts = useMemo(() => {
    const c: Record<StatusFilter, number> = { all: entries.length, pending: 0, approved: 0, cleared: 0, rejected: 0, cancelled: 0 };
    for (const e of entries) {
      if (e.status === "PENDING" || e.status === "REVIEW") c.pending++;
      else if (e.status === "APPROVED")  c.approved++;
      else if (e.status === "CLEARED")   c.cleared++;
      else if (e.status === "REJECTED")  c.rejected++;
      else if (e.status === "CANCELLED") c.cancelled++;
    }
    return c;
  }, [entries]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((e) => {
      if (!matchesStatus(status, e.status)) return false;
      if (employee !== "all" && e.empID !== employee) return false;
      if (q) {
        const hay = `${e.shortCode} ${e.title} ${e.category} ${e.submitterName}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [entries, status, employee, query]);

  return (
    <>
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "1rem 1.25rem", borderBottom: "var(--stroke) solid var(--blue)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem", flexWrap: "wrap" }}>
            <div>
              <h2 style={{ margin: 0 }}>Entries</h2>
              <div className="sub" style={{ fontSize: "0.85rem", color: "var(--slate)" }}>
                Click any row to review. Approve or reject pending entries from the review modal.
              </div>
            </div>
            <div style={{ color: "var(--slate)", fontSize: "0.82rem", whiteSpace: "nowrap" }}>
              Showing {filtered.length} of {entries.length}
            </div>
          </div>

          <div style={{ marginTop: "0.9rem", display: "flex", flexDirection: "column", gap: "0.65rem" }}>
            <div className="filter-tabs">
              {STATUS_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  className={status === tab.id ? "active" : ""}
                  onClick={() => setStatus(tab.id)}
                >
                  {tab.label}
                  <span className="count">{counts[tab.id]}</span>
                </button>
              ))}
            </div>

            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <input
                type="search"
                placeholder="Search ticket #, title, category, employee…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                style={{ flex: 1, minWidth: 220 }}
              />
              <select
                value={employee}
                onChange={(e) => setEmployee(e.target.value)}
                style={{ width: "auto", minWidth: 180 }}
              >
                <option value="all">All employees</option>
                {employees.map((emp) => (
                  <option key={emp.empID} value={emp.empID}>
                    {emp.name} · {emp.empID}
                  </option>
                ))}
              </select>
              {(status !== "all" || employee !== "all" || query) && (
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => {
                    setStatus("all");
                    setEmployee("all");
                    setQuery("");
                  }}
                >
                  Clear filters
                </button>
              )}
            </div>
          </div>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table className="admin-table admin-table-clickable">
            <thead>
              <tr>
                <th>Ticket</th>
                <th>Employee</th>
                <th className="title-cell">Title / Details</th>
                <th className="num">Requested</th>
                <th className="num">Approved</th>
                <th className="num">Files</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ textAlign: "center", color: "var(--slate)", padding: "1.5rem" }}>
                    {entries.length === 0 ? "No tickets submitted." : "No tickets match your filters."}
                  </td>
                </tr>
              )}
              {filtered.map((e) => {
                const statusLower = e.status.toLowerCase();
                return (
                  <tr
                    key={e.id}
                    onClick={() => setSelected(e)}
                    style={{ cursor: "pointer" }}
                    title="Click to review"
                  >
                    <td style={{ fontFamily: "var(--font-mono, ui-monospace)", fontSize: "0.82rem" }}>
                      {e.shortCode}
                    </td>
                    <td>
                      <div>{e.submitterName}</div>
                      <div style={{ color: "var(--slate)", fontSize: "0.78rem" }}>{e.empID}</div>
                    </td>
                    <td className="title-cell" style={{ maxWidth: 340 }}>
                      <div className="title">{e.title}</div>
                      <div className="desc">
                        {e.category} · {e.description}
                      </div>
                    </td>
                    <td className="num">{formatINR(e.amount)}</td>
                    <td className="num">
                      {e.status === "APPROVED" || e.status === "CLEARED" ? (
                        formatINR(e.approvedAmount ?? e.amount)
                      ) : (
                        <span style={{ color: "var(--slate)" }}>—</span>
                      )}
                    </td>
                    <td className="num" style={{ color: e.attachments.length === 0 ? "var(--slate)" : "var(--blue)" }}>
                      {e.attachments.length}
                    </td>
                    <td>
                      <span className={`badge badge-${statusLower}`}>{statusLower}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <AdminReviewDialog
        open={selected !== null}
        ticket={selected ? toReviewTicket(selected) : null}
        onClose={() => setSelected(null)}
      />
    </>
  );
}
