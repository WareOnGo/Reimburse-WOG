import { getObjectMetadata } from "./r2";
import { AttachmentInput, InputError } from "./validation";

export function attachmentPrefix(empID: string) {
  return `tickets/employees/${encodeURIComponent(empID)}/`;
}

/** Existing attachments remain readable; newly associated uploads must belong
 * to the current employee and match completed object bytes. */
export async function verifyAttachments(items: AttachmentInput[], empID: string): Promise<void> {
  for (const item of items) {
    if (!item.r2Key.startsWith(attachmentPrefix(empID))) throw new InputError("attachment does not belong to this employee");
  }
  await Promise.all(items.map(async (item) => {
    let metadata: Awaited<ReturnType<typeof getObjectMetadata>>;
    try { metadata = await getObjectMetadata(item.r2Key); }
    catch { throw new InputError("attachment upload is missing or unavailable"); }
    if (metadata.ContentLength !== item.sizeBytes) throw new InputError("attachment size does not match uploaded object");
  }));
}
