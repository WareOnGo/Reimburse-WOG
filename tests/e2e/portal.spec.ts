import { test, expect, BrowserContext } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";

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
test("finance previews and downloads complete history independently of table filters", async ({ page, context }, testInfo) => {
  const suffix = randomBytes(4).toString("hex");
  const codes = Array.from({ length: 7 }, (_, index) => `export-${suffix}-${index}`);
  for (const [index, shortCode] of codes.entries()) await db.ticket.create({ data: {
    shortCode, title: 'Export "trip", Mumbai', category: "Travel", description: "Meeting\nTransport",
    submittedByEmpID: "EMP-1", amount: 1000.25, approvedAmount: index === 0 ? 750.15 : null,
    status: index === 0 ? "CLEARED" : "APPROVED", createdAt: new Date("2002-01-01T00:00:00Z"),
    events: { create: [
      { label: index === 0 ? "Partially approved by Finance (₹750.15 of ₹1,000.25)" : "Approved by Finance", createdAt: new Date("2002-09-09T18:30:00Z") },
      ...(index === 0 ? [{ label: "Cleared by Finance", createdAt: new Date("2002-09-10T18:29:59.999Z") }] : []),
    ] },
  } });
  expect((await context.request.get("/api/tickets/export?format=preview")).status()).toBe(401);
  await session(context, "employee@example.test");
  expect((await context.request.get("/api/tickets/export")).status()).toBe(403);
  await session(context, "finance@example.test"); await page.goto("/admin");
  await page.getByRole("searchbox").fill("Nothing should match this search");
  await expect(page.getByText("No tickets match your filters.")).toBeVisible();
  const trigger = page.getByRole("button", { name: "Export history" }); await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Export ticket history" });
  await expect(dialog.getByLabel("Date from")).toHaveValue("2002-01-01");
  await expect(dialog.getByLabel("Date to")).toHaveValue(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date()));
  await expect(dialog.getByText(`${(await db.ticket.count()).toLocaleString("en-IN")} rows to export`)).toBeVisible();
  await page.screenshot({ path: "/tmp/erp-export-defaults-desktop.png" });
  await dialog.getByLabel("Date from").fill("2002-09-10"); await dialog.getByLabel("Date to").fill("2002-09-10");
  await expect(dialog.getByText("7 rows to export")).toBeVisible();
  await expect(dialog.getByText("Preview of 5 of 7 tickets.")).toBeVisible();
  await expect(dialog.getByRole("row")).toHaveCount(6);
  await dialog.getByRole("button", { name: "Close export" }).focus(); await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByRole("button", { name: "Download CSV" })).toBeFocused();
  await page.keyboard.press("Tab"); await expect(dialog.getByRole("button", { name: "Close export" })).toBeFocused();
  await page.screenshot({ path: "/tmp/erp-export-desktop.png" });

  const pendingDownload = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Download CSV" }).click();
  const file = await pendingDownload;
  expect(file.suggestedFilename()).toBe("ticket-history_2002-09-10_2002-09-10.csv");
  const exportPath = testInfo.outputPath(file.suggestedFilename());
  await file.saveAs(exportPath);
  await testInfo.attach("Downloaded ticket history", { path: exportPath, contentType: "text/csv" });
  const bytes = await readFile((await file.path())!);
  expect([...bytes.subarray(0, 3)]).toEqual([239, 187, 191]);
  const csv = bytes.toString("utf8");
  for (const code of codes) expect(csv).toContain(`"${code}"`);
  expect(csv.match(/"export-/g)).toHaveLength(7);
  expect(csv).toContain('"1000.25","750.15","750.15"');
  expect(csv).toContain('"1000.25","1000.25","0.00"');
  expect(csv).toContain('"2002-09-10 23:59:59.999"');
  expect(csv).toContain('"Export ""trip"", Mumbai"');
  await expect(dialog.getByText(/Download started/)).toBeVisible();
  // Keep the independent database snapshot alongside the actual browser file
  // so a dry run can reconcile every exported amount and event without using
  // the export implementation to compute its expected values.
  await testInfo.attach("Export source data", { body: JSON.stringify({
    from: "2002-09-10", to: "2002-09-10", previewCount: 7, previewRows: 5,
    tickets: await db.ticket.findMany({ where: { shortCode: { in: codes } }, include: {
      submittedBy: { select: { verifiedNumber: { select: { name: true, email: true } } } },
      events: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
    } }),
  }, null, 2), contentType: "application/json" });

  await page.setViewportSize({ width: 390, height: 844 });
  await dialog.locator(".export-body").evaluate((element) => { element.scrollTop = 0; });
  await page.screenshot({ path: "/tmp/erp-export-mobile.png" });
  const bounds = await dialog.boundingBox(); expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await dialog.getByLabel("Date to").fill("2050-01-01"); await dialog.getByLabel("Date from").fill("2050-01-01");
  await expect(dialog.getByText("0 rows to export")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Download CSV" })).toBeDisabled();
  await dialog.getByLabel("Date from").fill("2050-01-02");
  await expect(dialog.getByRole("alert")).toHaveText("From date must be on or before to date.");
  await dialog.getByRole("button", { name: "Close export" }).focus(); await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible(); await expect(trigger).toBeFocused();
});
test("another employee cannot read/edit a ticket or sign its attachment download", async ({ page, context }) => {
  const ticket = await db.ticket.create({ data: { shortCode: `OWN-${randomBytes(4).toString("hex")}`, title: "Private receipt", category: "Travel", description: "Private", amount: 10, submittedByEmpID: "EMP-1" } });
  const attachment = await db.attachment.create({ data: { ticketId: ticket.id, name: "test.pdf", kind: "DOCUMENT", contentType: "application/pdf", sizeBytes: 1, r2Key: "test-only/foreign.pdf" } });
  await session(context, "other@example.test"); await page.goto(`/dashboard/tickets/${ticket.shortCode}`); await expect(page.getByText("This page could not be found.")).toBeVisible();
  expect((await context.request.patch(`/api/tickets/${ticket.id}`, { data: { title: "Forbidden" } })).status()).toBe(403);
  expect((await context.request.get(`/api/attachments/${attachment.id}/url`)).status()).toBe(403);
});
test("export cannot treat a partially typed date as an unrestricted range", async ({ page, context }) => {
  await db.ticket.create({ data: {
    shortCode: `DATE-${randomBytes(4).toString("hex")}`, title: "Date validation", category: "Travel",
    description: "Date test", amount: 10, submittedByEmpID: "EMP-1",
  } });
  await session(context, "finance@example.test"); await page.goto("/admin");
  await page.getByRole("button", { name: "Export history" }).click();
  const dialog = page.getByRole("dialog", { name: "Export ticket history" });
  const download = dialog.getByRole("button", { name: "Download CSV" });
  await expect(download).toBeEnabled();
  const from = dialog.getByLabel("Date from");
  const to = dialog.getByLabel("Date to");
  const defaults = { from: await from.inputValue(), to: await to.inputValue() };
  await from.fill(""); await from.focus();
  await from.press("ArrowLeft"); await from.press("ArrowLeft"); await from.press("ArrowLeft");
  await from.press("0"); await from.press("9");
  expect(await from.evaluate((element: HTMLInputElement) => element.validity.badInput)).toBe(true);
  await expect(download).toBeDisabled();
  await expect(dialog.getByRole("alert")).toContainText("complete, valid dates");
  await from.fill("2026-09-10");
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  // Reset also clears incomplete browser date segments, not just React state.
  await to.fill(""); await to.focus();
  await to.press("ArrowLeft"); await to.press("ArrowLeft"); await to.press("ArrowLeft");
  await to.press("0"); await to.press("9");
  await expect(download).toBeDisabled();
  await dialog.getByRole("button", { name: "All history" }).click();
  await expect(download).toBeEnabled();
  expect(await to.evaluate((element: HTMLInputElement) => element.validity.badInput)).toBe(false);
  await expect(from).toHaveValue(defaults.from); await expect(to).toHaveValue(defaults.to);
});
test("logout revokes the browser token and prevents replay over HTTP", async ({ page, context }) => {
  const token = await session(context, "employee@example.test"); await page.goto("/dashboard");
  await page.getByRole("button", { name: /Test Employee/ }).click(); await page.getByRole("menuitem", { name: "Sign out" }).click(); await expect(page).toHaveURL("/");
  await context.addCookies([{ name: "rp_session", value: token, url: `http://127.0.0.1:${process.env.ERP_TEST_PORT}` }]);
  expect((await context.request.get("/api/tickets")).status()).toBe(401);
});

test("reports a download error after preflight without saving a JSON or HTML file", async ({ page, context }) => {
  await db.ticket.create({ data: { shortCode: `DOWNLOAD-${randomBytes(4).toString("hex")}`, title: "Download errors", category: "Travel", description: "Test", amount: 1, submittedByEmpID: "EMP-1" } });
  await session(context, "finance@example.test"); await page.goto("/admin");
  let downloads = 0; page.on("download", () => { downloads++; });
  let responseType = "application/json";
  await page.route("**/api/tickets/export?format=csv&*", async (route) => {
    if (route.request().method() === "HEAD") return route.continue();
    await route.fulfill({ status: responseType === "application/json" ? 401 : 200, contentType: responseType,
      body: responseType === "application/json" ? JSON.stringify({ error: "unauthorized" }) : "<p>Sign in again</p>" });
  });
  await page.getByRole("button", { name: "Export history" }).click();
  const dialog = page.getByRole("dialog", { name: "Export ticket history" });
  await dialog.getByRole("button", { name: "Download CSV" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Your session has expired");
  responseType = "text/html";
  await dialog.getByRole("button", { name: "Download CSV" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Could not export tickets");
  expect(downloads).toBe(0); await expect(page).toHaveURL("/admin");
  responseType = "application/json";
  const requested = page.waitForRequest((request) => request.method() === "GET" && request.url().includes("format=csv"));
  await dialog.getByRole("button", { name: "Download CSV" }).click(); await requested;
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Your session has expired" })).toBeVisible();
  expect(downloads).toBe(0);
});

test("streams a large native download after closing the modal and releases disconnected exports", async ({ page, context }, testInfo) => {
  test.setTimeout(120_000);
  await session(context, "finance@example.test"); await page.goto("/admin");
  // Seed after opening the page to measure export delivery independently of
  // the existing, separately unpaginated admin entries table.
  const prefix = `native-${randomBytes(4).toString("hex")}-`;
  const count = 10_000;
  try {
    await db.$executeRaw`
      INSERT INTO "Ticket" (id, "shortCode", title, category, description, amount, "approvedAmount", status, "submittedByEmpID", "createdAt", "updatedAt")
      SELECT ${prefix} || i, ${prefix} || i, 'Native large export', 'Travel', repeat('Browser streaming test ', 64),
        1000.25, 750.15, 'CLEARED'::"TicketStatus", 'EMP-1', timestamp '2004-01-01', timestamp '2004-01-03'
      FROM generate_series(1, ${count}::int) i`;
    const csvUrl = "/api/tickets/export?format=csv&from=2004-01-01&to=2004-01-01";
    await page.evaluate(async (url) => {
      const abort = new AbortController();
      const response = await fetch(url, { signal: abort.signal });
      if (!response.ok) throw new Error("Export did not start");
      await response.body!.getReader().read(); abort.abort();
    }, csvUrl);
    await expect.poll(async () => {
      const [row] = await db.$queryRaw<{ count: number }[]>`SELECT COUNT(*)::int AS count FROM pg_stat_activity WHERE datname = current_database() AND state = 'idle in transaction'`;
      return row.count;
    }, { timeout: 10_000 }).toBe(0);

    await page.getByRole("button", { name: "Export history" }).click();
    const dialog = page.getByRole("dialog", { name: "Export ticket history" });
    await dialog.getByLabel("Date from").fill("2004-01-01"); await dialog.getByLabel("Date to").fill("2004-01-01");
    await expect(dialog.getByText("10,000 rows to export")).toBeVisible();
    const pending = page.waitForEvent("download"); await dialog.getByRole("button", { name: "Download CSV" }).click();
    await expect(dialog.getByText(/Download started/)).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    const file = await pending; await file.saveAs(testInfo.outputPath("large-native-export.csv"));
    expect(await file.failure()).toBeNull();
    const bytes = await readFile((await file.path())!);
    expect(bytes.byteLength).toBeGreaterThan(10_000_000);
    expect(bytes.toString("utf8").match(new RegExp(`^"${prefix}`, "gm"))).toHaveLength(count);
    await expect(page.getByRole("heading", { name: "Admin · Reimbursement review" })).toBeVisible();
    await expect(dialog).not.toBeVisible();
  } finally { await db.ticket.deleteMany({ where: { id: { startsWith: prefix } } }); }
});
