"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { IconEdit, IconX, IconEye, IconPaperclip } from "./Icons";
import ConfirmDialog from "./ConfirmDialog";

export type TicketCardData = {
  shortCode: string;
  title: string;
  category: string;
  amount: number;
  approvedAmount: number | null;
  status: "PENDING" | "REVIEW" | "APPROVED" | "CLEARED" | "REJECTED" | "CANCELLED";
  createdAt: string;
  attachmentCount: number;
};

function fmtINR(n: number) {
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export default function TicketCard({ ticket }: { ticket: TicketCardData }) {
  const router = useRouter();
  const status = ticket.status.toLowerCase();
  const canModify = ticket.status === "PENDING" || ticket.status === "REVIEW";
  const isPartial =
    (ticket.status === "APPROVED" || ticket.status === "CLEARED") &&
    ticket.approvedAmount != null &&
    ticket.approvedAmount < ticket.amount;
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function doCancel() {
    if (cancelling) return;
    setCancelling(true);
    setCancelError(null);
    try {
      const res = await fetch(`/api/tickets/${encodeURIComponent(ticket.shortCode)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "CANCELLED" }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setCancelError(data.error ?? `Failed (${res.status})`);
        setCancelling(false);
        return;
      }
      setConfirmCancel(false);
      startTransition(() => router.refresh());
      // leave `cancelling` true so the card stays locked until the row re-renders
    } catch (err) {
      setCancelError(err instanceof Error ? err.message : "Failed");
      setCancelling(false);
    }
  }

  const locked = cancelling;

  return (
    <div
      className={`tcard tcard-link accent-${status}${locked ? " is-busy" : ""}`}
      aria-busy={locked}
    >
      <Link href={`/dashboard/tickets/${ticket.shortCode}`} className="t-main" style={{ color: "inherit", textDecoration: "none" }}>
        <div className="t-title-row">
          <span className="t-title">{ticket.title}</span>
          <span className="t-code">{ticket.shortCode}</span>
        </div>
        <div className="t-meta">
          {ticket.category}
          <span className="sep">·</span>
          Submitted {ticket.createdAt}
          {ticket.attachmentCount > 0 && (
            <>
              <span className="sep">·</span>
              <IconPaperclip size={11} /> {ticket.attachmentCount}
            </>
          )}
        </div>
      </Link>

      <div className="t-side">
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          {isPartial ? (
            <span className="t-amount" style={{ color: "var(--info)" }}>
              {fmtINR(ticket.approvedAmount!)}
              <span style={{ color: "var(--slate)", fontWeight: 400, fontSize: "0.8rem", marginLeft: "0.3rem" }}>
                of {fmtINR(ticket.amount)}
              </span>
            </span>
          ) : (
            <span className="t-amount">{fmtINR(ticket.amount)}</span>
          )}
          <span className={`badge badge-${status}`}>
            {cancelling ? "Cancelling…" : status}
          </span>
        </div>
        <div className="t-actions">
          {canModify && (
            <>
              <Link
                href={`/dashboard/tickets/${ticket.shortCode}/edit`}
                className="icon-btn"
                title="Edit ticket"
              >
                <IconEdit /> Edit
              </Link>
              <button
                type="button"
                className="icon-btn danger"
                onClick={() => setConfirmCancel(true)}
                disabled={cancelling}
                title="Cancel ticket"
              >
                <IconX /> Cancel
              </button>
            </>
          )}
          <Link
            href={`/dashboard/tickets/${ticket.shortCode}`}
            className="icon-btn"
            title="View ticket"
          >
            <IconEye /> View
          </Link>
        </div>
      </div>

      <ConfirmDialog
        open={confirmCancel}
        title={`Cancel ticket ${ticket.shortCode}?`}
        body={
          <div>
            <p style={{ margin: 0 }}>
              This will mark the ticket as cancelled and cannot be undone.
            </p>
            {cancelError && (
              <p style={{ color: "var(--bad)", marginTop: "0.5rem", marginBottom: 0, fontSize: "0.88rem" }}>
                {cancelError}
              </p>
            )}
          </div>
        }
        confirmLabel="Cancel ticket"
        cancelLabel="Keep ticket"
        destructive
        busy={cancelling}
        onConfirm={doCancel}
        onClose={() => !cancelling && setConfirmCancel(false)}
      />
    </div>
  );
}
