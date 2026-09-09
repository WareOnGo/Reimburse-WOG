import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), pathname: "/dashboard" }));
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => router.pathname }));
import ConfirmDialog from "./ConfirmDialog";
import TicketCard, { TicketCardData } from "./TicketCard";
import HistoryFilter from "./HistoryFilter";
import CancelTicketButton from "./CancelTicketButton";
import AttachmentLink from "./AttachmentLink";
import UserMenu from "./UserMenu";
import NavLinks from "./NavLinks";
const fetchMock = vi.fn<typeof fetch>();
const ticket: TicketCardData = { shortCode: "RB-42", title: "Dinner", category: "Meals", amount: 5000, approvedAmount: null, status: "PENDING", createdAt: "2026-09-10", attachmentCount: 2 };
beforeEach(() => {
  vi.clearAllMocks(); router.pathname = "/dashboard"; fetchMock.mockReset().mockResolvedValue(Response.json({ ok: true })); vi.stubGlobal("fetch", fetchMock);
});
describe("confirmation dialog", () => {
  it("traps Tab in both directions and restores the trigger on close", async () => {
    const user = userEvent.setup(); const { rerender } = render(<><button>Launch</button><ConfirmDialog open={false} title="Review" body="Details" onConfirm={vi.fn()} onClose={vi.fn()} /></>);
    const trigger = screen.getByRole("button", { name: "Launch" }); trigger.focus();
    rerender(<><button>Launch</button><ConfirmDialog open title="Review" body="Details" onConfirm={vi.fn()} onClose={vi.fn()} /></>);
    expect(screen.getByRole("button", { name: "Back" })).toHaveFocus();
    await user.tab({ shift: true }); expect(screen.getByRole("button", { name: "Confirm" })).toHaveFocus();
    await user.tab(); expect(screen.getByRole("button", { name: "Back" })).toHaveFocus();
    rerender(<><button>Launch</button><ConfirmDialog open={false} title="Review" body="Details" onConfirm={vi.fn()} onClose={vi.fn()} /></>);
    expect(trigger).toHaveFocus();
  });
  it("renders only when open and invokes the selected action", async () => {
    const confirm = vi.fn(), close = vi.fn(); const user = userEvent.setup();
    const { rerender } = render(<ConfirmDialog open={false} title="Confirm action" body="Details" onConfirm={confirm} onClose={close} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    rerender(<ConfirmDialog open title="Confirm action" body="Details" onConfirm={confirm} onClose={close} />);
    await user.click(screen.getByText("Details")); expect(close).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Confirm" })); expect(confirm).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "Back" })); expect(close).toHaveBeenCalledOnce();
  });
  it("handles Escape/backdrop only when idle and removes listeners on unmount", () => {
    const close = vi.fn(); const { rerender, unmount } = render(<ConfirmDialog open title="Confirm" body="Body" busy onConfirm={vi.fn()} onClose={close} />);
    fireEvent.keyDown(document, { key: "Escape" }); fireEvent.click(screen.getByRole("dialog")); expect(close).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Working…" })).toBeDisabled();
    rerender(<ConfirmDialog open title="Confirm" body="Body" onConfirm={vi.fn()} onClose={close} />);
    fireEvent.keyDown(document, { key: "Escape" }); fireEvent.click(screen.getByRole("dialog")); expect(close).toHaveBeenCalledTimes(2);
    unmount(); fireEvent.keyDown(document, { key: "Escape" }); expect(close).toHaveBeenCalledTimes(2);
  });
});
describe("ticket cards and history", () => {
  it.each(["PENDING", "REVIEW", "APPROVED", "CLEARED", "REJECTED", "CANCELLED"] as const)("exposes correct actions for %s", (status) => {
    render(<TicketCard ticket={{ ...ticket, status }} />);
    expect(screen.getByRole("link", { name: "View" })).toHaveAttribute("href", "/dashboard/tickets/RB-42");
    if (status === "PENDING" || status === "REVIEW") {
      expect(screen.getByRole("link", { name: "Edit" })).toHaveAttribute("href", "/dashboard/tickets/RB-42/edit"); expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
    } else { expect(screen.queryByRole("link", { name: "Edit" })).not.toBeInTheDocument(); expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument(); }
  });
  it.each(["APPROVED", "CLEARED"] as const)("displays partial money for %s", (status) => {
    render(<TicketCard ticket={{ ...ticket, status, approvedAmount: 3000 }} />); expect(screen.getByText("₹3,000")).toBeInTheDocument(); expect(screen.getByText("of ₹5,000")).toBeInTheDocument();
  });
  it("cancels via confirmation and locks until refreshed", async () => {
    const user = userEvent.setup(); render(<TicketCard ticket={ticket} />);
    await user.click(screen.getByRole("button", { name: "Cancel" })); await user.click(screen.getByRole("button", { name: "Keep ticket" })); expect(fetchMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Cancel" })); await user.click(screen.getByRole("button", { name: "Cancel ticket" }));
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith("/api/tickets/RB-42", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "CANCELLED" }) });
    expect(router.refresh).toHaveBeenCalledOnce(); expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });
  it("keeps the cancellation dialog open on API failure and allows retry", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: "Already approved" }, { status: 409 }));
    render(<TicketCard ticket={ticket} />); fireEvent.click(screen.getByRole("button", { name: "Cancel" })); fireEvent.click(screen.getByRole("button", { name: "Cancel ticket" }));
    await screen.findByText("Already approved"); expect(screen.getByRole("button", { name: "Cancel ticket" })).toBeEnabled(); expect(router.refresh).not.toHaveBeenCalled();
  });
  it("handles network cancellation errors", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline")); render(<TicketCard ticket={ticket} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" })); fireEvent.click(screen.getByRole("button", { name: "Cancel ticket" })); await screen.findByText("offline"); expect(router.refresh).not.toHaveBeenCalled();
  });
  it("groups REVIEW with active tickets and switches all status filters", async () => {
    const tickets = (["PENDING", "REVIEW", "APPROVED", "CLEARED", "REJECTED", "CANCELLED"] as const).map((status, i) => ({ ...ticket, shortCode: `RB-${i}`, title: `Ticket ${i}`, status }));
    const user = userEvent.setup(); render(<HistoryFilter tickets={tickets} />);
    expect(screen.getAllByRole("link", { name: "View" })).toHaveLength(6);
    await user.click(screen.getByRole("button", { name: /^Active/ })); expect(screen.getAllByRole("link", { name: "View" })).toHaveLength(2);
    for (const label of ["Approved", "Cleared", "Rejected", "Cancelled"]) {
      await user.click(screen.getByRole("button", { name: new RegExp(`^${label}`) })); expect(screen.getAllByRole("link", { name: "View" })).toHaveLength(1);
    }
    await user.click(screen.getByRole("button", { name: /^All/ })); expect(screen.getAllByRole("link", { name: "View" })).toHaveLength(6);
  });
  it("distinguishes no tickets from no matches and responds to new props", () => {
    const { rerender } = render(<HistoryFilter tickets={[]} />); expect(screen.getByRole("link", { name: "Raise your first ticket" })).toHaveAttribute("href", "/dashboard/new");
    fireEvent.click(screen.getByRole("button", { name: /^Approved/ })); expect(screen.getByText("No approved tickets.")).toBeInTheDocument();
    rerender(<HistoryFilter tickets={[{ ...ticket, status: "APPROVED" }]} />); expect(screen.getByRole("link", { name: "View" })).toBeInTheDocument();
  });
});
describe("cancel button", () => {
  it.each([undefined, "/dashboard"])("refreshes with optional redirect %s", async (redirectTo) => {
    render(<CancelTicketButton ticketId="RB-42" redirectTo={redirectTo} />); fireEvent.click(screen.getByRole("button", { name: "Cancel" })); fireEvent.click(screen.getByRole("button", { name: "Cancel ticket" }));
    await vi.waitFor(() => expect(router.refresh).toHaveBeenCalledOnce());
    if (redirectTo) expect(router.push).toHaveBeenCalledWith(redirectTo); else expect(router.push).not.toHaveBeenCalled();
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toEqual({ status: "CANCELLED" });
  });
  it.each(["api", "network"])("permits retry after %s failure", async (kind) => {
    if (kind === "api") fetchMock.mockResolvedValueOnce(new Response("bad", { status: 500 })); else fetchMock.mockRejectedValueOnce(new Error("offline"));
    render(<CancelTicketButton ticketId="RB-42" />); fireEvent.click(screen.getByRole("button", { name: "Cancel" })); fireEvent.click(screen.getByRole("button", { name: "Cancel ticket" }));
    await screen.findByText(kind === "api" ? "Failed (500)" : "offline"); expect(screen.getByRole("button", { name: "Cancel ticket" })).toBeEnabled(); expect(router.refresh).not.toHaveBeenCalled();
  });
});
describe("attachments and navigation", () => {
  it.each(["IMAGE", "DOCUMENT"] as const)("renders and opens %s with a safe window target", (kind) => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    render(<AttachmentLink id="a" name="Receipt" kind={kind} sizeLabel="1 KB" previewUrl="https://storage.test/receipt" />);
    if (kind === "IMAGE") expect(screen.getByRole("img", { name: "Receipt" })).toHaveAttribute("src", "https://storage.test/receipt");
    else expect(screen.getByTitle("Receipt")).toHaveAttribute("src", "https://storage.test/receipt#toolbar=0&navpanes=0&scrollbar=0&view=FitH");
    fireEvent.click(screen.getByTitle("Click to open")); expect(open).toHaveBeenCalledExactlyOnceWith("https://storage.test/receipt", "_blank", "noopener,noreferrer");
    const control = screen.getByRole("button", { name: "Open attachment Receipt" });
    fireEvent.keyDown(control, { key: "Enter" }); fireEvent.keyDown(control, { key: " " }); fireEvent.keyDown(control, { key: "a" });
    expect(open).toHaveBeenCalledTimes(3);
  });
  it("shows admin navigation only to admins and highlights the active route", () => {
    const { rerender } = render(<NavLinks />); expect(screen.queryByRole("link", { name: "Admin" })).not.toBeInTheDocument(); expect(screen.getByRole("link", { name: "Home" })).toHaveClass("active");
    router.pathname = "/admin"; rerender(<NavLinks isAdmin />); expect(screen.getByRole("link", { name: "Admin" })).toHaveClass("active");
  });
  it("opens/closes the user menu with outside click and Escape, and signs out", async () => {
    const user = userEvent.setup(); render(<UserMenu name="Test Employee" empID="EMP-1" email="employee@example.test" isAdmin />);
    const trigger = screen.getByRole("button", { name: /Test Employee/ });
    await user.click(trigger); expect(trigger).toHaveAttribute("aria-expanded", "true"); expect(within(screen.getByRole("menu")).getByText("Admin")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" }); expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    await user.click(trigger); fireEvent.mouseDown(document.body); expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    await user.click(trigger); await user.click(screen.getByRole("menuitem", { name: "Sign out" }));
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith("/api/auth/logout", { method: "POST" }); expect(router.push).toHaveBeenCalledWith("/"); expect(router.refresh).toHaveBeenCalledOnce();
  });
});
