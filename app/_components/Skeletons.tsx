export function PageProgressBar() {
  return <div className="route-progress" aria-hidden="true" />;
}

export function SkelLine({ w = "med" }: { w?: "short" | "med" | "long" }) {
  return <span className={`skeleton skeleton-line ${w}`} />;
}

export function TicketCardSkeleton() {
  return (
    <div className="tcard" style={{ borderLeftColor: "var(--line-strong)" }}>
      <div className="t-main">
        <span className="skeleton" style={{ height: "1.1rem", width: "55%", display: "block", marginBottom: "0.5rem" }} />
        <span className="skeleton skeleton-line med" />
      </div>
      <div className="t-side">
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <span className="skeleton" style={{ height: "1.2rem", width: "4rem" }} />
          <span className="skeleton skeleton-pill" />
        </div>
        <div style={{ display: "flex", gap: "0.4rem" }}>
          <span className="skeleton" style={{ height: "1.7rem", width: "4.2rem", borderRadius: 9999 }} />
          <span className="skeleton" style={{ height: "1.7rem", width: "3.8rem", borderRadius: 9999 }} />
        </div>
      </div>
    </div>
  );
}

export function TicketListSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="ticket-list">
      {Array.from({ length: count }).map((_, i) => (
        <TicketCardSkeleton key={i} />
      ))}
    </div>
  );
}

export function CardSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="card">
      <SkelLine w="short" />
      {Array.from({ length: lines }).map((_, i) => (
        <SkelLine key={i} w={i === lines - 1 ? "med" : "long"} />
      ))}
    </div>
  );
}

export function StatCardSkeleton({ accent }: { accent?: "pending" | "approved" | "cleared" | "rejected" }) {
  return (
    <div className={`card stat-card ${accent ? `accent-${accent}` : ""}`}>
      <span className="skeleton" style={{ height: "0.8rem", width: "5rem", display: "block", marginBottom: "0.6rem" }} />
      <span className="skeleton" style={{ height: "2rem", width: "3rem", display: "block", marginBottom: "0.5rem" }} />
      <span className="skeleton skeleton-line med" />
    </div>
  );
}
