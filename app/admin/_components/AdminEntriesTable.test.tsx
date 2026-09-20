import { beforeEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
import AdminEntriesTable, { AdminEntry } from "./AdminEntriesTable";
const base: AdminEntry = { id: "one", shortCode: "RB-1", title: "Dinner", category: "Meals", description: "Meeting", amount: 5000, approvedAmount: 3000, status: "APPROVED", expenseDate: null, dealName: "West Warehouse", clientName: "Alpha Logistics", createdAt: "2026-09-10", submitterName: "Asha", submitterEmail: "asha@example.test", empID: "EMP-1", attachments: [] };
const entries: AdminEntry[] = (["PENDING", "REVIEW", "APPROVED", "CLEARED", "REJECTED", "CANCELLED"] as const).map((status, i) => ({ ...base, id: `id-${i}`, shortCode: `RB-${i}`, status, empID: i % 2 ? "EMP-2" : "EMP-1", submitterName: i % 2 ? "Bina" : "Asha", clientName: i % 2 ? null : "Alpha Logistics", dealName: i % 2 ? "East Warehouse" : "West Warehouse" }));
const rows = () => within(screen.getByRole("table")).getAllByRole("row").slice(1);
const fetchMock = vi.fn<typeof fetch>();
const fullApproval: AdminEntry = { ...base, id: "two", shortCode: "RB-2", approvedAmount: null, empID: "EMP-2", submitterName: "Bina", title: "Train" };
const selectAll = () => screen.getByRole("checkbox", { name: "Select all visible approved entries" });
const bulkButton = () => screen.getByRole("button", { name: "Mark selected as cleared" });
beforeEach(() => {
  vi.clearAllMocks(); fetchMock.mockReset().mockResolvedValue(Response.json({ ok: true, count: 2 }));
  vi.stubGlobal("fetch", fetchMock);
});
it("counts all statuses and groups review with pending", async () => {
  const user = userEvent.setup(); render(<AdminEntriesTable entries={entries} />); expect(rows()).toHaveLength(6);
  await user.click(screen.getByRole("button", { name: "Pending2" })); expect(rows()).toHaveLength(2);
  for (const status of ["Approved", "Cleared", "Rejected", "Cancelled"]) { await user.click(screen.getByRole("button", { name: `${status}1` })); expect(rows()).toHaveLength(1); }
});
it("combines employee, status, and client/deal search and clears all filters", async () => {
  const user = userEvent.setup(); render(<AdminEntriesTable entries={entries} />);
  await user.selectOptions(screen.getByRole("combobox"), "EMP-1"); await user.click(screen.getByRole("button", { name: "Pending2" }));
  await user.type(screen.getByRole("searchbox"), "  ALPHA  "); expect(rows()).toHaveLength(1); expect(rows()[0]).toHaveTextContent("RB-0");
  await user.clear(screen.getByRole("searchbox")); await user.type(screen.getByRole("searchbox"), "West Warehouse"); expect(rows()[0]).toHaveTextContent("RB-0");
  await user.click(screen.getByRole("button", { name: "Clear filters" })); expect(rows()).toHaveLength(6); expect(screen.getByRole("searchbox")).toHaveValue(""); expect(screen.getByRole("combobox")).toHaveValue("all");
});
it("distinguishes empty data from unmatched search", () => {
  const { rerender } = render(<AdminEntriesTable entries={[]} />); expect(screen.getByText("No tickets submitted.")).toBeInTheDocument();
  rerender(<AdminEntriesTable entries={entries} />); fireEvent.change(screen.getByRole("searchbox"), { target: { value: "no such ticket" } }); expect(screen.getByText("No tickets match your filters.")).toBeInTheDocument();
});
it("maps the selected entry into a review dialog and displays sanctioned money", () => {
  render(<AdminEntriesTable entries={[base]} />); expect(rows()[0]).toHaveTextContent("₹5,000"); expect(rows()[0]).toHaveTextContent("₹3,000");
  fireEvent.click(screen.getByText("RB-1")); const dialog = within(screen.getByRole("dialog"));
  expect(dialog.getByRole("heading", { name: "Ticket RB-1" })).toBeInTheDocument(); expect(dialog.getByText("Alpha Logistics")).toBeInTheDocument(); expect(dialog.getByText("West Warehouse")).toBeInTheDocument();
  fireEvent.click(dialog.getByRole("button", { name: "Close" })); expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("only selects approved rows and keeps selection clicks separate from review", async () => {
  const user = userEvent.setup(); render(<AdminEntriesTable entries={entries} />);
  expect(bulkButton()).toBeDisabled();
  for (const entry of entries) {
    const checkbox = screen.getByRole("checkbox", { name: `Select ticket ${entry.shortCode}` });
    if (entry.status === "APPROVED") expect(checkbox).toBeEnabled(); else expect(checkbox).toBeDisabled();
  }
  await user.click(screen.getByRole("checkbox", { name: "Select ticket RB-2" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); expect(bulkButton()).toBeEnabled();
});

it("supports individual selection, select all, deselection and the mixed checkbox state", async () => {
  const user = userEvent.setup(); render(<AdminEntriesTable entries={[base, fullApproval]} />);
  const first = screen.getByRole("checkbox", { name: "Select ticket RB-1" });
  await user.click(first);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(selectAll()).toBePartiallyChecked(); expect(bulkButton()).toBeEnabled();
  expect(screen.getByText("1 selected · ₹3,000 approved")).toBeInTheDocument();
  await user.click(selectAll()); expect(selectAll()).toBeChecked();
  expect(screen.getByText("2 selected · ₹8,000 approved")).toBeInTheDocument();
  await user.click(first); expect(first).not.toBeChecked(); expect(selectAll()).toBePartiallyChecked();
  await user.click(selectAll()); await user.click(selectAll()); expect(first).not.toBeChecked(); expect(bulkButton()).toBeDisabled();
  await user.click(selectAll()); await user.click(screen.getByRole("button", { name: "Clear selection" }));
  expect(selectAll()).not.toBeChecked(); expect(bulkButton()).toBeDisabled();
});

it.each(["status", "employee", "search", "clear filters"])("resets selection when changing %s so hidden entries are never cleared", async (filter) => {
  const user = userEvent.setup(); render(<AdminEntriesTable entries={[base, fullApproval]} />);
  if (filter === "clear filters") await user.type(screen.getByRole("searchbox"), "Dinner");
  await user.click(selectAll());
  if (filter === "status") await user.click(screen.getByRole("button", { name: "Approved2" }));
  if (filter === "employee") await user.selectOptions(screen.getByRole("combobox"), "EMP-1");
  if (filter === "search") await user.type(screen.getByRole("searchbox"), "Dinner");
  if (filter === "clear filters") await user.click(screen.getByRole("button", { name: "Clear filters" }));
  expect(bulkButton()).toBeDisabled(); expect(selectAll()).not.toBeChecked();
  expect(fetchMock).not.toHaveBeenCalled();
});

it("selects only filtered approved entries and disables select all for empty results", async () => {
  const user = userEvent.setup(); render(<AdminEntriesTable entries={[base, fullApproval, { ...base, id: "pending", shortCode: "RB-3", status: "PENDING" }]} />);
  await user.selectOptions(screen.getByRole("combobox"), "EMP-1"); await user.click(selectAll()); await user.click(bulkButton());
  await user.click(screen.getByRole("button", { name: "Clear 1 entry" }));
  expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toEqual({ ids: ["one"] });
  await user.type(screen.getByRole("searchbox"), "no match"); expect(selectAll()).toBeDisabled();
});

it("confirms the count and approved total, allows backing out, then clears in one request and refreshes", async () => {
  const user = userEvent.setup(); render(<AdminEntriesTable entries={[base, fullApproval]} />);
  await user.click(selectAll()); await user.click(bulkButton());
  expect(screen.getByRole("dialog")).toHaveTextContent("2 entries totalling ₹8,000"); expect(fetchMock).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Back" })); expect(selectAll()).toBeChecked();
  await user.click(bulkButton()); await user.click(screen.getByRole("button", { name: "Clear 2 entries" }));
  expect(fetchMock).toHaveBeenCalledExactlyOnceWith("/api/tickets/bulk-clear", {
    method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids: ["one", "two"] }),
  });
  expect(router.refresh).toHaveBeenCalledOnce(); expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByText("2 entries marked as cleared.")).toBeInTheDocument(); expect(bulkButton()).toBeDisabled();
});

it("locks filters, selection, review and dismissal while submitting and prevents duplicate requests", async () => {
  let finish!: (response: Response) => void;
  fetchMock.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  render(<AdminEntriesTable entries={[base]} />); fireEvent.click(selectAll()); fireEvent.click(bulkButton());
  const confirm = screen.getByRole("button", { name: "Clear 1 entry" });
  act(() => { confirm.click(); confirm.click(); });
  expect(fetchMock).toHaveBeenCalledOnce(); expect(selectAll()).toBeDisabled();
  expect(screen.getByRole("searchbox")).toBeDisabled(); expect(screen.getByRole("combobox")).toBeDisabled();
  for (const button of screen.getAllByRole("button")) expect(button).toBeDisabled();
  fireEvent.click(rows()[0]); fireEvent.keyDown(document, { key: "Escape" }); fireEvent.click(screen.getByRole("dialog"));
  expect(screen.getByRole("dialog")).toHaveTextContent("Mark selected entries as cleared?");
  await act(async () => finish(Response.json({ ok: true, count: 1 })));
  expect(screen.getByText("1 entry marked as cleared.")).toBeInTheDocument();
});

it.each(["api", "non-json", "network", "unknown"])("shows a %s error and keeps the selection available for retry", async (kind) => {
  if (kind === "api") fetchMock.mockResolvedValueOnce(Response.json({ error: "Unable to save" }, { status: 500 }));
  else if (kind === "non-json") fetchMock.mockResolvedValueOnce(new Response("bad gateway", { status: 502 }));
  else fetchMock.mockRejectedValueOnce(kind === "network" ? new Error("offline") : null);
  const user = userEvent.setup(); render(<AdminEntriesTable entries={[base]} />);
  await user.click(selectAll()); await user.click(bulkButton()); await user.click(screen.getByRole("button", { name: "Clear 1 entry" }));
  expect(screen.getByRole("alert")).toHaveTextContent(kind === "api" ? "Unable to save" : kind === "network" ? "offline" : "Could not clear entries");
  expect(selectAll()).toBeChecked(); expect(router.refresh).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Clear 1 entry" }));
  expect(fetchMock).toHaveBeenCalledTimes(2); expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("refreshes stale selections after a conflict and surfaces the error outside the closed dialog", async () => {
  fetchMock.mockResolvedValueOnce(Response.json({ error: "Selected entries changed. Try again." }, { status: 409 }));
  const user = userEvent.setup(); render(<AdminEntriesTable entries={[base]} />);
  await user.click(selectAll()); await user.click(bulkButton()); await user.click(screen.getByRole("button", { name: "Clear 1 entry" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); expect(screen.getByRole("alert")).toHaveTextContent("Selected entries changed");
  expect(router.refresh).toHaveBeenCalledOnce(); expect(selectAll()).not.toBeChecked(); expect(bulkButton()).toBeDisabled();
});

it("excludes selected entries that are no longer approved after a refresh", () => {
  const { rerender } = render(<AdminEntriesTable entries={[base]} />); fireEvent.click(selectAll());
  rerender(<AdminEntriesTable entries={[{ ...base, status: "CLEARED" }]} />);
  expect(bulkButton()).toBeDisabled(); expect(selectAll()).toBeDisabled();
  expect(screen.getByRole("checkbox", { name: "Select ticket RB-1" })).not.toBeChecked();
});
