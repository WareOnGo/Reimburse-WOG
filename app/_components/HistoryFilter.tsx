"use client";

import { useMemo, useState } from "react";
import TicketCard, { TicketCardData } from "./TicketCard";
import Link from "next/link";
import { IconPlus } from "./Icons";

type Filter = "all" | "active" | "approved" | "cleared" | "rejected" | "cancelled";

const TABS: { id: Filter; label: string }[] = [
  { id: "all",       label: "All" },
  { id: "active",    label: "Active" },
  { id: "approved",  label: "Approved" },
  { id: "cleared",   label: "Cleared" },
  { id: "rejected",  label: "Rejected" },
  { id: "cancelled", label: "Cancelled" },
];

function matches(filter: Filter, status: TicketCardData["status"]): boolean {
  switch (filter) {
    case "all":       return true;
    case "active":    return status === "PENDING" || status === "REVIEW";
    case "approved":  return status === "APPROVED";
    case "cleared":   return status === "CLEARED";
    case "rejected":  return status === "REJECTED";
    case "cancelled": return status === "CANCELLED";
  }
}

export default function HistoryFilter({ tickets }: { tickets: TicketCardData[] }) {
  const [filter, setFilter] = useState<Filter>("all");

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: tickets.length, active: 0, approved: 0, cleared: 0, rejected: 0, cancelled: 0 };
    for (const t of tickets) {
      if (t.status === "PENDING" || t.status === "REVIEW") c.active++;
      else if (t.status === "APPROVED")  c.approved++;
      else if (t.status === "CLEARED")   c.cleared++;
      else if (t.status === "REJECTED")  c.rejected++;
      else if (t.status === "CANCELLED") c.cancelled++;
    }
    return c;
  }, [tickets]);

  const visible = useMemo(
    () => tickets.filter((t) => matches(filter, t.status)),
    [tickets, filter],
  );

  return (
    <>
      <div className="filter-tabs">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={filter === tab.id ? "active" : ""}
            onClick={() => setFilter(tab.id)}
          >
            {tab.label}
            <span className="count">{counts[tab.id]}</span>
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: "2rem 1rem" }}>
          <p style={{ color: "var(--slate)", margin: "0 0 1rem" }}>
            {filter === "all"
              ? "You haven't raised any tickets yet."
              : `No ${filter === "active" ? "active" : filter} tickets.`}
          </p>
          {filter === "all" && (
            <Link href="/dashboard/new" className="btn btn-primary">
              <IconPlus /> Raise your first ticket
            </Link>
          )}
        </div>
      ) : (
        <div className="ticket-list">
          {visible.map((t) => (
            <TicketCard key={t.shortCode} ticket={t} />
          ))}
        </div>
      )}
    </>
  );
}
