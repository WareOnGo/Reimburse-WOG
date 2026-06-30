import { PageProgressBar, TicketListSkeleton, StatCardSkeleton } from "@/app/_components/Skeletons";

export default function Loading() {
  return (
    <>
      <PageProgressBar />
      <div className="page-head">
        <div>
          <h1>Welcome back</h1>
          <div className="sub">Loading your reimbursement summary…</div>
        </div>
      </div>

      <div className="stat-grid" style={{ marginBottom: "1.5rem" }}>
        <StatCardSkeleton accent="pending" />
        <StatCardSkeleton accent="approved" />
        <StatCardSkeleton accent="cleared" />
      </div>

      <div className="section-label" style={{ marginTop: 0 }}>Recent activity</div>
      <TicketListSkeleton count={3} />
    </>
  );
}
