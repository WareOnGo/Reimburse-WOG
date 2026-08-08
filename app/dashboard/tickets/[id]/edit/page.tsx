import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import TicketForm from "@/app/_components/TicketForm";

export const dynamic = "force-dynamic";

function fmtBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

export default async function EditTicketPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;

  const ticket = await prisma.ticket.findFirst({
    where: { OR: [{ id }, { shortCode: id }] },
    relationLoadStrategy: "join",
    include: { attachments: { orderBy: { createdAt: "asc" } } },
  });
  if (!ticket) notFound();
  if (ticket.submittedByEmpID !== user.empID) notFound();

  const status = ticket.status.toLowerCase();
  if (ticket.status !== "PENDING" && ticket.status !== "REVIEW") {
    return (
      <>
        <div style={{ marginBottom: "0.5rem" }}>
          <Link href={`/dashboard/tickets/${ticket.shortCode}`}>← Back to ticket</Link>
        </div>
        <div className="card">
          <h2>Cannot edit</h2>
          <p>Ticket <strong>#{ticket.shortCode}</strong> is <strong>{status}</strong> and can no longer be edited.</p>
        </div>
      </>
    );
  }

  return (
    <>
      <div style={{ marginBottom: "0.5rem" }}>
        <Link href={`/dashboard/tickets/${ticket.shortCode}`}>← Back to ticket</Link>
      </div>
      <div className="page-head">
        <div>
          <h1>Edit ticket #{ticket.shortCode}</h1>
          <div className="sub">Update details and resubmit for review.</div>
        </div>
      </div>
      <div className="card">
        <TicketForm
          mode="edit"
          ticketId={ticket.shortCode}
          initial={{
            title: ticket.title,
            category: ticket.category,
            amount: String(Number(ticket.amount)),
            description: ticket.description,
            expenseDate: ticket.expenseDate ? ticket.expenseDate.toISOString().slice(0, 10) : "",
            dealName: ticket.dealName ?? "",
            clientName: ticket.clientName ?? "",
            existingAttachments: ticket.attachments.map((a) => ({
              id: a.id,
              name: a.name,
              sizeLabel: fmtBytes(a.sizeBytes),
            })),
          }}
        />
      </div>
    </>
  );
}
