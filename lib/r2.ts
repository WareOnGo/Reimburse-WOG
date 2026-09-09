import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

let _client: S3Client | null = null;
function client(): S3Client {
  if (_client) return _client;
  _client = new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT || `https://${required("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: required("R2_ACCESS_KEY_ID"),
      secretAccessKey: required("R2_SECRET_ACCESS_KEY"),
    },
  });
  return _client;
}

export const R2_BUCKET = process.env.R2_BUCKET ?? "";
export const R2_PUBLIC_BASE_URL = (process.env.R2_PUBLIC_BASE_URL ?? "").replace(/\/$/, "");

export type SignedUploadResult = {
  url: string;
  key: string;
  expiresIn: number;
};

export async function getUploadUrl(
  key: string,
  _contentType: string,
  expiresIn = 900,
): Promise<SignedUploadResult> {
  // NOTE: We deliberately do NOT set ContentType on the signed command.
  // Doing so makes `content-type` a SigV4 *signed* header, so the browser's PUT
  // must send a byte-identical Content-Type or R2 returns 403 (SignatureDoesNotMatch).
  // Some mobile browsers / in-app webviews / proxies rewrite that header, which
  // caused device-specific upload failures. R2 still records the content-type from
  // the client's PUT header, and we additionally pin it on download via
  // ResponseContentType (see getDownloadUrl), so previews stay correct regardless.
  const cmd = new PutObjectCommand({
    Bucket: required("R2_BUCKET"),
    Key: key,
  });
  const url = await getSignedUrl(client(), cmd, { expiresIn });
  return { url, key, expiresIn };
}

export async function getDownloadUrl(
  key: string,
  expiresIn = 300,
  opts?: { contentType?: string },
): Promise<string> {
  const cmd = new GetObjectCommand({
    Bucket: required("R2_BUCKET"),
    Key: key,
    // Pin the response content-type so the object renders inline correctly even
    // if it was stored with a missing/wrong type at upload time.
    ResponseContentType: opts?.contentType,
    ResponseContentDisposition: "inline",
  });
  return getSignedUrl(client(), cmd, { expiresIn });
}

export async function deleteObject(key: string): Promise<void> {
  await client().send(new DeleteObjectCommand({ Bucket: required("R2_BUCKET"), Key: key }));
}

export async function getObjectMetadata(key: string) {
  return client().send(new HeadObjectCommand({ Bucket: required("R2_BUCKET"), Key: key }));
}

export async function objectExists(key: string): Promise<boolean> {
  try {
    await client().send(new HeadObjectCommand({ Bucket: required("R2_BUCKET"), Key: key }));
    return true;
  } catch {
    return false;
  }
}

/** Returns a public URL if R2_PUBLIC_BASE_URL is configured, otherwise null. */
export function publicUrl(key: string): string | null {
  if (!R2_PUBLIC_BASE_URL) return null;
  return `${R2_PUBLIC_BASE_URL}/${encodeURI(key)}`;
}

/** Builds the canonical object key for a ticket attachment. */
export function buildAttachmentKey(opts: {
  ticketId: string;
  filename: string;
  uuid: string;
}): string {
  const safe = opts.filename.replace(/[^\w.\-]+/g, "_");
  return `tickets/${opts.ticketId}/${opts.uuid}-${safe}`;
}
