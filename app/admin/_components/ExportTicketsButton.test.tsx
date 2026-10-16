import { beforeEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ExportTicketsButton from "./ExportTicketsButton";
import type { TicketExportPreview } from "@/lib/ticket-export";

const preview: TicketExportPreview = { count: 12, rows: [{
  ticketId: "ticket-1", shortCode: "RB-2001", employeeId: "EMP-1", employeeName: "Asha", employeeEmail: "asha@example.test",
  title: "Travel", category: "Travel", description: "Client meeting", dealName: "Deal", clientName: "Client", status: "CLEARED",
  expenseDate: "2026-09-09", raisedAt: "2026-09-10 00:00:00.000", approvedAt: "2026-09-11 10:00:00.000", clearedAt: "2026-09-12 10:00:00.000",
  updatedAt: "2026-09-12 10:00:00.000", requestedAmount: "5000.25", approvedAmount: "3000.15", clearedAmount: "3000.15", history: "",
}] };
const fetchMock = vi.fn<typeof fetch>();
const createUrl = vi.fn(() => "blob:export");
const revokeUrl = vi.fn();
const historyBounds = { firstTicketAt: "2026-08-31T18:30:00.000Z", lastTicketAt: "2026-10-15T18:29:00.000Z" };
const open = (bounds: { firstTicketAt: string | null; lastTicketAt: string | null } = historyBounds) => {
  render(<ExportTicketsButton {...bounds} />);
  fireEvent.click(screen.getByRole("button", { name: "Export history" }));
};
const download = () => screen.getByRole("button", { name: "Download CSV" });
const changeDate = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
beforeEach(() => {
  vi.clearAllMocks(); fetchMock.mockReset().mockImplementation(async () => Response.json(preview));
  vi.spyOn(Date, "now").mockReturnValue(new Date("2026-10-16T18:30:00.000Z").getTime());
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("URL", class extends URL { static createObjectURL = createUrl; static revokeObjectURL = revokeUrl; });
});

it("only loads when opened and previews the total count, timestamps and exact amounts", async () => {
  render(<ExportTicketsButton {...historyBounds} />); expect(fetchMock).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Export history" }));
  expect(screen.getByLabelText("Date from")).toHaveValue("2026-09-01");
  expect(screen.getByLabelText("Date to")).toHaveValue("2026-10-17");
  expect(download()).toBeDisabled(); expect(screen.getByText("Loading preview…")).toBeInTheDocument();
  await screen.findByText("12 rows to export");
  expect(screen.getByText("Preview of 1 of 12 tickets.")).toBeInTheDocument();
  const table = within(screen.getByRole("table"));
  expect(table.getByText("5000.25")).toBeInTheDocument(); expect(table.getAllByText("3000.15")).toHaveLength(2);
  expect(table.getByText("2026-09-10 00:00:00.000")).toBeInTheDocument();
  expect(download()).toBeEnabled(); expect(fetchMock.mock.calls[0][0]).toBe("/api/tickets/export?format=preview&from=2026-09-01&to=2026-10-17");
});

it("updates preview for date changes, ignores stale responses, and resets to all history", async () => {
  open(); await screen.findByText("12 rows to export");
  let finishOld!: (response: Response) => void;
  fetchMock.mockReturnValueOnce(new Promise((resolve) => { finishOld = resolve; }));
  changeDate("Date from", "2026-09-10"); expect(download()).toBeDisabled();
  const signal = fetchMock.mock.calls.at(-1)![1]!.signal;
  fetchMock.mockResolvedValueOnce(Response.json({ count: 1, rows: preview.rows }));
  changeDate("Date to", "2026-09-12");
  await screen.findByText("1 row to export"); expect(signal?.aborted).toBe(true);
  await act(async () => { finishOld(Response.json({ count: 99, rows: [] })); });
  expect(screen.queryByText("99 rows to export")).not.toBeInTheDocument();
  expect(fetchMock.mock.calls.at(-1)![0]).toBe("/api/tickets/export?format=preview&from=2026-09-10&to=2026-09-12");
  fireEvent.click(screen.getByRole("button", { name: "All history" }));
  await screen.findByText("12 rows to export"); expect(screen.getByLabelText("Date from")).toHaveValue("2026-09-01");
  expect(screen.getByLabelText("Date to")).toHaveValue("2026-10-17");
  expect(fetchMock.mock.calls.at(-1)![0]).toBe("/api/tickets/export?format=preview&from=2026-09-01&to=2026-10-17");
});

it("rejects reversed dates without exporting or querying an invalid range", async () => {
  open(); await screen.findByText("12 rows to export");
  changeDate("Date from", "2026-09-12");
  const calls = fetchMock.mock.calls.length;
  changeDate("Date to", "2026-09-10");
  expect(screen.getByRole("alert")).toHaveTextContent("From date must be on or before to date.");
  expect(download()).toBeDisabled(); expect(fetchMock).toHaveBeenCalledTimes(calls);
});

it("does not reuse an old all-history count when resetting during a pending preview", async () => {
  open(); await screen.findByText("12 rows to export");
  fetchMock.mockImplementation(() => new Promise(() => {}));
  changeDate("Date from", "2026-09-10");
  fireEvent.click(screen.getByRole("button", { name: "All history" }));
  expect(download()).toBeDisabled();
  expect(screen.queryByText("12 rows to export")).not.toBeInTheDocument();
  expect(screen.getByText("Loading preview…")).toBeInTheDocument();
});

it("shows an empty preview without allowing a download", async () => {
  fetchMock.mockResolvedValueOnce(Response.json({ count: 0, rows: [] })); open({ firstTicketAt: null, lastTicketAt: null });
  expect(screen.getByLabelText("Date from")).toHaveValue("2026-10-17");
  expect(screen.getByLabelText("Date to")).toHaveValue("2026-10-17");
  await screen.findByText("0 rows to export"); expect(download()).toBeDisabled();
  expect(screen.queryByRole("table")).not.toBeInTheDocument(); expect(screen.getByText(/No tickets match these dates/)).toBeInTheDocument();
});

it("surfaces preview failures and lets the admin retry", async () => {
  fetchMock.mockResolvedValueOnce(new Response("service unavailable", { status: 503 })); open();
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not load the export preview."); expect(download()).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Retry preview" }));
  await screen.findByText("12 rows to export"); expect(download()).toBeEnabled();
});

it.each([[401, "Your session has expired"], [403, "Only admins can export"]])("explains export permission failures (%s)", async (status, message) => {
  fetchMock.mockResolvedValueOnce(new Response("", { status: Number(status) })); open();
  expect(await screen.findByRole("alert")).toHaveTextContent(String(message)); expect(download()).toBeDisabled();
});

it("hands the selected range to the browser without buffering a Blob and prevents duplicate preflights", async () => {
  open(); await screen.findByText("12 rows to export");
  changeDate("Date from", "2026-09-10"); changeDate("Date to", "2026-09-12");
  await screen.findByText("12 rows to export");
  let finish!: (response: Response) => void;
  fetchMock.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  const calls = fetchMock.mock.calls.length;
  const button = download(); act(() => { button.click(); button.click(); });
  expect(fetchMock).toHaveBeenCalledTimes(calls + 1);
  expect(fetchMock.mock.calls.at(-1)).toEqual(["/api/tickets/export?format=csv&from=2026-09-10&to=2026-09-12", { method: "HEAD", cache: "no-store", signal: expect.any(AbortSignal) }]);
  expect(screen.getByLabelText("Date from")).toBeDisabled(); expect(screen.getByRole("button", { name: "Close export" })).toBeEnabled();
  const response = new Response(null, { headers: { "content-type": "text/csv" } });
  const blob = vi.spyOn(response, "blob");
  await act(async () => { finish(response); });
  expect(screen.getByTitle("Ticket history download")).toHaveAttribute("src", "/api/tickets/export?format=csv&from=2026-09-10&to=2026-09-12");
  expect(blob).not.toHaveBeenCalled(); expect(createUrl).not.toHaveBeenCalled();
  expect(screen.getByText(/Download started/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByTitle("Ticket history download")).toHaveAttribute("src");
});

it("shows a failed download without creating a file and allows retry", async () => {
  open(); await screen.findByText("12 rows to export");
  fetchMock.mockResolvedValueOnce(Response.json({ error: "Export temporarily unavailable" }, { status: 503 }));
  fireEvent.click(download());
  expect(await screen.findByRole("alert")).toHaveTextContent("Export temporarily unavailable");
  expect(createUrl).not.toHaveBeenCalled(); expect(download()).toBeEnabled();
});

it.each(["Cancel", "Close export", "Escape"])("can cancel a stalled download via %s without saving a late response", async (action) => {
  open(); await screen.findByText("12 rows to export");
  let finish!: (response: Response) => void;
  fetchMock.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  fireEvent.click(download());
  const signal = fetchMock.mock.calls.at(-1)![1]!.signal;
  if (action === "Escape") fireEvent.keyDown(document, { key: "Escape" });
  else fireEvent.click(screen.getByRole("button", { name: action }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(signal?.aborted).toBe(true);
  await act(async () => { finish(new Response("csv", { headers: { "content-type": "text/csv" } })); });
  expect(createUrl).not.toHaveBeenCalled();
  expect(screen.getByTitle("Ticket history download")).not.toHaveAttribute("src");
  fireEvent.click(screen.getByRole("button", { name: "Export history" }));
  await screen.findByText("12 rows to export"); expect(download()).toBeEnabled();
});

it("aborts the preflight on unmount and never starts a late download", async () => {
  const { unmount } = render(<ExportTicketsButton {...historyBounds} />);
  fireEvent.click(screen.getByRole("button", { name: "Export history" }));
  await screen.findByText("12 rows to export");
  let finish!: (response: Response) => void;
  fetchMock.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  await act(async () => { fireEvent.click(download()); });
  const signal = fetchMock.mock.calls.at(-1)![1]!.signal;
  unmount(); expect(signal?.aborted).toBe(true);
  await act(async () => { finish(new Response(null, { headers: { "content-type": "text/csv" } })); });
  expect(createUrl).not.toHaveBeenCalled();
});

it.each(["text/html", "application/json", null])("rejects successful responses with the wrong file type (%s)", async (type) => {
  open(); await screen.findByText("12 rows to export");
  fetchMock.mockResolvedValueOnce(new Response(new Uint8Array([60, 62]), { headers: type ? { "content-type": type } : {} }));
  const anchor = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  fireEvent.click(download());
  expect(await screen.findByRole("alert")).toHaveTextContent("The server returned an unexpected file. Please try again.");
  expect(createUrl).not.toHaveBeenCalled(); expect(anchor).not.toHaveBeenCalled();
  expect(screen.queryByText(/Download started/)).not.toBeInTheDocument(); expect(download()).toBeEnabled();
});

it("restores focus to the trigger and cancels pending previews on close", async () => {
  const user = userEvent.setup(); render(<ExportTicketsButton {...historyBounds} />);
  const trigger = screen.getByRole("button", { name: "Export history" });
  await user.click(trigger); await screen.findByText("12 rows to export");
  expect(screen.getByRole("button", { name: "Close export" })).toHaveFocus();
  // Tab order is verified in Chromium; jsdom currently returns selector lists
  // in selector-group order for this mix of inputs, buttons and scroll regions.
  await user.keyboard("{Escape}"); expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); expect(trigger).toHaveFocus();
  expect(fetchMock.mock.calls[0][1]!.signal?.aborted).toBe(true);
  await user.click(trigger); await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
