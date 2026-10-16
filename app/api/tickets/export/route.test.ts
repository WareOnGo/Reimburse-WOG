import { beforeEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ user: vi.fn(), preview: vi.fn(), stream: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: m.user }));
vi.mock("@/lib/ticket-export-data", () => ({ ticketExportPreview: m.preview, ticketExportStream: m.stream }));
import { GET, HEAD } from "./route";

const request = (query = "") => new Request(`http://test.local/api/tickets/export?${query}`);
beforeEach(() => {
  vi.resetAllMocks();
  m.user.mockResolvedValue({ isAdmin: true });
  m.preview.mockResolvedValue({ count: 7, rows: [] });
  m.stream.mockImplementation(async () => new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode('\uFEFF"Ticket"\r\n"RB-1"\r\n'));
    controller.close();
  } }));
});

it.each([GET, HEAD])("requires an authenticated admin before preview or export", async (handler) => {
  for (const format of ["csv", "preview"]) {
    m.user.mockResolvedValue(null);
    expect((await handler(request(`format=${format}`))).status).toBe(401);
    m.user.mockResolvedValue({ isAdmin: false });
    expect((await handler(request(`format=${format}`))).status).toBe(403);
  }
  expect(m.preview).not.toHaveBeenCalled(); expect(m.stream).not.toHaveBeenCalled();
});
it("returns a no-store preview and uses the same validated range for streaming", async () => {
  const response = await GET(request("format=preview&from=2026-09-10&to=2026-09-11"));
  expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).toEqual({ count: 7, rows: [] });
  const req = request("format=csv&from=2026-09-10&to=2026-09-11");
  const csv = await GET(req);
  expect(m.stream).toHaveBeenCalledWith(m.preview.mock.calls[0][0], req.signal);
  expect(csv.headers.get("content-type")).toBe("text/csv; charset=utf-8");
  expect(csv.headers.get("content-disposition")).toBe('attachment; filename="ticket-history_2026-09-10_2026-09-11.csv"');
  expect(csv.headers.get("cache-control")).toBe("private, no-store");
  expect(csv.headers.get("x-accel-buffering")).toBe("no");
  const bytes = new Uint8Array(await csv.arrayBuffer());
  expect([...bytes.slice(0, 3)]).toEqual([239, 187, 191]);
  expect(new TextDecoder().decode(bytes)).toContain('"RB-1"');
});
it("defaults to all-history CSV and never applies table filters", async () => {
  const response = await GET(request("employee=EMP-2&status=PENDING&search=hidden"));
  expect(m.stream.mock.calls[0][0]).toEqual({});
  expect(response.headers.get("content-disposition")).toContain("ticket-history_all_latest.csv");
});
it.each(["csv", "preview"])("authorizes HEAD %s without opening an export transaction", async (format) => {
  const response = await HEAD(request(`format=${format}`));
  expect(response.status).toBe(200); expect(await response.text()).toBe("");
  expect(m.preview).not.toHaveBeenCalled(); expect(m.stream).not.toHaveBeenCalled();
});
it.each(["from=2026-02-30", "to=invalid", "from=0000-01-01", "from=2026-10-01&to=2026-09-01", "format=html"])("rejects bad export parameters %s", async (query) => {
  for (const handler of [GET, HEAD]) {
    const response = await handler(request(query));
    expect(response.status).toBe(400); expect(await response.json()).toHaveProperty("error");
  }
  expect(m.stream).not.toHaveBeenCalled(); expect(m.preview).not.toHaveBeenCalled();
});
it("does not disguise an initial database failure as a successful export", async () => {
  m.stream.mockRejectedValue(new Error("database offline"));
  await expect(GET(request())).rejects.toThrow("database offline");
});
