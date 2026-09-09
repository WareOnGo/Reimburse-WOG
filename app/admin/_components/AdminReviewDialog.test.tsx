import { beforeEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
import AdminReviewDialog, { ReviewTicket } from "./AdminReviewDialog";
const fetchMock = vi.fn<typeof fetch>();
const ticket: ReviewTicket = { id: "ticket-1", shortCode: "RB-42", title: "Dinner", category: "Meals", amount: 5000, approvedAmount: null, expenseDate: "2026-09-09", dealName: "Warehouse", clientName: "Client", description: "Meeting", status: "PENDING", createdAt: "2026-09-10", submitterName: "Employee", submitterEmail: "employee@example.test", empID: "EMP-1", attachments: [] };
beforeEach(() => { vi.clearAllMocks(); fetchMock.mockReset().mockResolvedValue(Response.json({ ok: true })); vi.stubGlobal("fetch", fetchMock); });
it.each([
  ["PENDING", ["Reject", "Approve", "Partial approve"]], ["REVIEW", ["Reject", "Approve", "Partial approve"]],
  ["APPROVED", ["Reopen", "Mark as rejected", "Mark as cleared", "Partial approve"]], ["CLEARED", ["Revert to approved"]],
  ["REJECTED", ["Reopen", "Mark as approved"]], ["CANCELLED", ["Restore as pending"]],
] as const)("offers the correct actions for %s", (status, actions) => {
  render(<AdminReviewDialog open ticket={{ ...ticket, status }} onClose={vi.fn()} />);
  expect(screen.getAllByRole("button").map((button) => button.textContent?.trim()).sort()).toEqual(["Close", ...actions].sort());
});
it("does not render without an open, selected ticket", () => {
  const { rerender } = render(<AdminReviewDialog open={false} ticket={ticket} onClose={vi.fn()} />); expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  rerender(<AdminReviewDialog open ticket={null} onClose={vi.fn()} />); expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
it("submits a full approval with only status, closes, and refreshes", async () => {
  const close = vi.fn(); const user = userEvent.setup(); render(<AdminReviewDialog open ticket={ticket} onClose={close} />);
  await user.click(screen.getByRole("button", { name: "Approve" }));
  expect(fetchMock).toHaveBeenCalledExactlyOnceWith("/api/tickets/ticket-1", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "APPROVED" }) });
  expect(close).toHaveBeenCalledOnce(); expect(router.refresh).toHaveBeenCalledOnce();
});
it.each(["3000", "5000"])("sends a valid partial input %s and prefills the current amount", async (value) => {
  render(<AdminReviewDialog open ticket={ticket} onClose={vi.fn()} />); fireEvent.click(screen.getByRole("button", { name: "Partial approve" }));
  expect(screen.getByLabelText("Approved amount")).toHaveValue(5000);
  fireEvent.change(screen.getByLabelText("Approved amount"), { target: { value } }); fireEvent.click(screen.getByRole("button", { name: "Confirm partial approval" }));
  await vi.waitFor(() => expect(router.refresh).toHaveBeenCalledOnce()); expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toEqual({ status: "APPROVED", approvedAmount: Number(value) });
});
it.each(["0", "-1", "5001", ""])("rejects invalid partial input %s without a request", (value) => {
  render(<AdminReviewDialog open ticket={ticket} onClose={vi.fn()} />); fireEvent.click(screen.getByRole("button", { name: "Partial approve" }));
  fireEvent.change(screen.getByLabelText("Approved amount"), { target: { value } }); fireEvent.click(screen.getByRole("button", { name: "Confirm partial approval" }));
  expect(screen.getByText(/Enter an amount greater than 0/)).toBeInTheDocument(); expect(fetchMock).not.toHaveBeenCalled();
});
it("prefills a previous partial and renders dates/client/deal and attachments", () => {
  render(<AdminReviewDialog open ticket={{ ...ticket, status: "APPROVED", approvedAmount: 2500, attachments: [{ id: "a", name: "receipt.jpg", kind: "IMAGE", sizeBytes: 123, previewUrl: "https://storage.test/a" }] }} onClose={vi.fn()} />);
  expect(screen.getByText("9 September 2026")).toBeInTheDocument(); expect(screen.getByText("Warehouse")).toBeInTheDocument(); expect(screen.getByRole("img", { name: "receipt.jpg" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Partial approve" })); expect(screen.getByLabelText("Approved amount")).toHaveValue(2500);
});
it("keeps actions and dismissal locked until the request completes", async () => {
  const close = vi.fn(); let finish!: (response: Response) => void; fetchMock.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  render(<AdminReviewDialog open ticket={ticket} onClose={close} />); fireEvent.click(screen.getByRole("button", { name: "Approve" }));
  fireEvent.keyDown(document, { key: "Escape" }); fireEvent.click(screen.getByRole("dialog")); expect(close).not.toHaveBeenCalled();
  for (const button of screen.getAllByRole("button")) expect(button).toBeDisabled();
  await act(async () => finish(Response.json({ ok: true }))); expect(close).toHaveBeenCalledOnce();
});
it.each(["api", "non-json", "network"])("displays %s failure and permits retry", async (kind) => {
  if (kind === "api") fetchMock.mockResolvedValueOnce(Response.json({ error: "Conflict" }, { status: 409 }));
  else if (kind === "non-json") fetchMock.mockResolvedValueOnce(new Response("bad", { status: 502 })); else fetchMock.mockRejectedValueOnce(new Error("offline"));
  const close = vi.fn(); render(<AdminReviewDialog open ticket={ticket} onClose={close} />); fireEvent.click(screen.getByRole("button", { name: "Approve" }));
  await screen.findByText(kind === "api" ? "Conflict" : kind === "non-json" ? "Failed (502)" : "offline"); expect(close).not.toHaveBeenCalled(); expect(router.refresh).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Approve" })).toBeEnabled();
});
it("clears partial state on back and when switching tickets", () => {
  const close = vi.fn(); const { rerender, unmount } = render(<AdminReviewDialog open ticket={ticket} onClose={close} />);
  fireEvent.click(screen.getByRole("button", { name: "Partial approve" })); fireEvent.click(screen.getByRole("button", { name: "Back" })); expect(screen.queryByLabelText("Approved amount")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Partial approve" })); rerender(<AdminReviewDialog open ticket={{ ...ticket, id: "ticket-2", dealName: null, clientName: null, expenseDate: null }} onClose={close} />);
  expect(screen.queryByLabelText("Approved amount")).not.toBeInTheDocument(); expect(screen.queryByText("Warehouse")).not.toBeInTheDocument();
  fireEvent.keyDown(document, { key: "Escape" }); expect(close).toHaveBeenCalledOnce(); unmount(); fireEvent.keyDown(document, { key: "Escape" }); expect(close).toHaveBeenCalledOnce();
});
