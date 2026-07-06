// Client-side attachment upload: MIME resolution, image compression, and
// direct-to-R2 PUT with progress, timeout, and retry.

export type UploadedAttachment = {
  name: string;
  kind: "IMAGE" | "DOCUMENT";
  contentType: string;
  sizeBytes: number;
  r2Key: string;
};

type SignResponse = { url: string; key: string };

// Android browsers and some webviews report an empty or generic file.type,
// so fall back to the extension before trusting it.
const MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  pdf: "application/pdf",
};

export function resolveMime(file: File): string {
  if (file.type && file.type !== "application/octet-stream") return file.type;
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

function kindFor(contentType: string): "IMAGE" | "DOCUMENT" {
  return contentType.startsWith("image/") ? "IMAGE" : "DOCUMENT";
}

class UploadHttpError extends Error {
  constructor(
    readonly status: number,
    message?: string,
  ) {
    super(message ?? `upload failed (${status})`);
  }
}

function isRetryable(err: unknown): boolean {
  if (err instanceof UploadHttpError) {
    return err.status >= 500 || err.status === 408 || err.status === 429;
  }
  return true; // network error / timeout
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Image compression ────────────────────────────────────────────────────────
// Receipts don't need 12-megapixel originals; re-encoding to a bounded JPEG
// typically shrinks a phone photo 10-20×, which is the difference between an
// upload that survives a weak mobile uplink and one that stalls out.

const COMPRESS_MAX_DIM = 1800;
const COMPRESS_QUALITY = 0.82;
const COMPRESS_MIN_BYTES = 300 * 1024;

type PreparedUpload = { body: Blob; name: string; contentType: string };

async function decodeImage(
  file: File,
): Promise<{ src: CanvasImageSource; width: number; height: number; close?: () => void }> {
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(file);
      return { src: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
    } catch {
      // fall through to <img> decode (covers e.g. HEIC on Safari)
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { src: img, width: img.naturalWidth, height: img.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function prepareForUpload(file: File): Promise<PreparedUpload> {
  const contentType = resolveMime(file);
  const original: PreparedUpload = { body: file, name: file.name, contentType };
  // GIFs may be animated and PDFs/documents aren't re-encodable here.
  if (!contentType.startsWith("image/") || contentType === "image/gif") return original;
  if (file.size < COMPRESS_MIN_BYTES) return original;

  try {
    const decoded = await decodeImage(file);
    const scale = Math.min(1, COMPRESS_MAX_DIM / Math.max(decoded.width, decoded.height));
    const w = Math.max(1, Math.round(decoded.width * scale));
    const h = Math.max(1, Math.round(decoded.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return original;
    ctx.drawImage(decoded.src, 0, 0, w, h);
    decoded.close?.();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", COMPRESS_QUALITY),
    );
    if (!blob || blob.size >= file.size) return original;
    return {
      body: blob,
      name: file.name.replace(/\.[^.]+$/, "") + ".jpg",
      contentType: "image/jpeg",
    };
  } catch {
    // Undecodable format (e.g. HEIC on Android) — upload the original bytes.
    return original;
  }
}

// ── Transport ────────────────────────────────────────────────────────────────

function putWithProgress(
  url: string,
  body: Blob,
  contentType: string,
  onProgress: (pct: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.timeout = 120_000;
    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    });
    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new UploadHttpError(xhr.status));
    });
    xhr.addEventListener("error", () => reject(new Error("network error during upload")));
    xhr.addEventListener("timeout", () => reject(new Error("upload timed out")));
    xhr.addEventListener("abort", () => reject(new Error("upload cancelled")));
    xhr.open("PUT", url);
    xhr.setRequestHeader("content-type", contentType);
    xhr.send(body);
  });
}

const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [1000, 3000];

/**
 * Compress (if an image), presign, and PUT one file to R2.
 * Retries transient failures (network, timeout, 5xx) with backoff; each
 * attempt re-signs so an expired URL can't wedge the retry. Permanent (4xx)
 * failures surface immediately.
 */
export async function uploadToR2(
  file: File,
  ticketKeyHint: string,
  onProgress: (pct: number) => void,
): Promise<UploadedAttachment> {
  const prepared = await prepareForUpload(file);

  let lastErr: unknown = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) await sleep(BACKOFF_MS[attempt - 1]);
    try {
      const signRes = await fetch("/api/r2/sign", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          filename: prepared.name,
          contentType: prepared.contentType,
          ticketId: ticketKeyHint,
        }),
      });
      if (!signRes.ok) {
        const data = await signRes.json().catch(() => ({}));
        throw new UploadHttpError(signRes.status, data.error ?? "could not get upload URL");
      }
      const { url, key } = (await signRes.json()) as SignResponse;

      onProgress(0);
      await putWithProgress(url, prepared.body, prepared.contentType, onProgress);

      return {
        name: prepared.name,
        kind: kindFor(prepared.contentType),
        contentType: prepared.contentType,
        sizeBytes: prepared.body.size,
        r2Key: key,
      };
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err)) break;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("upload failed");
}
