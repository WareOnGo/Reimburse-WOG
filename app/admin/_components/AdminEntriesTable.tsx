"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import ConfirmDialog from "@/app/_components/ConfirmDialog";
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
  expenseDate: string | null;
  dealName: string | null;
  clientName: string | null;
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
    expenseDate: e.expenseDate,
    dealName: e.dealName,
    clientName: e.clientName,
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
  const router = useRouter();
  const [status, setStatus] = useState<StatusFilter>("all");
  const [employee, setEmployee] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<AdminEntry | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);
  const clearInFlight = useRef(false);

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
        const hay = `${e.shortCode} ${e.title} ${e.category} ${e.submitterName} ${e.dealName ?? ""} ${e.clientName ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [entries, status, employee, query]);

  const clearable = filtered.filter((entry) => entry.status === "APPROVED");
  const selectedEntries = clearable.filter((entry) => selectedIds.has(entry.id));
  const selectedCount = selectedEntries.length;
  const selectedTotal = selectedEntries.reduce((total, entry) => total + (entry.approvedAmount ?? entry.amount), 0);
  const allSelected = clearable.length > 0 && selectedCount === clearable.length;
  const busy = clearing || refreshing;
  const controlsDisabled = busy || confirmClear;

  function resetSelection() {
    setSelectedIds(new Set());
    setBulkError(null);
    setBulkMessage(null);
  }

  async function clearSelected() {
    if (clearInFlight.current || selectedCount === 0) return;
    clearInFlight.current = true;
    setClearing(true);
    setBulkError(null);
    try {
      const response = await fetch("/api/tickets/bulk-clear", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: selectedEntries.map((entry) => entry.id) }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        if (response.status === 409) {
          setConfirmClear(false);
          setSelectedIds(new Set());
          startRefresh(() => router.refresh());
        }
        throw new Error(data?.error || `Could not clear entries (${response.status}). Please try again.`);
      }
      setBulkMessage(`${selectedCount} ${selectedCount === 1 ? "entry" : "entries"} marked as cleared.`);
      setSelectedIds(new Set());
      setConfirmClear(false);
      startRefresh(() => router.refresh());
    } catch (error) {
      setBulkError(error instanceof Error ? error.message : "Could not clear entries. Please try again.");
    } finally {
      clearInFlight.current = false;
      setClearing(false);
    }
  }

  return (
    <>
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "1rem 1.25rem", borderBottom: "var(--stroke) solid var(--blue)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem", flexWrap: "wrap" }}>
            <div>
              <h2 style={{ margin: 0 }}>Entries</h2>
              <div className="sub" style={{ fontSize: "0.85rem", color: "var(--slate)" }}>
                Click any row to review. Select approved entries to mark them as cleared together.
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
                  disabled={controlsDisabled}
                  onClick={() => { setStatus(tab.id); resetSelection(); }}
                >
                  {tab.label}
                  <span className="count">{counts[tab.id]}</span>
                </button>
              ))}
            </div>

            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <input
                type="search"
                placeholder="Search ticket #, title, category, employee, deal, client…"
                value={query}
                disabled={controlsDisabled}
                onChange={(e) => { setQuery(e.target.value); resetSelection(); }}
                style={{ flex: 1, minWidth: 220 }}
              />
              <select
                value={employee}
                disabled={controlsDisabled}
                onChange={(e) => { setEmployee(e.target.value); resetSelection(); }}
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
                  disabled={controlsDisabled}
                  onClick={() => {
                    setStatus("all");
                    setEmployee("all");
                    setQuery("");
                    resetSelection();
                  }}
                >
                  Clear filters
                </button>
              )}
            </div>
          </div>

          <div className="admin-bulk-actions">
            <span role="status">
              {selectedCount > 0
                ? `${selectedCount} selected · ${formatINR(selectedTotal)} approved`
                : "Select approved entries to clear."}
            </span>
            <div className="admin-bulk-buttons">
              {selectedCount > 0 && (
                <button type="button" className="btn btn-ghost btn-sm" disabled={controlsDisabled} onClick={resetSelection}>
                  Clear selection
                </button>
              )}
              <button
                type="button"
                className="btn btn-approve btn-sm"
                disabled={controlsDisabled || selectedCount === 0}
                aria-busy={busy}
                onClick={() => { setBulkError(null); setBulkMessage(null); setConfirmClear(true); }}
              >
                Mark selected as cleared
              </button>
            </div>
          </div>
          {bulkMessage && <div role="status" style={{ marginTop: "0.65rem", color: "var(--ok)" }}>{bulkMessage}</div>}
          {bulkError && !confirmClear && <div role="alert" style={{ marginTop: "0.65rem", color: "var(--bad)" }}>{bulkError}</div>}
        </div>

        <div style={{ overflowX: "auto" }}>
          <table className="admin-table admin-table-clickable">
            <thead>
              <tr>
                <th className="selection-cell">
                  <input
                    type="checkbox"
                    aria-label="Select all visible approved entries"
                    checked={allSelected}
                    ref={(node) => { if (node) node.indeterminate = selectedCount > 0 && !allSelected; }}
                    disabled={controlsDisabled || clearable.length === 0}
                    onChange={() => {
                      setSelectedIds(allSelected ? new Set() : new Set(clearable.map((entry) => entry.id)));
                      setBulkError(null);
                      setBulkMessage(null);
                    }}
                  />
                </th>
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
                  <td colSpan={8} style={{ textAlign: "center", color: "var(--slate)", padding: "1.5rem" }}>
                    {entries.length === 0 ? "No tickets submitted." : "No tickets match your filters."}
                  </td>
                </tr>
              )}
              {filtered.map((e) => {
                const statusLower = e.status.toLowerCase();
                return (
                  <tr
                    key={e.id}
                    className={e.status === "APPROVED" && selectedIds.has(e.id) ? "is-selected" : ""}
                    onClick={() => { if (!controlsDisabled) setSelected(e); }}
                    style={{ cursor: "pointer" }}
                    title="Click to review"
                  >
                    <td className="selection-cell" onClick={(event) => event.stopPropagation()} title={e.status === "APPROVED" ? "Select for clearing" : "Only approved entries can be cleared"}>
                      <input
                        type="checkbox"
                        aria-label={`Select ticket ${e.shortCode}`}
                        checked={e.status === "APPROVED" && selectedIds.has(e.id)}
                        disabled={controlsDisabled || e.status !== "APPROVED"}
                        onChange={() => {
                          setSelectedIds((current) => {
                            const next = new Set(current);
                            if (next.has(e.id)) next.delete(e.id);
                            else next.add(e.id);
                            return next;
                          });
                          setBulkError(null);
                          setBulkMessage(null);
                        }}
                      />
                    </td>
                    <td style={{ fontFamily: "var(--font-mono, ui-monospace)", fontSize: "0.82rem" }}>
                      <button type="button" className="btn btn-ghost" style={{ padding: 0, font: "inherit" }} aria-label={`Review ticket ${e.shortCode}`} disabled={controlsDisabled} onClick={() => setSelected(e)}>
                        {e.shortCode}
                      </button>
                    </td>
                    <td>
                      <div>{e.submitterName}</div>
                      <div style={{ color: "var(--slate)", fontSize: "0.78rem" }}>{e.empID}</div>
                    </td>
                    <td className="title-cell" style={{ maxWidth: 340 }}>
                      <div className="title">{e.title}</div>
                      {(e.clientName || e.dealName) && (
                        <div className="desc">
                          {[e.clientName, e.dealName].filter(Boolean).join(" · ")}
                        </div>
                      )}
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

      <ConfirmDialog
        open={confirmClear}
        title="Mark selected entries as cleared?"
        body={
          <>
            <p>{selectedCount} {selectedCount === 1 ? "entry" : "entries"} totalling <strong>{formatINR(selectedTotal)}</strong> will be marked as reimbursed.</p>
            {bulkError && <div role="alert" style={{ color: "var(--bad)" }}>{bulkError}</div>}
          </>
        }
        confirmLabel={`Clear ${selectedCount} ${selectedCount === 1 ? "entry" : "entries"}`}
        primaryVariant="ok"
        busy={busy}
        onConfirm={clearSelected}
        onClose={() => { setConfirmClear(false); setBulkError(null); }}
      />
      <AdminReviewDialog
        open={selected !== null}
        ticket={selected ? toReviewTicket(selected) : null}
        onClose={() => setSelected(null)}
      />
    </>
  );
}
