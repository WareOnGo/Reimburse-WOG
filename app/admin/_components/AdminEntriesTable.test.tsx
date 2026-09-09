import { expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import AdminEntriesTable, { AdminEntry } from "./AdminEntriesTable";
const base: AdminEntry = { id: "one", shortCode: "RB-1", title: "Dinner", category: "Meals", description: "Meeting", amount: 5000, approvedAmount: 3000, status: "APPROVED", expenseDate: null, dealName: "West Warehouse", clientName: "Alpha Logistics", createdAt: "2026-09-10", submitterName: "Asha", submitterEmail: "asha@example.test", empID: "EMP-1", attachments: [] };
const entries: AdminEntry[] = (["PENDING", "REVIEW", "APPROVED", "CLEARED", "REJECTED", "CANCELLED"] as const).map((status, i) => ({ ...base, id: `id-${i}`, shortCode: `RB-${i}`, status, empID: i % 2 ? "EMP-2" : "EMP-1", submitterName: i % 2 ? "Bina" : "Asha", clientName: i % 2 ? null : "Alpha Logistics", dealName: i % 2 ? "East Warehouse" : "West Warehouse" }));
const rows = () => within(screen.getByRole("table")).getAllByRole("row").slice(1);
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
