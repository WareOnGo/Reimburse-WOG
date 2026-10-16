"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDialogFocus } from "@/app/_components/useDialogFocus";
import type { TicketExportPreview } from "@/lib/ticket-export";

type HistoryBounds = { firstTicketAt: string | null; lastTicketAt: string | null };

function dateInIST(date: Date) {
  return new Date(date.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

async function responseError(response: Response, fallback: string) {
  if (response.status === 401) return "Your session has expired. Sign in again to export tickets.";
  if (response.status === 403) return "Only admins can export ticket history.";
  const body = await response.json().catch(() => null);
  return typeof body?.error === "string" ? body.error : fallback;
}

function ExportDialog({ firstTicketAt, lastTicketAt, onClose, onDownload, fileError, clearFileError }: HistoryBounds & {
  onClose: () => void; onDownload: (url: string) => void; fileError: string; clearFileError: () => void;
}) {
  const id = useId();
  const focusRef = useDialogFocus(true);
  const [defaultDates] = useState(() => {
    const today = dateInIST(new Date(Date.now()));
    const latest = lastTicketAt ? dateInIST(new Date(lastTicketAt)) : today;
    return {
      from: firstTicketAt ? dateInIST(new Date(firstTicketAt)) : today,
      to: latest > today ? latest : today,
    };
  });
  const [from, setFrom] = useState(defaultDates.from);
  const [to, setTo] = useState(defaultDates.to);
  const fromRef = useRef<HTMLInputElement>(null);
  const toRef = useRef<HTMLInputElement>(null);
  const [badDates, setBadDates] = useState({ from: false, to: false });
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{ key: string; data?: TicketExportPreview; error?: string } | null>(null);
  const [downloading, setDownloading] = useState(false);
  const downloadController = useRef<AbortController | null>(null);
  const [downloadError, setDownloadError] = useState("");
  const [downloaded, setDownloaded] = useState(false);
  const invalidRange = Boolean(from && to && from > to);
  const dateError = badDates.from || badDates.to ? "Enter complete, valid dates or leave them blank."
    : invalidRange ? "From date must be on or before to date." : "";
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const query = params.toString();
  const key = `${query}:${retry}`;
  const current = result?.key === key ? result : null;
  const loading = !dateError && !current;
  const preview = current?.data;
  const close = useCallback(() => {
    downloadController.current?.abort();
    onClose();
  }, [onClose]);

  useEffect(() => () => downloadController.current?.abort(), []);

  useEffect(() => {
    if (dateError) return;
    const controller = new AbortController();
    async function loadPreview() {
      try {
        const response = await fetch(`/api/tickets/export?format=preview&${query}`, {
          cache: "no-store", signal: controller.signal,
        });
        if (!response.ok) throw new Error(await responseError(response, "Could not load the export preview."));
        const data: TicketExportPreview = await response.json();
        if (!controller.signal.aborted) setResult({ key, data });
      } catch (error) {
        if (!controller.signal.aborted) setResult({ key, error: error instanceof Error ? error.message : "Could not load the export preview." });
      }
    }
    void loadPreview();
    return () => controller.abort();
  }, [query, key, dateError]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [close]);

  function changeDate(which: "from" | "to", value: string) {
    if (which === "from") setFrom(value); else setTo(value);
    setResult(null);
    setDownloadError("");
    clearFileError();
    setDownloaded(false);
  }

  function checkDateInput(which: "from" | "to", badInput: boolean) {
    // Incomplete date segments may emit neither input nor change. Also read
    // native validity after keystrokes/blur and immediately before downloading.
    if (badDates[which] !== badInput) {
      setBadDates((current) => ({ ...current, [which]: badInput }));
      setResult(null);
      setDownloaded(false);
    }
  }

  async function download() {
    if (downloadController.current || dateError || !preview?.count) return;
    for (const [which, input] of [["from", fromRef.current], ["to", toRef.current]] as const) {
      if (input && !input.reportValidity()) {
        checkDateInput(which, input.validity.badInput);
        return;
      }
    }
    const controller = new AbortController();
    downloadController.current = controller;
    setDownloading(true);
    setDownloadError("");
    clearFileError();
    setDownloaded(false);
    try {
      const url = `/api/tickets/export?format=csv&${query}`;
      const response = await fetch(url, {
        method: "HEAD", cache: "no-store", signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (!response.ok) throw new Error(await responseError(response, "Could not export tickets. Please try again."));
      if (response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "text/csv") {
        throw new Error("The server returned an unexpected file. Please try again.");
      }
      // Let the browser stream to disk. Fetching a Blob here would buffer the
      // entire export again, even though the server now sends bounded chunks.
      onDownload(url);
      setDownloaded(true);
    } catch (error) {
      if (!controller.signal.aborted) setDownloadError(error instanceof Error ? error.message : "Could not export tickets. Please try again.");
    } finally {
      downloadController.current = null;
      if (!controller.signal.aborted) setDownloading(false);
    }
  }

  return createPortal(
    <div className="export-overlay" onClick={close}>
      <div className="card export-dialog" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-description`} tabIndex={-1} ref={focusRef} onClick={(event) => event.stopPropagation()}>
        <div className="export-heading">
          <div>
            <h2 id={`${id}-title`}>Export ticket history</h2>
            <p id={`${id}-description`}>Download a CSV with one row per ticket, dates, exact amounts and recorded history.</p>
          </div>
          <button type="button" className="btn btn-ghost" aria-label="Close export" onClick={close}>✕</button>
        </div>

        <div className="export-body">
          <div className="export-dates">
            <div className="field">
              <label htmlFor={`${id}-from`}>Date from</label>
              <input id={`${id}-from`} ref={fromRef} type="date" value={from} min="0001-01-01" max={to || "9999-12-31"} disabled={downloading}
                aria-describedby={`${id}-dates-hint`} aria-invalid={invalidRange || badDates.from}
                onKeyUp={(event) => checkDateInput("from", event.currentTarget.validity.badInput)}
                onBlur={(event) => checkDateInput("from", event.currentTarget.validity.badInput)}
                onInput={(event) => checkDateInput("from", event.currentTarget.validity.badInput)} onChange={(event) => changeDate("from", event.target.value)} />
            </div>
            <div className="field">
              <label htmlFor={`${id}-to`}>Date to</label>
              <input id={`${id}-to`} ref={toRef} type="date" value={to} min={from || "0001-01-01"} max="9999-12-31" disabled={downloading}
                aria-describedby={`${id}-dates-hint`} aria-invalid={invalidRange || badDates.to}
                onKeyUp={(event) => checkDateInput("to", event.currentTarget.validity.badInput)}
                onBlur={(event) => checkDateInput("to", event.currentTarget.validity.badInput)}
                onInput={(event) => checkDateInput("to", event.currentTarget.validity.badInput)} onChange={(event) => changeDate("to", event.target.value)} />
            </div>
          </div>
          <p className="export-hint" id={`${id}-dates-hint`}>
            Defaults cover all ticket history. Dates are inclusive, in IST, and match raised, approved or cleared dates.
            Includes all employees and statuses.
          </p>
          {(from !== defaultDates.from || to !== defaultDates.to || badDates.from || badDates.to) && <button type="button" className="btn btn-ghost export-reset" disabled={downloading} onClick={() => {
            // Replace partial native input segments as well as React state.
            if (fromRef.current) fromRef.current.value = defaultDates.from;
            if (toRef.current) toRef.current.value = defaultDates.to;
            setBadDates({ from: false, to: false });
            setFrom(defaultDates.from); setTo(defaultDates.to); setResult(null); setDownloaded(false); setDownloadError("");
            clearFileError();
          }}>All history</button>}

          {dateError && <p className="export-error" role="alert">{dateError}</p>}
          {!dateError && <div className="export-preview" aria-busy={loading}>
            <div role="status" aria-live="polite">
              {loading ? <p>Loading preview…</p> : preview && <>
                <p className="export-count">{preview.count.toLocaleString("en-IN")} {preview.count === 1 ? "row" : "rows"} to export</p>
                <p className="export-hint">{preview.count === 0 ? "No tickets match these dates. Try a wider date range." : `Preview of ${preview.rows.length} of ${preview.count.toLocaleString("en-IN")} tickets.`}</p>
              </>}
            </div>
            {current?.error && <>
              <p className="export-error" role="alert">{current.error}</p>
              <button type="button" className="btn btn-ghost" onClick={() => setRetry((value) => value + 1)}>Retry preview</button>
            </>}
            {preview && preview.rows.length > 0 && <div className="export-table-scroll" role="region" aria-label="Export preview" tabIndex={0}>
              <table className="admin-table export-table">
                <thead><tr>
                  <th>Ticket / employee</th><th>Status</th>
                  <th className="num">Requested (₹)</th><th className="num">Approved (₹)</th><th className="num">Cleared (₹)</th><th>Raised (IST)</th>
                </tr></thead>
                <tbody>{preview.rows.map((row) => <tr key={row.ticketId}>
                  <td><strong>{row.shortCode}</strong><div>{row.employeeName}</div></td>
                  <td><span className={`badge badge-${row.status.toLowerCase()}`}>{row.status}</span></td>
                  <td className="num">{row.requestedAmount}</td><td className="num">{row.approvedAmount}</td><td className="num">{row.clearedAmount}</td>
                  <td>{row.raisedAt}</td>
                </tr>)}</tbody>
              </table>
            </div>}
          </div>}

          <p className="export-hint export-notes">
            Amounts reflect the current status, including partial approvals. Cleared amount is zero until cleared.
            The CSV includes approval and clearance dates and all recorded events. Unrecorded dates stay blank.
            Tickets may change between preview and download.
          </p>
          {(downloadError || fileError) && <p className="export-error" role="alert">{downloadError || fileError}</p>}
          {downloaded && !fileError && <p role="status">Download started. Check your browser’s downloads for progress or cancellation.</p>}
        </div>
        <div className="export-actions">
          <button type="button" className="btn btn-ghost" onClick={close}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={downloading || loading || Boolean(dateError) || !preview?.count}
            aria-busy={downloading} onClick={download}>
            {downloading ? <><span className="dot-spinner" aria-hidden="true" />Exporting…</> : "Download CSV"}
          </button>
        </div>
      </div>
    </div>, document.body,
  );
}

export default function ExportTicketsButton({ firstTicketAt, lastTicketAt }: HistoryBounds) {
  const [open, setOpen] = useState(false);
  const [fileError, setFileError] = useState("");
  const downloadFrame = useRef<HTMLIFrameElement>(null);
  function checkDownloadResponse() {
    const document = downloadFrame.current?.contentDocument;
    // Attachment responses go to the download manager and leave the frame on
    // about:blank. A later auth/server error instead loads here without saving
    // an HTML/JSON file or navigating away from the admin page.
    if (!document || document.URL === "about:blank") return;
    let message = "Could not export tickets. Please try again.";
    if (document.contentType === "application/json") {
      try {
        const body = JSON.parse(document.body.textContent ?? "");
        if (body.error === "unauthorized") message = "Your session has expired. Sign in again to export tickets.";
        else if (body.error === "forbidden") message = "Only admins can export ticket history.";
        else if (typeof body.error === "string") message = body.error;
      } catch { /* Use the generic error for malformed server responses. */ }
    }
    setFileError(message);
  }
  return <>
    <button type="button" className="btn btn-secondary" onClick={() => { setFileError(""); setOpen(true); }}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 3v12m-5-5 5 5 5-5M5 16v5h14v-5" />
      </svg>
      Export history
    </button>
    {!open && fileError && <p className="export-error" role="alert">{fileError}</p>}
    <iframe ref={downloadFrame} title="Ticket history download" hidden onLoad={checkDownloadResponse} />
    {open && <ExportDialog firstTicketAt={firstTicketAt} lastTicketAt={lastTicketAt}
      onClose={() => setOpen(false)} fileError={fileError} clearFileError={() => setFileError("")}
      onDownload={(url) => { if (downloadFrame.current) downloadFrame.current.src = url; }} />}
  </>;
}
