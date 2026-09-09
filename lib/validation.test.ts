import { describe, expect, it } from "vitest";
import { attachmentIds, attachments, expenseDate, money, record, requiredText, ticketStatus } from "./validation";
import { approvalAmount, parseCreateTicket, parseTicketPatch } from "./tickets";

const valid = { title: " Dinner ", category: "Meals", description: " Client meeting ", dealName: " Deal ", clientName: " Client ", amount: 1250.25 };
const file = { name: "receipt.pdf", kind: "DOCUMENT", contentType: "application/pdf", sizeBytes: 123, r2Key: "tickets/receipt.pdf" };
describe("request validation", () => {
  it.each([null, [], "text", 42, true])("rejects non-object body %j", (value) => expect(() => record(value)).toThrow("object"));
  it.each(["", "  ", null, 1])("rejects non-text or blank required input %j", (value) => expect(() => requiredText(value, "title")).toThrow("title"));
  it.each([0, 0.01, 0.29, 1.1, 1250.25, 9999999999.99])("accepts valid money %s", (value) => expect(money(value)).toBe(value));
  it.each([-1, NaN, Infinity, -Infinity, null, "10", 1e10, 1.001, 0.0001, 1e-18, 1.0000000000000002])("rejects invalid money %s", (value) => expect(() => money(value)).toThrow());
  it.each([undefined, null, ""])("clears optional date %j", (value) => expect(expenseDate(value)).toBeNull());
  it("parses a date in UTC, including leap day", () => expect(expenseDate("2024-02-29")).toEqual(new Date("2024-02-29T00:00:00Z")));
  it.each(["2026-02-29", "2026-04-31", "2026-13-01", "invalid", "2026-09-10T00:00:00Z", 123, {}])("rejects malformed or normalized date %j", (value) => expect(() => expenseDate(value)).toThrow("date"));
  it.each(["toString", "__proto__", "constructor", "UNKNOWN", null, 2])("rejects invalid status %j", (value) => expect(() => ticketStatus(value)).toThrow("status"));
  it.each(["PENDING", "REVIEW", "APPROVED", "CLEARED", "REJECTED", "CANCELLED"])("accepts status %s", (value) => expect(ticketStatus(value)).toBe(value));
  it("normalizes creation and ignores client-supplied ownership", () => {
    expect(parseCreateTicket({ ...valid, submittedByEmpID: "other" })).toEqual({ ...valid, title: "Dinner", description: "Client meeting", dealName: "Deal", clientName: "Client", expenseDate: null, attachments: [] });
  });
  it.each(["title", "category", "description", "dealName", "clientName", "amount"])("requires %s on create", (key) => expect(() => parseCreateTicket({ ...valid, [key]: undefined })).toThrow());
  it("preserves omitted patch fields and distinguishes explicit date clearing", () => {
    expect(parseTicketPatch({ title: " New " })).toMatchObject({ title: "New", expenseDate: undefined, editingFields: true });
    expect(parseTicketPatch({ expenseDate: null })).toMatchObject({ expenseDate: null, editingFields: true });
  });
  it.each([{}, { unknown: "field" }, { addAttachments: [] }, { approvedAmount: 20 }, { status: "CLEARED", approvedAmount: null }])("rejects empty or irrelevant patch %j", (value) => expect(() => parseTicketPatch(value)).toThrow());
  it("allows approval-only and mixed edit/approval payloads for later authorization", () => {
    expect(parseTicketPatch({ status: "APPROVED", approvedAmount: 100 })).toMatchObject({ editingFields: false, approvedAmount: 100 });
    expect(parseTicketPatch({ amount: 200, status: "APPROVED", approvedAmount: 100 })).toMatchObject({ editingFields: true });
  });
});

describe("attachment shape", () => {
  it("accepts documents/images, strips unknown nested fields, and allows the exact size limit", () => {
    expect(attachments([{ ...file, ticketId: "other" }])).toEqual([file]);
    expect(attachments([{ ...file, kind: "IMAGE", contentType: "image/jpeg", sizeBytes: 25 * 1024 * 1024 }])[0].kind).toBe("IMAGE");
    expect(attachments(undefined)).toEqual([]);
  });
  it.each([null, {}, [null], [{ ...file, sizeBytes: -1 }], [{ ...file, sizeBytes: 1.2 }], [{ ...file, sizeBytes: "123" }], [{ ...file, sizeBytes: 25 * 1024 * 1024 + 1 }], [{ ...file, kind: "IMAGE" }], [{ ...file, contentType: "text/html" }], [file, file]])("rejects malformed attachment input %j", (value) => expect(() => attachments(value)).toThrow());
  it("validates and deduplicates removal IDs", () => {
    expect(attachmentIds(undefined)).toEqual([]);
    expect(attachmentIds(["a", "a", "b"])).toEqual(["a", "b"]);
    expect(() => attachmentIds("a")).toThrow();
    expect(() => attachmentIds([null])).toThrow();
  });
});

describe("approval amounts", () => {
  it.each([undefined, null, 5000])("normalizes full approval %s", (value) => expect(approvalAmount("APPROVED", "PENDING", 5000, value)).toBeNull());
  it("stores partial approval", () => expect(approvalAmount("APPROVED", "PENDING", 5000, 3000)).toBe(3000));
  it.each([0, -1, 5000.01])("rejects an invalid sanctioned amount %s", (value) => expect(() => approvalAmount("APPROVED", "PENDING", 5000, value)).toThrow());
  it("preserves a cleared partial only when the amount is omitted", () => {
    expect(approvalAmount("APPROVED", "CLEARED", 5000, undefined)).toBeUndefined();
    expect(approvalAmount("APPROVED", "CLEARED", 5000, null)).toBeNull();
  });
  it("does not change the approval column for other status changes", () => expect(approvalAmount("CLEARED", "APPROVED", 5000, undefined)).toBeUndefined());
});
