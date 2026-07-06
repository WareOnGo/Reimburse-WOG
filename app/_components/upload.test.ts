import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveMime, uploadToR2 } from "./upload";

// ── Test doubles ─────────────────────────────────────────────────────────────

type XhrBehavior =
  | { type: "success" }
  | { type: "status"; status: number }
  | { type: "error" }
  | { type: "timeout" };

class FakeXHR {
  static behaviors: XhrBehavior[] = [];
  static instances: FakeXHR[] = [];

  timeout = 0;
  status = 0;
  method = "";
  url = "";
  headers: Record<string, string> = {};
  sentBody: unknown = null;

  private listeners: Record<string, () => void> = {};
  private progressCb: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null = null;

  upload = {
    addEventListener: (
      ev: string,
      cb: (e: { lengthComputable: boolean; loaded: number; total: number }) => void,
    ) => {
      if (ev === "progress") this.progressCb = cb;
    },
  };

  addEventListener(ev: string, cb: () => void) {
    this.listeners[ev] = cb;
  }

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(name: string, value: string) {
    this.headers[name.toLowerCase()] = value;
  }

  send(body: unknown) {
    this.sentBody = body;
    FakeXHR.instances.push(this);
    const behavior = FakeXHR.behaviors.shift() ?? { type: "success" as const };
    queueMicrotask(() => {
      switch (behavior.type) {
        case "success":
          this.status = 200;
          this.progressCb?.({ lengthComputable: true, loaded: 50, total: 100 });
          this.progressCb?.({ lengthComputable: true, loaded: 100, total: 100 });
          this.listeners["load"]?.();
          break;
        case "status":
          this.status = behavior.status;
          this.listeners["load"]?.();
          break;
        case "error":
          this.listeners["error"]?.();
          break;
        case "timeout":
          this.listeners["timeout"]?.();
          break;
      }
    });
  }

  static reset() {
    FakeXHR.behaviors = [];
    FakeXHR.instances = [];
  }
}

const SIGN_RESPONSE = { url: "https://r2.test/put-here", key: "tickets/draft/uuid-receipt.jpg" };

function mockSignEndpoint() {
  return vi.fn(async () => ({
    ok: true,
    json: async () => ({ ...SIGN_RESPONSE }),
  }));
}

let fetchMock: ReturnType<typeof mockSignEndpoint>;

function signRequestBody(callIndex = 0) {
  const init = fetchMock.mock.calls[callIndex][1 as never] as RequestInit;
  return JSON.parse(init.body as string);
}

beforeEach(() => {
  FakeXHR.reset();
  fetchMock = mockSignEndpoint();
  vi.stubGlobal("XMLHttpRequest", FakeXHR);
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const pdfFile = () => new File(["%PDF-1.4 test"], "invoice.pdf", { type: "application/pdf" });

// ── resolveMime ──────────────────────────────────────────────────────────────

describe("resolveMime", () => {
  it("trusts a real browser-provided type", () => {
    expect(resolveMime(new File([""], "a.bin", { type: "image/webp" }))).toBe("image/webp");
  });

  it("falls back to the extension when the type is empty (Android)", () => {
    expect(resolveMime(new File([""], "IMG_1234.JPG", { type: "" }))).toBe("image/jpeg");
    expect(resolveMime(new File([""], "receipt.heic", { type: "" }))).toBe("image/heic");
  });

  it("falls back to the extension when the type is octet-stream", () => {
    expect(resolveMime(new File([""], "scan.pdf", { type: "application/octet-stream" }))).toBe(
      "application/pdf",
    );
  });

  it("keeps octet-stream for unknown extensions", () => {
    expect(resolveMime(new File([""], "weird.xyz", { type: "" }))).toBe("application/octet-stream");
  });
});

// ── uploadToR2: transport & retry ────────────────────────────────────────────

describe("uploadToR2", () => {
  it("signs then PUTs and returns attachment metadata", async () => {
    const onProgress = vi.fn();
    const result = await uploadToR2(pdfFile(), "draft", onProgress);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const signBody = signRequestBody();
    expect(signBody).toEqual({
      filename: "invoice.pdf",
      contentType: "application/pdf",
      ticketId: "draft",
    });

    expect(FakeXHR.instances).toHaveLength(1);
    const xhr = FakeXHR.instances[0];
    expect(xhr.method).toBe("PUT");
    expect(xhr.url).toBe(SIGN_RESPONSE.url);
    expect(xhr.headers["content-type"]).toBe("application/pdf");
    expect(xhr.timeout).toBe(120_000);

    expect(result).toEqual({
      name: "invoice.pdf",
      kind: "DOCUMENT",
      contentType: "application/pdf",
      sizeBytes: pdfFile().size,
      r2Key: SIGN_RESPONSE.key,
    });
    expect(onProgress).toHaveBeenCalledWith(100);
  });

  it("retries a network error and re-signs on the second attempt", async () => {
    vi.useFakeTimers();
    FakeXHR.behaviors = [{ type: "error" }, { type: "success" }];

    const promise = uploadToR2(pdfFile(), "draft", () => {});
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.r2Key).toBe(SIGN_RESPONSE.key);
    expect(fetchMock).toHaveBeenCalledTimes(2); // fresh presign per attempt
    expect(FakeXHR.instances).toHaveLength(2);
  });

  it("retries a timeout and a 5xx, then gives up after 3 attempts", async () => {
    vi.useFakeTimers();
    FakeXHR.behaviors = [{ type: "timeout" }, { type: "status", status: 503 }, { type: "error" }];

    const promise = uploadToR2(pdfFile(), "draft", () => {});
    promise.catch(() => {}); // avoid unhandled rejection while timers advance
    await vi.runAllTimersAsync();

    await expect(promise).rejects.toThrow("network error during upload");
    expect(FakeXHR.instances).toHaveLength(3);
  });

  it("does not retry a 4xx from R2", async () => {
    FakeXHR.behaviors = [{ type: "status", status: 403 }];

    await expect(uploadToR2(pdfFile(), "draft", () => {})).rejects.toThrow("upload failed (403)");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(FakeXHR.instances).toHaveLength(1);
  });

  it("does not retry a 4xx from the sign endpoint", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: "unauthorized" }),
    } as never);

    await expect(uploadToR2(pdfFile(), "draft", () => {})).rejects.toThrow("unauthorized");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(FakeXHR.instances).toHaveLength(0);
  });

  it("passes the ticket id through to the sign request", async () => {
    await uploadToR2(pdfFile(), "ticket-42", () => {});
    const signBody = signRequestBody();
    expect(signBody.ticketId).toBe("ticket-42");
  });
});

// ── uploadToR2: image compression ────────────────────────────────────────────

describe("uploadToR2 image compression", () => {
  const realCreateElement = document.createElement.bind(document);

  function stubCanvas(outputBlob: Blob | null) {
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage: vi.fn() }),
      toBlob: (cb: (b: Blob | null) => void) => cb(outputBlob),
    };
    vi.spyOn(document, "createElement").mockImplementation((tag: string) =>
      tag === "canvas" ? (canvas as unknown as HTMLElement) : realCreateElement(tag),
    );
    return canvas;
  }

  function bigImageFile(bytes = 400 * 1024, name = "photo.png", type = "image/png") {
    return new File([new Uint8Array(bytes)], name, { type });
  }

  it("re-encodes a large image to a bounded JPEG and uploads the smaller blob", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ width: 4000, height: 3000, close: vi.fn() })),
    );
    const jpeg = new Blob([new Uint8Array(50 * 1024)], { type: "image/jpeg" });
    const canvas = stubCanvas(jpeg);

    const result = await uploadToR2(bigImageFile(), "draft", () => {});

    // 4000×3000 scaled so the long edge is 1800
    expect(canvas.width).toBe(1800);
    expect(canvas.height).toBe(1350);
    expect(result.name).toBe("photo.jpg");
    expect(result.contentType).toBe("image/jpeg");
    expect(result.kind).toBe("IMAGE");
    expect(result.sizeBytes).toBe(jpeg.size);
    expect(FakeXHR.instances[0].sentBody).toBe(jpeg);

    // The presign must be requested for the compressed name/type
    const signBody = signRequestBody();
    expect(signBody.filename).toBe("photo.jpg");
    expect(signBody.contentType).toBe("image/jpeg");
  });

  it("keeps the original when re-encoding does not shrink it", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ width: 4000, height: 3000, close: vi.fn() })),
    );
    stubCanvas(new Blob([new Uint8Array(500 * 1024)], { type: "image/jpeg" }));

    const file = bigImageFile(400 * 1024);
    const result = await uploadToR2(file, "draft", () => {});

    expect(result.name).toBe("photo.png");
    expect(result.contentType).toBe("image/png");
    expect(FakeXHR.instances[0].sentBody).toBe(file);
  });

  it("skips compression for small images", async () => {
    const decodeSpy = vi.fn();
    vi.stubGlobal("createImageBitmap", decodeSpy);

    const file = bigImageFile(100 * 1024); // under the 300 KB threshold
    const result = await uploadToR2(file, "draft", () => {});

    expect(decodeSpy).not.toHaveBeenCalled();
    expect(result.name).toBe("photo.png");
    expect(FakeXHR.instances[0].sentBody).toBe(file);
  });

  it("skips compression for non-images", async () => {
    const decodeSpy = vi.fn();
    vi.stubGlobal("createImageBitmap", decodeSpy);

    await uploadToR2(pdfFile(), "draft", () => {});
    expect(decodeSpy).not.toHaveBeenCalled();
  });

  it("uploads the original bytes when the image cannot be decoded (e.g. HEIC on Android)", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => {
        throw new Error("unsupported format");
      }),
    );
    vi.stubGlobal("URL", {
      createObjectURL: () => {
        throw new Error("unsupported format");
      },
      revokeObjectURL: () => {},
    });

    const file = bigImageFile(400 * 1024, "receipt.heic", "image/heic");
    const result = await uploadToR2(file, "draft", () => {});

    expect(result.name).toBe("receipt.heic");
    expect(result.contentType).toBe("image/heic");
    expect(result.kind).toBe("IMAGE");
    expect(FakeXHR.instances[0].sentBody).toBe(file);
  });
});
