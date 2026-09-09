"use client";

import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { useDialogFocus } from "./useDialogFocus";

type Props = {
  open: boolean;
  title: string;
  body: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  primaryVariant?: "primary" | "ok" | "danger";
  busy?: boolean;
  maxWidth?: number;
  onConfirm: () => void;
  onClose: () => void;
};

export default function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = "Confirm",
  cancelLabel = "Back",
  destructive = false,
  primaryVariant,
  busy = false,
  maxWidth = 420,
  onConfirm,
  onClose,
}: Props) {
  const [mounted, setMounted] = useState(false);
  const titleId = useId();
  const focusRef = useDialogFocus(mounted && open);

  // The portal target is available after hydration, never during server render.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  if (!mounted || !open) return null;

  const node = (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      ref={focusRef}
      tabIndex={-1}
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
        style={{
          maxWidth,
          width: "100%",
          padding: "1.25rem",
          maxHeight: "90vh",
          overflowY: "auto",
          opacity: 1,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={titleId} style={{ marginTop: 0 }}>{title}</h2>
        <div style={{ color: "var(--charcoal)", marginBottom: "1rem" }}>{body}</div>
        <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onClose}
            disabled={busy}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`btn ${primaryVariant === "ok"
              ? "btn-approve"
              : primaryVariant === "danger" || destructive
              ? "btn-danger"
              : "btn-primary"}`}
            onClick={onConfirm}
            disabled={busy}
            aria-busy={busy}
          >
            {busy ? (
              <>
                <span className="dot-spinner" aria-hidden="true" />
                Working…
              </>
            ) : (
              confirmLabel
            )}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(node, document.body);
}
