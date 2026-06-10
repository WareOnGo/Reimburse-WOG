"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import AttachmentLink from "@/app/_components/AttachmentLink";

type AttachmentLite = {
  id: string;
  name: string;
  kind: "IMAGE" | "DOCUMENT";
  sizeBytes: number;
  previewUrl: string;
};

function fmtBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

export type ReviewTicket = {
  id: string;
  shortCode: string;
  title: string;
  category: string;
  amount: number;
  approvedAmount: number | null;
  description: string;
  status: "PENDING" | "REVIEW" | "APPROVED" | "CLEARED" | "REJECTED" | "CANCELLED";
  createdAt: string;
  submitterName: string;
  submitterEmail: string;
  empID: string;
  attachments: AttachmentLite[];
};

function fmtINR(n: number) {
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

type Props = {
  open: boolean;
  ticket: ReviewTicket | null;
  onClose: () => void;
};

export default function AdminReviewDialog({ open, ticket, onClose }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<"APPROVED" | "CLEARED" | "REJECTED" | "PENDING" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [partialOpen, setPartialOpen] = useState(false);
  const [partialAmount, setPartialAmount] = useState("");

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  useEffect(() => {
    if (open) {
      setError(null);
      setBusy(null);
      setPartialOpen(false);
      setPartialAmount("");
    }
  }, [open, ticket?.id]);

  if (!mounted || !open || !ticket) return null;

  const statusLower = ticket.status.toLowerCase();

  type Action = "APPROVED" | "CLEARED" | "REJECTED" | "PENDING";
  type ActionDef = { target: Action; label: string; className: string };

  const actions: ActionDef[] = (() => {
    if (ticket.status === "PENDING" || ticket.status === "REVIEW") {
      return [
        { target: "REJECTED", label: "Reject",  className: "btn btn-reject" },
        { target: "APPROVED", label: "Approve", className: "btn btn-approve" },
      ];
    }
    if (ticket.status === "APPROVED") {
      return [
        { target: "PENDING",  label: "Reopen",            className: "btn btn-ghost" },
        { target: "REJECTED", label: "Mark as rejected",  className: "btn btn-reject" },
        { target: "CLEARED",  label: "Mark as cleared",   className: "btn btn-approve" },
      ];
    }
    if (ticket.status === "CLEARED") {
      return [
        { target: "APPROVED", label: "Revert to approved", className: "btn btn-ghost" },
      ];
    }
    if (ticket.status === "REJECTED") {
      return [
        { target: "PENDING",  label: "Reopen",            className: "btn btn-ghost" },
        { target: "APPROVED", label: "Mark as approved",  className: "btn btn-approve" },
      ];
    }
    // CANCELLED
    return [
      { target: "PENDING", label: "Restore as pending", className: "btn btn-ghost" },
    ];
  })();

  const noteForCurrent: string | null = (() => {
    if (ticket.status === "APPROVED")  return "This ticket is currently approved. Changing status will notify the employee.";
    if (ticket.status === "CLEARED")   return "This ticket has been cleared and reimbursed. Reverting will notify the employee.";
    if (ticket.status === "REJECTED")  return "This ticket is currently rejected. Changing status will notify the employee.";
    if (ticket.status === "CANCELLED") return "This ticket was cancelled by the employee. Restoring puts it back into the pending queue.";
    return null;
  })();

  async function act(target: Action, approvedAmount?: number) {
    if (busy || !ticket) return;
    setBusy(target);
    setError(null);
    try {
      const res = await fetch(`/api/tickets/${ticket.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          approvedAmount !== undefined ? { status: target, approvedAmount } : { status: target },
        ),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? `Failed (${res.status})`);
        setBusy(null);
        return;
      }
      onClose();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
      setBusy(null);
    }
  }

  // Partial approval is available while reviewing and while already (fully) approved.
  const canPartiallyApprove =
    ticket.status === "PENDING" || ticket.status === "REVIEW" || ticket.status === "APPROVED";

  function openPartial() {
    setError(null);
    setPartialAmount(String(ticket!.approvedAmount ?? ticket!.amount));
    setPartialOpen(true);
  }

  function confirmPartial() {
    const val = Number(partialAmount);
    if (!isFinite(val) || val <= 0 || val > ticket!.amount) {
      setError(`Enter an amount greater than 0 and at most ${fmtINR(ticket!.amount)}.`);
      return;
    }
    act("APPROVED", val);
  }

  const isPartial =
    (ticket.status === "APPROVED" || ticket.status === "CLEARED") &&
    ticket.approvedAmount != null &&
    ticket.approvedAmount < ticket.amount;

  const node = (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(10, 34, 57, 0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: "1rem",
      }}
      onClick={() => !busy && onClose()}
    >
      <div
        className="card"
        style={{ maxWidth: 600, width: "100%", padding: 0, maxHeight: "90vh", overflow: "hidden", display: "flex", flexDirection: "column" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ padding: "1.1rem 1.25rem", borderBottom: "var(--stroke) solid var(--blue)", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.5rem" }}>
          <div style={{ minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: "1.1rem" }}>
              Ticket {ticket.shortCode}
            </h2>
            <div style={{ color: "var(--slate)", fontSize: "0.82rem", marginTop: "0.15rem" }}>
              Submitted {ticket.createdAt}
            </div>
          </div>
          <span className={`badge badge-${statusLower}`}>{statusLower}</span>
        </div>

        <div style={{ padding: "1.1rem 1.25rem", overflowY: "auto", display: "flex", flexDirection: "column", gap: "0.85rem" }}>
          <div>
            <div style={{ fontWeight: 700, color: "var(--blue)", fontSize: "1.05rem", marginBottom: "0.15rem" }}>
              {ticket.title}
            </div>
            <div style={{ color: "var(--slate)", fontSize: "0.82rem" }}>
              {ticket.category}
            </div>
          </div>

          <dl style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: "0.4rem 0.85rem", margin: 0, fontSize: "0.88rem" }}>
            <dt style={{ color: "var(--slate)" }}>Employee</dt>
            <dd style={{ margin: 0 }}>
              {ticket.submitterName} · {ticket.empID}
              <div style={{ color: "var(--slate)", fontSize: "0.78rem" }}>{ticket.submitterEmail}</div>
            </dd>
            <dt style={{ color: "var(--slate)" }}>Amount</dt>
            <dd style={{ margin: 0, fontWeight: 700, color: "var(--blue)" }}>{fmtINR(ticket.amount)}</dd>
            {isPartial && (
              <>
                <dt style={{ color: "var(--slate)" }}>Approved</dt>
                <dd style={{ margin: 0, fontWeight: 700, color: "var(--info)" }}>
                  {fmtINR(ticket.approvedAmount!)}{" "}
                  <span style={{ color: "var(--slate)", fontWeight: 400, fontSize: "0.82rem" }}>
                    of {fmtINR(ticket.amount)}
                  </span>
                </dd>
              </>
            )}
          </dl>

          <div>
            <div style={{ color: "var(--slate)", fontSize: "0.78rem", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600, marginBottom: "0.3rem" }}>
              Description
            </div>
            <div style={{
              background: "var(--ivory-soft)",
              border: "var(--stroke) solid var(--blue)",
              padding: "0.7rem 0.85rem",
              borderRadius: "var(--radius-sm)",
              whiteSpace: "pre-wrap",
              fontSize: "0.9rem",
              maxHeight: "10rem",
              overflowY: "auto",
            }}>
              {ticket.description}
            </div>
          </div>

          <div>
            <div style={{ color: "var(--slate)", fontSize: "0.78rem", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600, marginBottom: "0.4rem" }}>
              Attachments ({ticket.attachments.length})
            </div>
            {ticket.attachments.length === 0 ? (
              <div style={{ color: "var(--slate)", fontSize: "0.85rem", fontStyle: "italic" }}>
                No attachments
              </div>
            ) : (
              <div className="media-grid">
                {ticket.attachments.map((a) => (
                  <AttachmentLink
                    key={a.id}
                    id={a.id}
                    name={a.name}
                    sizeLabel={fmtBytes(a.sizeBytes)}
                    kind={a.kind}
                    previewUrl={a.previewUrl}
                  />
                ))}
              </div>
            )}
          </div>

          {error && (
            <div className="alert" style={{ color: "var(--bad)", borderColor: "var(--bad)", marginBottom: 0 }}>
              {error}
            </div>
          )}
        </div>

        <div style={{ padding: "0.9rem 1.25rem", borderTop: "var(--stroke) solid var(--blue)", display: "flex", flexDirection: "column", gap: "0.65rem" }}>
          {noteForCurrent && (
            <div style={{ color: "var(--slate)", fontSize: "0.8rem" }}>
              {noteForCurrent}
            </div>
          )}
          {partialOpen && (
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
              <label htmlFor="partial-amount" style={{ fontSize: "0.82rem", color: "var(--slate)" }}>
                Approved amount
              </label>
              <input
                id="partial-amount"
                type="number"
                value={partialAmount}
                onChange={(e) => setPartialAmount(e.target.value)}
                min={0}
                max={ticket.amount}
                step="0.01"
                autoFocus
                disabled={busy !== null}
                style={{ width: 140 }}
              />
              <span style={{ color: "var(--slate)", fontSize: "0.82rem" }}>
                of {fmtINR(ticket.amount)}
              </span>
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => (partialOpen ? (setPartialOpen(false), setError(null)) : onClose())}
              disabled={busy !== null}
            >
              {partialOpen ? "Back" : "Close"}
            </button>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", justifyContent: "flex-end" }}>
              {partialOpen ? (
                <button
                  type="button"
                  className="btn btn-approve"
                  onClick={confirmPartial}
                  disabled={busy !== null}
                  aria-busy={busy === "APPROVED"}
                >
                  {busy === "APPROVED" ? (
                    <>
                      <span className="dot-spinner" aria-hidden="true" />
                      Working…
                    </>
                  ) : (
                    "Confirm partial approval"
                  )}
                </button>
              ) : (
                <>
                  {canPartiallyApprove && (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={openPartial}
                      disabled={busy !== null}
                    >
                      Partial approve
                    </button>
                  )}
                  {actions.map((a) => (
                    <button
                      key={a.target}
                      type="button"
                      className={a.className}
                      onClick={() => act(a.target)}
                      disabled={busy !== null}
                      aria-busy={busy === a.target}
                    >
                      {busy === a.target ? (
                        <>
                          <span className="dot-spinner" aria-hidden="true" />
                          Working…
                        </>
                      ) : (
                        a.label
                      )}
                    </button>
                  ))}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(node, document.body);
}
