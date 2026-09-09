import { beforeEach, expect, it, vi } from "vitest";
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
const m = vi.hoisted(() => ({ send: vi.fn(), signed: vi.fn(), options: vi.fn() }));
vi.mock("@aws-sdk/client-s3", async (original) => ({ ...await original<typeof import("@aws-sdk/client-s3")>(),
  S3Client: class { constructor(options: unknown) { m.options(options); } send = m.send; },
}));
vi.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl: m.signed }));
beforeEach(() => {
  vi.resetAllMocks(); vi.resetModules();
  for (const [key, value] of Object.entries({ R2_ACCOUNT_ID: "account", R2_ACCESS_KEY_ID: "key", R2_SECRET_ACCESS_KEY: "secret", R2_BUCKET: "test-bucket", R2_PUBLIC_BASE_URL: "", R2_ENDPOINT: "" })) vi.stubEnv(key, value);
  m.signed.mockResolvedValue("https://storage.test/signed"); m.send.mockResolvedValue({ ContentLength: 123 });
});
it("signs uploads without ContentType and reuses the lazy client", async () => {
  const { getUploadUrl } = await import("./r2");
  expect(await getUploadUrl("key", "image/jpeg")).toEqual({ url: "https://storage.test/signed", key: "key", expiresIn: 900 });
  const command = m.signed.mock.calls[0][1] as PutObjectCommand;
  expect(command).toBeInstanceOf(PutObjectCommand); expect(command.input).toEqual({ Bucket: "test-bucket", Key: "key" });
  await getUploadUrl("second", "image/png", 300);
  expect(m.signed.mock.calls[1][2]).toEqual({ expiresIn: 300 }); expect(m.options).toHaveBeenCalledOnce();
  expect(m.options).toHaveBeenCalledWith({ region: "auto", endpoint: "https://account.r2.cloudflarestorage.com", credentials: { accessKeyId: "key", secretAccessKey: "secret" } });
});
it("pins download MIME and inline disposition with correct expiry", async () => {
  const { getDownloadUrl } = await import("./r2");
  expect(await getDownloadUrl("receipt", 600, { contentType: "application/pdf" })).toBe("https://storage.test/signed");
  expect(m.signed.mock.calls[0][1]).toBeInstanceOf(GetObjectCommand);
  expect(m.signed.mock.calls[0][1].input).toEqual({ Bucket: "test-bucket", Key: "receipt", ResponseContentType: "application/pdf", ResponseContentDisposition: "inline" });
  expect(m.signed.mock.calls[0][2]).toEqual({ expiresIn: 600 });
  await getDownloadUrl("plain"); expect(m.signed.mock.calls[1][2]).toEqual({ expiresIn: 300 });
});
it.each(["R2_BUCKET", "R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"])("lazily rejects missing %s", async (name) => {
  vi.stubEnv(name, ""); const { getUploadUrl } = await import("./r2"); await expect(getUploadUrl("key", "image/png")).rejects.toThrow(`Missing env: ${name}`); expect(m.signed).not.toHaveBeenCalled();
});
it("uses the exact key for deletion and propagates failure", async () => {
  const { deleteObject } = await import("./r2"); await deleteObject("receipt");
  expect(m.send.mock.calls[0][0]).toBeInstanceOf(DeleteObjectCommand); expect(m.send.mock.calls[0][0].input).toEqual({ Bucket: "test-bucket", Key: "receipt" });
  m.send.mockRejectedValue(new Error("offline")); await expect(deleteObject("receipt")).rejects.toThrow("offline");
});
it("reads metadata and reports object existence", async () => {
  const { getObjectMetadata, objectExists } = await import("./r2"); expect(await getObjectMetadata("receipt")).toEqual({ ContentLength: 123 });
  expect(m.send.mock.calls[0][0]).toBeInstanceOf(HeadObjectCommand); expect(await objectExists("receipt")).toBe(true);
  m.send.mockRejectedValue(new Error("not found")); expect(await objectExists("missing")).toBe(false);
});
it("sanitizes filenames and handles optional public base URLs", async () => {
  const r2 = await import("./r2"); expect(r2.buildAttachmentKey({ ticketId: "draft", filename: "my receipt (1).pdf", uuid: "uuid" })).toBe("tickets/draft/uuid-my_receipt_1_.pdf"); expect(r2.publicUrl("a b")).toBeNull();
  vi.stubEnv("R2_PUBLIC_BASE_URL", "https://assets.test/"); vi.resetModules(); const configured = await import("./r2"); expect(configured.publicUrl("folder/a b.pdf")).toBe("https://assets.test/folder/a%20b.pdf");
});
