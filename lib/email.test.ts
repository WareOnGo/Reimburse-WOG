// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendPartialApprovalEmail, type PartialApprovalEmail } from "./email";

const BASE: PartialApprovalEmail = {
  to: "employee@wareongo.com",
  name: "Asha",
  shortCode: "RB-2042",
  title: "Client dinner",
  requestedAmount: 5000,
  approvedAmount: 3000,
};

let fetchMock: ReturnType<typeof vi.fn>;

/** Returns the JSON payload posted to Resend for the most recent send. */
function sentPayload(): { subject: string; html: string; text: string } {
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  return JSON.parse(init.body as string);
}

beforeEach(() => {
  vi.stubEnv("APP_BASE_URL", "");
  vi.stubEnv("RESEND_REPLY_TO", "");
  vi.stubEnv("RESEND_API_KEY", "test-key");
  vi.stubEnv("RESEND_FROM", "noreply@wareongo.com");
  fetchMock = vi.fn(async () => ({ ok: true, text: async () => "" }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("sendPartialApprovalEmail deal/client rows", () => {
  it("includes the client and deal in both the HTML and plaintext bodies", async () => {
    await sendPartialApprovalEmail({
      ...BASE,
      clientName: "Delhivery Supply Chain Pvt Ltd",
      dealName: "50,000 sqft — Bhiwandi, Mumbai",
    });

    const { html, text } = sentPayload();
    expect(html).toContain("Delhivery Supply Chain Pvt Ltd");
    expect(html).toContain("50,000 sqft — Bhiwandi, Mumbai");
    expect(text).toContain("Client:         Delhivery Supply Chain Pvt Ltd");
    expect(text).toContain("Deal:           50,000 sqft — Bhiwandi, Mumbai");

    // The new rows must sit above the amounts, not displace them.
    const table = document.createElement("div");
    table.innerHTML = html;
    const rows = [...table.querySelectorAll("tr")].map((row) => [...row.querySelectorAll("td")].map((cell) => cell.textContent));
    expect(rows).toEqual([
      ["Client", "Delhivery Supply Chain Pvt Ltd"],
      ["Deal", "50,000 sqft — Bhiwandi, Mumbai"],
      ["Requested", "₹5,000"], ["Approved", "₹3,000"], ["Not approved", "₹2,000"],
    ]);
    expect(text).toContain("Requested:      ₹5,000");
    expect(text).toContain("Approved:       ₹3,000");
  });

  it("omits both rows entirely for a legacy ticket with null values", async () => {
    await sendPartialApprovalEmail({ ...BASE, clientName: null, dealName: null });

    const { html, text } = sentPayload();
    expect(html).not.toContain(">Client<");
    expect(html).not.toContain(">Deal<");
    expect(text).not.toContain("Client:");
    expect(text).not.toContain("Deal:");
    // The rest of the email is unaffected.
    expect(text).toContain("Requested:      ₹5,000");
    expect(html).toContain("Not approved");
  });

  it("escapes HTML in the client and deal names", async () => {
    await sendPartialApprovalEmail({
      ...BASE,
      clientName: `Acme <script>alert(1)</script>`,
      dealName: `40,000 sqft "Phase II" & annexe`,
    });

    const { html } = sentPayload();
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&quot;Phase II&quot;");
    expect(html).toContain("&amp; annexe");
  });
});
