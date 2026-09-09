import { expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { employeeTotals, ticketTotals } from "./totals";

const zero = { pendingCount: 0, pendingAmount: 0, approvedCount: 0, approvedAmount: 0, clearedCount: 0, clearedAmount: 0, rejectedCount: 0, rejectedAmount: 0 };
it("returns zero totals for no tickets", () => expect(ticketTotals([])).toEqual(zero));
it("keeps status counts and partial shortfalls distinct", () => {
  expect(ticketTotals([
    { status: "PENDING", amount: 1000, approvedAmount: null },
    { status: "REVIEW", amount: 500, approvedAmount: null },
    { status: "APPROVED", amount: 2000, approvedAmount: null },
    { status: "APPROVED", amount: 5000, approvedAmount: 3000 },
    { status: "CLEARED", amount: 4000, approvedAmount: 2500 },
    { status: "REJECTED", amount: 700, approvedAmount: null },
    { status: "CANCELLED", amount: 900, approvedAmount: null },
  ])).toEqual({ pendingCount: 2, pendingAmount: 1500, approvedCount: 2, approvedAmount: 5000, clearedCount: 1, clearedAmount: 2500, rejectedCount: 1, rejectedAmount: 4200 });
});
it("sums in cents rather than accumulating floating point drift", () => {
  expect(ticketTotals([
    { status: "PENDING", amount: new Prisma.Decimal("0.10"), approvedAmount: null },
    { status: "REVIEW", amount: "0.20", approvedAmount: null },
  ])).toEqual({ ...zero, pendingCount: 2, pendingAmount: 0.3 });
});
it("counts a partial shortfall without inventing a rejected ticket", () => {
  expect(ticketTotals([{ status: "CLEARED", amount: 10.5, approvedAmount: 4.25 }])).toEqual({ ...zero, clearedCount: 1, clearedAmount: 4.25, rejectedAmount: 6.25 });
});
it("keeps employees separate, includes cancelled-only employees, and leaves input unchanged", () => {
  const tickets = Object.freeze([
    Object.freeze({ submittedByEmpID: "A", status: "APPROVED" as const, amount: 10, approvedAmount: null }),
    Object.freeze({ submittedByEmpID: "B", status: "CLEARED" as const, amount: 20, approvedAmount: null }),
    Object.freeze({ submittedByEmpID: "A", status: "PENDING" as const, amount: 3, approvedAmount: null }),
    Object.freeze({ submittedByEmpID: "C", status: "CANCELLED" as const, amount: 7, approvedAmount: null }),
  ]);
  expect(employeeTotals(tickets)).toEqual(new Map([
    ["A", { ...zero, approvedCount: 1, approvedAmount: 10, pendingCount: 1, pendingAmount: 3 }],
    ["B", { ...zero, clearedCount: 1, clearedAmount: 20 }], ["C", zero],
  ]));
});
