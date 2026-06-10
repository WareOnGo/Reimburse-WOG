import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { getDownloadUrl } from "@/lib/r2";
import CancelTicketButton from "@/app/_components/CancelTicketButton";
import AttachmentLink from "@/app/_components/AttachmentLink";
import { IconEdit } from "@/app/_components/Icons";

export const dynamic = "force-dynamic";

function fmtDateTime(d: Date): string {
  return d.toISOString().replace("T", " ").slice(0, 16);
}

function fmtBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

const STATUS_DESCRIPTION: Record<string, string> = {
  PENDING: "Awaiting review by Finance.",
  REVIEW: "Under review by Finance.",
  APPROVED: "Approved — scheduled for reimbursement.",
  CLEARED: "Cleared — reimbursement has been disbursed.",
  REJECTED: "Rejected — see timeline for the reason.",
  CANCELLED: "Cancelled — no further action will be taken.",
};

export default async function TicketDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;

  const ticket = await prisma.ticket.findFirst({
    where: { OR: [{ id }, { shortCode: id }] },
    relationLoadStrategy: "join",
    include: {
      attachments: { orderBy: { createdAt: "asc" } },
      events: { orderBy: { createdAt: "asc" } },
      submittedBy: {
        include: { verifiedNumber: { select: { email: true, name: true } } },
      },
    },
  });
  if (!ticket) notFound();
  if (ticket.submittedByEmpID !== user.empID && !user.isAdmin) notFound();

  // Pre-sign attachment URLs server-side so previews render immediately (no per-tile fetch).
  // 10-minute expiry comfortably covers a normal page session.
  const attachmentsWithUrls = await Promise.all(
    ticket.attachments.map(async (a) => ({
      ...a,
      previewUrl: await getDownloadUrl(a.r2Key, 600),
    })),
  );
  const images = attachmentsWithUrls.filter((a) => a.kind === "IMAGE");
  const docs = attachmentsWithUrls.filter((a) => a.kind === "DOCUMENT");
  const canModify = ticket.status === "PENDING" || ticket.status === "REVIEW";
  const isOwner = ticket.submittedByEmpID === user.empID;
  const status = ticket.status.toLowerCase();
  const requestedAmount = Number(ticket.amount);
  const approvedAmount = ticket.approvedAmount != null ? Number(ticket.approvedAmount) : null;
  const isPartial =
    (ticket.status === "APPROVED" || ticket.status === "CLEARED") &&
    approvedAmount != null &&
    approvedAmount < requestedAmount;
  const submitterLabel =
    ticket.submittedBy.verifiedNumber?.email ?? ticket.submittedByEmpID;

  return (
    <>
      <div style={{ marginBottom: "0.5rem" }}>
        <Link href="/dashboard" style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem", fontSize: "0.88rem" }}>
          ← Back to dashboard
        </Link>
      </div>

      <div className={`tcard accent-${status}`} style={{ marginBottom: "1.25rem", padding: "1.25rem 1.5rem" }}>
        <div className="t-main">
          <div className="t-title-row">
            <h1 style={{ margin: 0, fontSize: "1.4rem" }}>{ticket.title}</h1>
            <span className="t-code">{ticket.shortCode}</span>
          </div>
          <div className="t-meta" style={{ marginTop: "0.2rem" }}>
            {ticket.category}<span className="sep">·</span>Submitted {fmtDateTime(ticket.createdAt)}
          </div>
          <div style={{ marginTop: "0.6rem", display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
            <span className={`badge badge-${status}`}>{status}</span>
            <span style={{ color: "var(--slate)", fontSize: "0.85rem" }}>
              {STATUS_DESCRIPTION[ticket.status]}
            </span>
          </div>
        </div>
        <div className="t-side">
          {isPartial ? (
            <span className="t-amount" style={{ fontSize: "1.4rem", color: "var(--info)" }}>
              ₹{approvedAmount!.toLocaleString("en-IN")}
              <span style={{ color: "var(--slate)", fontWeight: 400, fontSize: "0.9rem", marginLeft: "0.35rem" }}>
                of ₹{requestedAmount.toLocaleString("en-IN")}
              </span>
            </span>
          ) : (
            <span className="t-amount" style={{ fontSize: "1.4rem" }}>
              ₹{requestedAmount.toLocaleString("en-IN")}
            </span>
          )}
          {canModify && isOwner && (
            <div className="t-actions">
              <Link
                href={`/dashboard/tickets/${ticket.shortCode}/edit`}
                className="icon-btn"
              >
                <IconEdit /> Edit
              </Link>
              <CancelTicketButton ticketId={ticket.shortCode} redirectTo="/dashboard" />
            </div>
          )}
        </div>
      </div>

      <div className="detail-grid">
        <div>
          <div className="card">
            <h2>Details</h2>
            <dl className="detail-list">
              <div><dt>Amount</dt><dd>₹{requestedAmount.toLocaleString("en-IN")}</dd></div>
              {isPartial && (
                <div>
                  <dt>Approved</dt>
                  <dd style={{ color: "var(--info)", fontWeight: 700 }}>
                    ₹{approvedAmount!.toLocaleString("en-IN")}{" "}
                    <span style={{ color: "var(--slate)", fontWeight: 400, fontSize: "0.85rem" }}>
                      of ₹{requestedAmount.toLocaleString("en-IN")}
                    </span>
                  </dd>
                </div>
              )}
              <div><dt>Category</dt><dd>{ticket.category}</dd></div>
              <div><dt>Submitted by</dt><dd>{submitterLabel}</dd></div>
              <div><dt>Submitted on</dt><dd>{fmtDateTime(ticket.createdAt)}</dd></div>
              <div><dt>Status</dt><dd><span className={`badge badge-${status}`}>{status}</span></dd></div>
            </dl>
            <h3 style={{ marginTop: "1rem" }}>Description</h3>
            <p style={{ color: "var(--ink)" }}>{ticket.description}</p>
          </div>

          {images.length > 0 && (
            <div className="card" style={{ marginTop: "1rem" }}>
              <h2>Media ({images.length})</h2>
              <div className="media-grid">
                {images.map((a) => (
                  <AttachmentLink
                    key={a.id}
                    id={a.id}
                    name={a.name}
                    sizeLabel={fmtBytes(a.sizeBytes)}
                    kind="IMAGE"
                    previewUrl={a.previewUrl}
                  />
                ))}
              </div>
            </div>
          )}

          {docs.length > 0 && (
            <div className="card" style={{ marginTop: "1rem" }}>
              <h2>Documents ({docs.length})</h2>
              <div className="media-grid">
                {docs.map((a) => (
                  <AttachmentLink
                    key={a.id}
                    id={a.id}
                    name={a.name}
                    sizeLabel={fmtBytes(a.sizeBytes)}
                    kind="DOCUMENT"
                    previewUrl={a.previewUrl}
                  />
                ))}
              </div>
            </div>
          )}

          {ticket.attachments.length === 0 && (
            <div className="card" style={{ marginTop: "1rem", textAlign: "center", color: "var(--slate)" }}>
              No attachments on this ticket.
            </div>
          )}
        </div>

        <aside>
          <div className="card">
            <h2>Timeline</h2>
            <ul className="timeline">
              {ticket.events.map((e) => (
                <li key={e.id}>
                  <span className="time">{fmtDateTime(e.createdAt)}</span>
                  <span className="label">{e.label}</span>
                </li>
              ))}
            </ul>
          </div>
          {!canModify && (
            <div className="card" style={{ marginTop: "1rem" }}>
              <h3>Why can't I edit this?</h3>
              <p style={{ margin: 0, color: "var(--slate)" }}>
                Tickets can only be edited or cancelled while they're <strong>pending</strong> or <strong>under review</strong>.
                This ticket is now <strong>{status}</strong>.
              </p>
            </div>
          )}
        </aside>
      </div>
    </>
  );
}
