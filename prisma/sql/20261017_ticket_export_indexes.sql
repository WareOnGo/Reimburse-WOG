-- Additive rollout only. Run with psql -f using a direct database connection.
-- Do not wrap in a transaction: CREATE INDEX CONCURRENTLY must run separately.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Ticket_createdAt_id_idx"
  ON "Ticket" ("createdAt", id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "TicketEvent_ticketId_createdAt_id_idx"
  ON "TicketEvent" ("ticketId", "createdAt", id);

-- Keep this predicate identical to ticketExportCandidates in lib/ticket-export-data.ts.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "TicketEvent_export_milestone_date_idx"
  ON "TicketEvent" ("createdAt", "ticketId")
  WHERE label = 'Approved by Finance' OR label = 'Cleared by Finance'
    OR label LIKE 'Partially approved by Finance (%';

ANALYZE "Ticket";
ANALYZE "TicketEvent";
