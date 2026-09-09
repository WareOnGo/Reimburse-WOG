import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { buildAttachmentKey, getUploadUrl } from "@/lib/r2";
import { getCurrentUser } from "@/lib/auth";
import { attachmentPrefix } from "@/lib/attachment-access";
import { InputError, record, requiredText } from "@/lib/validation";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let json: unknown;
  try { json = await req.json(); }
  catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  try {
    const body = record(json);
    const filename = requiredText(body.filename, "filename");
    const contentType = requiredText(body.contentType, "contentType");
    if (!contentType.startsWith("image/") && contentType !== "application/pdf") throw new InputError("unsupported content type");
    const ticketId = body.ticketId === undefined ? "draft" : requiredText(body.ticketId, "ticketId");
    if (!/^[a-zA-Z0-9_-]+$/.test(ticketId)) throw new InputError("invalid ticketId");
    const key = buildAttachmentKey({
      ticketId: `${attachmentPrefix(user.empID).slice("tickets/".length)}${ticketId}`,
      filename, uuid: randomUUID(),
    });
    return NextResponse.json(await getUploadUrl(key, contentType, 300));
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    return NextResponse.json({ error: message }, { status: error instanceof InputError ? 400 : 500 });
  }
}
