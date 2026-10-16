import { describe, expect, it } from "vitest";
import { Prisma, TicketStatus } from "@prisma/client";
import { ticketExportCsv, ticketExportRow, ticketExportWhere } from "./ticket-export";

const ticket: Parameters<typeof ticketExportRow>[0] = {
  id: "ticket-1", shortCode: "RB-2001", title: 'Meeting, "Mumbai"', category: "Travel", description: "First line\nSecond line",
  status: "CLEARED", amount: new Prisma.Decimal("5000.25"), approvedAmount: new Prisma.Decimal("3000.15"),
  submittedByEmpID: "EMP-1", submittedBy: { verifiedNumber: { name: "Asha", email: "asha@example.test" } },
  dealName: "Warehouse", clientName: "Client", expenseDate: new Date("2026-09-09T00:00:00Z"),
  createdAt: new Date("2026-09-09T18:30:00Z"), updatedAt: new Date("2026-09-12T12:00:00Z"),
  events: [
    { label: "Ticket submitted", createdAt: new Date("2026-09-09T18:30:00Z") },
    { label: "Approved by Finance", createdAt: new Date("2026-09-10T10:00:00Z") },
    { label: "Marked pending", createdAt: new Date("2026-09-10T11:00:00Z") },
    { label: "Partially approved by Finance (₹3,000.15 of ₹5,000.25)", createdAt: new Date("2026-09-11T10:00:00Z") },
    { label: "Cleared by Finance", createdAt: new Date("2026-09-12T12:00:00Z") },
  ],
};

describe("export dates", () => {
  it("includes all history by default and converts inclusive dates from IST", () => {
    expect(ticketExportWhere(new URLSearchParams())).toEqual({});
    expect(ticketExportWhere(new URLSearchParams("from=&to="))).toEqual({});
    const where = ticketExportWhere(new URLSearchParams("from=2026-09-10&to=2026-09-10"));
    expect(where).toEqual({ OR: [
      { createdAt: { gte: new Date("2026-09-09T18:30:00Z"), lt: new Date("2026-09-10T18:30:00Z") } },
      { events: { some: {
        createdAt: { gte: new Date("2026-09-09T18:30:00Z"), lt: new Date("2026-09-10T18:30:00Z") },
        OR: [{ label: "Approved by Finance" }, { label: { startsWith: "Partially approved by Finance (" } }, { label: "Cleared by Finance" }],
      } } },
    ] });
  });
  it("supports either open end and leap days", () => {
    expect(ticketExportWhere(new URLSearchParams("from=2024-02-29")).OR).toContainEqual({ createdAt: { gte: new Date("2024-02-28T18:30:00Z") } });
    expect(ticketExportWhere(new URLSearchParams("to=2026-12-31")).OR).toContainEqual({ createdAt: { lt: new Date("2026-12-31T18:30:00Z") } });
  });
  it.each(["from=2026-02-29", "to=2026-04-31", "from=2026-13-01", "from=2026-9-1", "to=not-a-date", "from=0000-01-01", "from=2026-09-11&to=2026-09-10", "from=2026-09-10T12:00:00Z"])("rejects invalid range %s", (query) => {
    expect(() => ticketExportWhere(new URLSearchParams(query))).toThrow();
  });
});

describe("ticket history rows", () => {
  it("keeps exact paise, actual approval/clearance dates, and every recorded event", () => {
    const row = ticketExportRow(ticket);
    expect(row).toMatchObject({ requestedAmount: "5000.25", approvedAmount: "3000.15", clearedAmount: "3000.15",
      raisedAt: "2026-09-10 00:00:00.000", approvedAt: "2026-09-11 15:30:00.000", clearedAt: "2026-09-12 17:30:00.000", expenseDate: "2026-09-09" });
    expect(row.history.split("\n")).toHaveLength(5);
    expect(row.history).toContain("2026-09-10 16:30:00.000 IST — Marked pending");
    expect(row.history).toContain("₹3,000.15 of ₹5,000.25");
  });
  it.each(["APPROVED", "CLEARED"] as const)("uses full requested money for a null approval in %s", (status) => {
    expect(ticketExportRow({ ...ticket, status, approvedAmount: null })).toMatchObject({ approvedAmount: "5000.25", clearedAmount: status === "CLEARED" ? "5000.25" : "0.00" });
  });
  it.each(["PENDING", "REVIEW", "REJECTED", "CANCELLED"] as TicketStatus[])("does not count old sanctioned money as currently payable in %s", (status) => {
    expect(ticketExportRow({ ...ticket, status })).toMatchObject({ requestedAmount: "5000.25", approvedAmount: "0.00", clearedAmount: "0.00" });
  });
  it("retains recorded clearance history after reversal, with zero currently cleared", () => {
    expect(ticketExportRow({ ...ticket, status: "APPROVED" })).toMatchObject({ approvedAmount: "3000.15", clearedAmount: "0.00", clearedAt: "2026-09-12 17:30:00.000" });
  });
  it("does not invent dates for legacy tickets and handles null details and zero amounts", () => {
    expect(ticketExportRow({ ...ticket, amount: new Prisma.Decimal(0), approvedAmount: null, events: [],
      expenseDate: null, dealName: null, clientName: null, submittedBy: { verifiedNumber: { name: "Legacy", email: null } },
    })).toMatchObject({ approvedAt: "", clearedAt: "", approvedAmount: "0.00", clearedAmount: "0.00", expenseDate: "", dealName: "", clientName: "", employeeEmail: "", history: "" });
  });
  it("preserves the maximum database amount without rounding through floating point", () => {
    expect(ticketExportRow({ ...ticket, amount: new Prisma.Decimal("9999999999.99"), approvedAmount: null }).clearedAmount).toBe("9999999999.99");
  });
});

describe("CSV", () => {
  it("escapes commas, quotes and newlines and includes a BOM, named amount columns and history", () => {
    const csv = ticketExportCsv([ticketExportRow(ticket)]);
    expect(csv.startsWith('\uFEFF"Ticket","Ticket ID"')).toBe(true);
    expect(csv).toContain('"Current requested amount (INR)","Current approved amount (INR)","Current cleared amount (INR)"');
    expect(csv).toContain('"Meeting, ""Mumbai"""');
    expect(csv).toContain('"First line\nSecond line"');
    expect(csv).toContain('"5000.25","3000.15","3000.15"');
    expect(csv.endsWith("\r\n")).toBe(true);
  });
  it.each(["=1+1", "+SUM(1,2)", "-1+2", "@SUM(A1)", "  =1+1", "\tname", "\n=1+1", "\rname", "\u0000=1+1"])("neutralizes spreadsheet formula prefixes in %j", (title) => {
    expect(ticketExportCsv([ticketExportRow({ ...ticket, title })])).toContain(`"'${title}"`);
  });
  it("exports column headers when no tickets match", () => {
    expect(ticketExportCsv([]).split("\r\n")).toHaveLength(2);
  });
  it("combines bounded CSV chunks without repeating headers or BOMs", () => {
    const row = ticketExportRow(ticket);
    expect(ticketExportCsv([]) + ticketExportCsv([row], false) + ticketExportCsv([row], false)).toBe(ticketExportCsv([row, row]));
    expect(ticketExportCsv([], false)).toBe("");
  });
});
