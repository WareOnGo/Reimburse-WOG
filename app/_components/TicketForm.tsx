"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { uploadToR2, type UploadedAttachment } from "./upload";

const CATEGORIES = ["Travel", "Meals", "Software", "Office Supplies", "Other"];
const MAX_FILE_MB = 25;

type ExistingAttachment = { id: string; name: string; sizeLabel: string };

type UploadItem = {
  id: string;
  file: File;
  name: string;
  sizeBytes: number;
  progress: number;
  status: "uploading" | "done" | "error";
  error?: string;
  canRetry?: boolean;
  result?: UploadedAttachment;
};

type Props = {
  mode?: "create" | "edit";
  ticketId?: string;
  initial?: {
    title?: string;
    category?: string;
    amount?: string;
    description?: string;
    expenseDate?: string;
    existingAttachments?: ExistingAttachment[];
  };
};

function formatBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

function newItemId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function TicketForm({ mode = "create", ticketId, initial }: Props) {
  const router = useRouter();
  const [title, setTitle] = useState(initial?.title ?? "");
  const [category, setCategory] = useState(initial?.category ?? CATEGORIES[0]);
  const [amount, setAmount] = useState(initial?.amount ?? "");
  const [expenseDate, setExpenseDate] = useState(initial?.expenseDate ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [items, setItems] = useState<UploadItem[]>([]);
  const [existing, setExisting] = useState<ExistingAttachment[]>(initial?.existingAttachments ?? []);
  const removedExistingRef = useRef<Set<string>>(new Set());
  const [dragging, setDragging] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEdit = mode === "edit";
  const ticketKeyHint = isEdit && ticketId ? ticketId : "draft";

  const uploadsPending = items.some((it) => it.status === "uploading");
  const failedUploads = items.filter((it) => it.status === "error").length;

  function patchItem(id: string, patch: Partial<UploadItem>) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }

  // Files upload as soon as they're picked, each independently, so a flaky
  // connection costs one file's retry — never the whole submission.
  function startUpload(id: string, file: File) {
    patchItem(id, { status: "uploading", progress: 0, error: undefined });
    uploadToR2(file, ticketKeyHint, (pct) => patchItem(id, { progress: pct }))
      .then((result) =>
        patchItem(id, {
          status: "done",
          progress: 100,
          result,
          name: result.name,
          sizeBytes: result.sizeBytes,
        }),
      )
      .catch((err) =>
        patchItem(id, {
          status: "error",
          canRetry: true,
          error: err instanceof Error ? err.message : "upload failed",
        }),
      );
  }

  function addFiles(list: FileList | null) {
    if (!list) return;
    const added: UploadItem[] = [];
    for (const f of Array.from(list)) {
      const dupe = (x: UploadItem) => x.file.name === f.name && x.file.size === f.size;
      if (items.some(dupe) || added.some(dupe)) continue;
      const item: UploadItem = {
        id: newItemId(),
        file: f,
        name: f.name,
        sizeBytes: f.size,
        progress: 0,
        status: "uploading",
      };
      if (f.size > MAX_FILE_MB * 1024 * 1024) {
        item.status = "error";
        item.error = `larger than ${MAX_FILE_MB} MB — attach a smaller file`;
        item.canRetry = false;
      }
      added.push(item);
    }
    if (!added.length) return;
    setItems((prev) => [...prev, ...added]);
    for (const it of added) {
      if (it.status === "uploading") startUpload(it.id, it.file);
    }
  }

  function removeItem(id: string) {
    setItems((prev) => prev.filter((it) => it.id !== id));
  }

  function removeExisting(id: string) {
    removedExistingRef.current.add(id);
    setExisting(existing.filter((a) => a.id !== id));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);

    const amt = Number(amount);
    if (!isFinite(amt) || amt < 0) {
      setError("Amount must be a non-negative number");
      return;
    }
    if (uploadsPending) {
      setError("Attachments are still uploading — give them a moment to finish.");
      return;
    }
    if (failedUploads > 0) {
      setError("Some attachments failed to upload. Retry or remove them before submitting.");
      return;
    }

    setSubmitting(true);
    try {
      const uploaded = items
        .map((it) => it.result)
        .filter((r): r is UploadedAttachment => Boolean(r));

      if (isEdit && ticketId) {
        const removed = Array.from(removedExistingRef.current);
        const res = await fetch(`/api/tickets/${encodeURIComponent(ticketId)}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            title,
            category,
            amount: amt,
            description,
            expenseDate: expenseDate || null,
            addAttachments: uploaded,
            removeAttachmentIds: removed,
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error ?? `Save failed (${res.status})`);
        }
      } else {
        const res = await fetch("/api/tickets", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            title,
            category,
            amount: amt,
            description,
            expenseDate: expenseDate || null,
            attachments: uploaded,
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error ?? `Submit failed (${res.status})`);
        }
      }

      setSubmitted(true);
      setTimeout(() => {
        if (isEdit && ticketId) {
          router.push(`/dashboard/tickets/${ticketId}`);
        } else {
          router.push("/dashboard");
        }
        router.refresh();
      }, 500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      {submitted && (
        <div className="alert">
          {isEdit ? "Ticket updated. Redirecting…" : "Ticket submitted. Redirecting to history…"}
        </div>
      )}
      {error && (
        <div className="alert" style={{ color: "#b3261e", marginBottom: "0.75rem" }}>
          {error}
        </div>
      )}

      <div className="field">
        <label htmlFor="title">Title</label>
        <input
          id="title"
          required
          placeholder="e.g. Client dinner — Mumbai trip"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>

      <div className="row-split">
        <div className="field">
          <label htmlFor="category">Category</label>
          <select id="category" value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="amount">Amount (₹)</label>
          <input
            id="amount"
            type="number"
            min="0"
            step="0.01"
            required
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
      </div>

      <div className="field">
        <label htmlFor="expenseDate">
          Expense occurrence date{" "}
          <span style={{ color: "var(--slate)", fontWeight: 400 }}>(optional)</span>
        </label>
        <input
          id="expenseDate"
          type="date"
          value={expenseDate}
          onChange={(e) => setExpenseDate(e.target.value)}
        />
        <div className="hint">When the expense was actually incurred.</div>
      </div>

      <div className="field">
        <label htmlFor="description">Description</label>
        <textarea
          id="description"
          required
          placeholder="Explain the expense, business purpose, and any relevant context…"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      {existing.length > 0 && (
        <div className="field">
          <label>Existing attachments</label>
          <div className="file-list">
            {existing.map((a) => (
              <div key={a.id} className="file-item">
                <div>
                  <div className="name">{a.name}</div>
                  <div className="size">{a.sizeLabel}</div>
                </div>
                <button type="button" onClick={() => removeExisting(a.id)}>Remove</button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="field">
        <label>{isEdit ? "Add more attachments" : "Attachments"}</label>
        {/* The label itself forwards taps to the nested input — don't add an
            onClick that calls input.click(), it double-opens the picker on
            some mobile browsers. */}
        <label
          className={`dropzone ${dragging ? "is-drag" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            addFiles(e.dataTransfer.files);
          }}
        >
          <div className="label-strong">Drop files here or tap to browse</div>
          <div className="label-sub">Receipts, invoices, screenshots · PDF, PNG, JPG · multiple files supported</div>
          <input
            type="file"
            multiple
            accept="image/*,application/pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,.pdf"
            onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }}
          />
        </label>

        {items.length > 0 && (
          <div className="file-list">
            {items.map((it) => (
              <div key={it.id} className="file-item">
                <div className="file-info">
                  <div className="name">{it.name}</div>
                  <div className="size">
                    {it.status === "uploading" && `Uploading… ${it.progress}%`}
                    {it.status === "done" && `${formatBytes(it.sizeBytes)} · uploaded`}
                    {it.status === "error" && <span className="err">{it.error}</span>}
                  </div>
                  {it.status === "uploading" && (
                    <div className="progress-track">
                      <div className="progress-bar" style={{ width: `${it.progress}%` }} />
                    </div>
                  )}
                </div>
                <div className="file-actions">
                  {it.status === "error" && it.canRetry && (
                    <button type="button" className="retry" onClick={() => startUpload(it.id, it.file)}>
                      Retry
                    </button>
                  )}
                  <button type="button" onClick={() => removeItem(it.id)}>Remove</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", marginTop: "0.5rem" }}>
        <button type="submit" className="btn btn-primary" disabled={submitting || uploadsPending}>
          {uploadsPending
            ? "Uploading attachments…"
            : submitting
              ? "Saving…"
              : isEdit
                ? "Save changes"
                : "Submit ticket"}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => router.push(isEdit && ticketId ? `/dashboard/tickets/${ticketId}` : "/dashboard")}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
