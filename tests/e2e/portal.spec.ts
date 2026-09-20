import { test, expect, BrowserContext } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";

const databaseUrl = process.env.ERP_TEST_DATABASE_URL;
if (!databaseUrl || new URL(databaseUrl).hostname !== "127.0.0.1" || new URL(databaseUrl).pathname !== "/erp_test") throw new Error("Disposable database required");
const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
async function session(context: BrowserContext, email: string) {
  const token = randomBytes(32).toString("hex");
  await db.reimbursementSession.create({ data: { tokenHash: createHash("sha256").update(token).digest("hex"), email, expiresAt: new Date(Date.now() + 3600000) } });
  await context.addCookies([{ name: "rp_session", value: token, url: `http://127.0.0.1:${process.env.ERP_TEST_PORT}`, httpOnly: true, sameSite: "Lax" }]);
  return token;
}
test.afterAll(() => db.$disconnect());
test("rejects plain email cookies and protects the admin page", async ({ page, context }) => {
  await context.addCookies([{ name: "rp_session", value: "finance@example.test", url: `http://127.0.0.1:${process.env.ERP_TEST_PORT}` }]);
  await page.goto("/admin"); await expect(page).toHaveURL("/"); await expect(page.getByRole("link", { name: "Continue with Google" })).toBeVisible();
  await session(context, "employee@example.test"); await page.goto("/admin"); await expect(page).toHaveURL("/dashboard");
});
test("employee creates, edits and cancels a ticket through the actual pages", async ({ page, context }) => {
  await session(context, "employee@example.test"); await page.goto("/dashboard/new");
  await page.getByLabel("Title", { exact: true }).fill("Browser travel reimbursement");
  await page.getByLabel("Amount (₹)").fill("2500.25");
  await page.getByLabel("Deal name").fill("West warehouse"); await page.getByLabel("Client name").fill("Browser Client");
  await page.getByLabel("Description").fill("Meeting transport"); await page.getByLabel(/Expense occurrence date/).fill("2026-09-09");
  await page.locator("input[type=file]").setInputFiles({ name: "browser-receipt.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\nBrowser receipt fixture\n%%EOF") });
  await expect(page.getByText(/· uploaded$/)).toBeVisible();
  await page.getByRole("button", { name: "Submit ticket" }).click(); await expect(page).toHaveURL("/dashboard");
  await page.getByRole("link", { name: /Browser travel reimbursement/ }).click(); await expect(page.getByRole("heading", { name: /Browser travel reimbursement/ })).toBeVisible();
  await expect(page.getByTitle("browser-receipt.pdf")).toBeVisible();
  await page.getByRole("link", { name: "Edit", exact: true }).click(); await expect(page.getByLabel("Client name")).toHaveValue("Browser Client");
  await page.getByLabel("Title", { exact: true }).fill("Updated browser reimbursement"); await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("heading", { name: /Updated browser reimbursement/ })).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click(); await page.getByRole("dialog").getByRole("button", { name: "Cancel ticket", exact: true }).click();
  await expect(page).toHaveURL("/dashboard"); await expect(page.getByText("cancelled", { exact: true }).first()).toBeVisible();
});
test("finance partially approves, clears and reverts without changing sanctioned money", async ({ page, context }) => {
  await session(context, "employee@example.test");
  const created = await context.request.post("/api/tickets", { data: { title: "Finance browser case", category: "Meals", amount: 5000, description: "Client meeting", dealName: "North warehouse", clientName: "Finance Client" } });
  expect(created.status()).toBe(201); const { shortCode } = await created.json();
  await session(context, "finance@example.test"); await page.goto("/admin");
  const review = page.getByRole("button", { name: `Review ticket ${shortCode}`, exact: true });
  await review.focus(); await page.keyboard.press("Enter"); const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible(); await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByRole("button", { name: "Approve", exact: true })).toBeFocused();
  await page.keyboard.press("Escape"); await expect(dialog).not.toBeVisible(); await expect(review).toBeFocused();
  await page.keyboard.press("Enter");
  await dialog.getByRole("button", { name: "Partial approve" }).click(); await dialog.getByLabel("Approved amount").fill("3000"); await dialog.getByRole("button", { name: "Confirm partial approval" }).click(); await expect(dialog).not.toBeVisible();
  await page.getByText(shortCode, { exact: true }).click(); await dialog.getByRole("button", { name: "Mark as cleared" }).click(); await expect(dialog).not.toBeVisible();
  await page.getByText(shortCode, { exact: true }).click(); await dialog.getByRole("button", { name: "Revert to approved" }).click(); await expect(dialog).not.toBeVisible();
  await session(context, "employee@example.test"); await page.goto(`/dashboard/tickets/${shortCode}`);
  await expect(page.getByText(/^₹3,000\s*of ₹5,000$/).first()).toBeVisible(); await expect(page.getByRole("link", { name: "Edit", exact: true })).toHaveCount(0);
});
test("finance selects filtered approvals and clears them together while preserving partial amounts", async ({ page, context }) => {
  const suffix = randomBytes(4).toString("hex");
  const ids = ["partial", "full", "pending", "other"].map((name) => `bulk-${name}-${suffix}`);
  await db.ticket.createMany({ data: ids.map((id, index) => ({
    id, shortCode: id, title: `Bulk clearance ${suffix}`, category: "Travel", description: "Bulk browser case",
    amount: index === 0 ? 5000 : 1200, approvedAmount: index === 0 ? 3000 : null,
    status: index === 2 ? "PENDING" : "APPROVED", submittedByEmpID: index === 3 ? "EMP-2" : "EMP-1",
  })) });
  await session(context, "employee@example.test");
  expect((await context.request.patch("/api/tickets/bulk-clear", { data: { ids: ids.slice(0, 2) } })).status()).toBe(403);
  await session(context, "finance@example.test"); await page.goto("/admin");
  await page.getByRole("searchbox").fill(`Bulk clearance ${suffix}`);
  await page.getByRole("combobox").selectOption("EMP-1");
  const first = page.getByRole("checkbox", { name: `Select ticket ${ids[0]}`, exact: true });
  await first.focus(); await page.keyboard.press("Space"); await expect(first).toBeChecked();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const selectAll = page.getByRole("checkbox", { name: "Select all visible approved entries" });
  await expect(selectAll).toBeChecked({ indeterminate: true }); await selectAll.check();
  await expect(page.getByRole("checkbox", { name: `Select ticket ${ids[2]}`, exact: true })).toBeDisabled();
  await expect(page.getByText("2 selected · ₹4,200 approved")).toBeVisible();
  await page.getByRole("button", { name: "Mark selected as cleared" }).click();
  const dialog = page.getByRole("dialog", { name: "Mark selected entries as cleared?" });
  await expect(dialog).toContainText("2 entries totalling ₹4,200");
  await dialog.getByRole("button", { name: "Clear 2 entries" }).click();
  await expect(dialog).not.toBeVisible(); await expect(page.getByText("2 entries marked as cleared.")).toBeVisible();
  for (const id of ids.slice(0, 2)) await expect(page.getByRole("row").filter({ has: page.getByRole("button", { name: `Review ticket ${id}`, exact: true }) }).getByText("cleared", { exact: true })).toBeVisible();
  await expect(selectAll).toBeDisabled();
  const saved = await db.ticket.findMany({ where: { id: { in: ids } }, include: { events: true } });
  expect(saved.find((ticket) => ticket.id === ids[0])?.approvedAmount?.toString()).toBe("3000");
  expect(saved.find((ticket) => ticket.id === ids[1])?.approvedAmount).toBeNull();
  expect(saved.find((ticket) => ticket.id === ids[2])?.status).toBe("PENDING");
  expect(saved.find((ticket) => ticket.id === ids[3])?.status).toBe("APPROVED");
  expect(saved.flatMap((ticket) => ticket.events).map((event) => event.label)).toEqual(["Cleared by Finance", "Cleared by Finance"]);
});
test("another employee cannot read/edit a ticket or sign its attachment download", async ({ page, context }) => {
  const ticket = await db.ticket.create({ data: { shortCode: `OWN-${randomBytes(4).toString("hex")}`, title: "Private receipt", category: "Travel", description: "Private", amount: 10, submittedByEmpID: "EMP-1" } });
  const attachment = await db.attachment.create({ data: { ticketId: ticket.id, name: "test.pdf", kind: "DOCUMENT", contentType: "application/pdf", sizeBytes: 1, r2Key: "test-only/foreign.pdf" } });
  await session(context, "other@example.test"); await page.goto(`/dashboard/tickets/${ticket.shortCode}`); await expect(page.getByText("This page could not be found.")).toBeVisible();
  expect((await context.request.patch(`/api/tickets/${ticket.id}`, { data: { title: "Forbidden" } })).status()).toBe(403);
  expect((await context.request.get(`/api/attachments/${attachment.id}/url`)).status()).toBe(403);
});
test("logout revokes the browser token and prevents replay over HTTP", async ({ page, context }) => {
  const token = await session(context, "employee@example.test"); await page.goto("/dashboard");
  await page.getByRole("button", { name: /Test Employee/ }).click(); await page.getByRole("menuitem", { name: "Sign out" }).click(); await expect(page).toHaveURL("/");
  await context.addCookies([{ name: "rp_session", value: token, url: `http://127.0.0.1:${process.env.ERP_TEST_PORT}` }]);
  expect((await context.request.get("/api/tickets")).status()).toBe(401);
});
