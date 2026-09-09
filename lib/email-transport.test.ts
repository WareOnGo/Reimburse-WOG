import { beforeEach, expect, it, vi } from "vitest";
import { sendEmail, sendPartialApprovalEmail } from "./email";
const fetchMock = vi.fn<typeof fetch>();
const args = { to: "employee@example.test", subject: "Subject", html: "<p>Hello</p>", text: "Hello" };
beforeEach(() => {
  fetchMock.mockReset().mockResolvedValue(new Response("", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("RESEND_API_KEY", "test-key"); vi.stubEnv("RESEND_FROM", "sender@example.test");
  vi.stubEnv("RESEND_REPLY_TO", ""); vi.stubEnv("APP_BASE_URL", "");
  vi.spyOn(console, "warn").mockImplementation(() => {}); vi.spyOn(console, "error").mockImplementation(() => {});
});
it("sends the exact transport contract and returns true", async () => {
  expect(await sendEmail(args)).toBe(true);
  expect(fetchMock).toHaveBeenCalledExactlyOnceWith("https://api.resend.com/emails", {
    method: "POST", headers: { Authorization: "Bearer test-key", "content-type": "application/json" },
    body: JSON.stringify({ from: "sender@example.test", ...args }),
  });
});
it("includes optional reply-to only when configured", async () => {
  vi.stubEnv("RESEND_REPLY_TO", "finance@example.test");
  expect(await sendEmail(args)).toBe(true);
  expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string).reply_to).toBe("finance@example.test");
});
it.each(["RESEND_API_KEY", "RESEND_FROM"])("skips sends if %s is missing", async (key) => {
  vi.stubEnv(key, ""); expect(await sendEmail(args)).toBe(false); expect(fetchMock).not.toHaveBeenCalled();
});
it("skips an empty recipient", async () => { expect(await sendEmail({ ...args, to: "" })).toBe(false); expect(fetchMock).not.toHaveBeenCalled(); });
it.each([400, 429, 500])("resolves false on HTTP %s", async (status) => {
  fetchMock.mockResolvedValue(new Response("provider error", { status })); expect(await sendEmail(args)).toBe(false);
});
it("resolves false for network failure and unreadable error bodies", async () => {
  fetchMock.mockRejectedValueOnce(new Error("offline")); expect(await sendEmail(args)).toBe(false);
  const response = new Response("error", { status: 500 }); vi.spyOn(response, "text").mockRejectedValue(new Error("read failed"));
  fetchMock.mockResolvedValue(response); expect(await sendEmail(args)).toBe(false);
});
it.each(["", "https://portal.example.test", "https://portal.example.test/"])("builds amount/subject/link semantics for base %s", async (base) => {
  vi.stubEnv("APP_BASE_URL", base);
  expect(await sendPartialApprovalEmail({ to: args.to, name: "Asha", shortCode: "RB-2042", title: "Dinner", requestedAmount: 123456.78, approvedAmount: 23456.75 })).toBe(true);
  const body = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
  expect(body.subject).toBe("Reimbursement RB-2042 partially approved — ₹23,456.75");
  expect(body.text).toContain("Requested:      ₹1,23,456.78"); expect(body.text).toContain("Not approved:   ₹1,00,000.03");
  if (base) { expect(body.html).toContain('href="https://portal.example.test/dashboard"'); expect(body.text).toContain("View details: https://portal.example.test/dashboard"); }
  else { expect(body.html).not.toContain("View in portal"); expect(body.text).not.toContain("View details:"); }
});
it.each([["Client only", null], [null, "Deal only"], [undefined, undefined]])("independently includes optional client/deal %s %s", async (clientName, dealName) => {
  await sendPartialApprovalEmail({ to: args.to, name: "Asha", shortCode: "RB-1", title: "Dinner", requestedAmount: 10, approvedAmount: 5, clientName, dealName });
  const { text } = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
  expect(text.includes("Client:")).toBe(Boolean(clientName)); expect(text.includes("Deal:")).toBe(Boolean(dealName));
});
it("escapes every user-controlled HTML text field including apostrophes", async () => {
  const value = `A & <b> "quoted" 'name'`;
  await sendPartialApprovalEmail({ to: args.to, name: value, shortCode: value, title: value, requestedAmount: 10, approvedAmount: 5, clientName: value, dealName: value });
  const { html, text } = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
  expect(html).not.toContain("<b>"); expect(html.match(/A &amp; &lt;b&gt; &quot;quoted&quot; &#39;name&#39;/g)).toHaveLength(5); expect(text).toContain(value);
});
