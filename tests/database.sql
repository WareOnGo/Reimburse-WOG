-- Minimal disposable fixture, never applied to the shared database.
CREATE TYPE "TicketStatus" AS ENUM ('PENDING', 'REVIEW', 'APPROVED', 'CLEARED', 'REJECTED', 'CANCELLED');
CREATE TYPE "AttachmentKind" AS ENUM ('IMAGE', 'DOCUMENT');
CREATE TABLE "VerifiedNumber" (
  id SERIAL PRIMARY KEY, phone_number TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true, created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  email TEXT UNIQUE, "empID" TEXT UNIQUE
);
CREATE TABLE "Employee" (
  "empID" TEXT PRIMARY KEY REFERENCES "VerifiedNumber"("empID"),
  role TEXT NOT NULL DEFAULT 'EMPLOYEE', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "Ticket" (
  id TEXT PRIMARY KEY, "shortCode" TEXT UNIQUE NOT NULL, title TEXT NOT NULL,
  category TEXT NOT NULL, amount DECIMAL(12,2) NOT NULL, description TEXT NOT NULL,
  status "TicketStatus" NOT NULL DEFAULT 'PENDING', "submittedByEmpID" TEXT NOT NULL REFERENCES "Employee"("empID"),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  "approvedAmount" DECIMAL(12,2), "expenseDate" DATE, "dealName" TEXT, "clientName" TEXT
);
CREATE TABLE "Attachment" (
  id TEXT PRIMARY KEY, "ticketId" TEXT NOT NULL REFERENCES "Ticket"(id) ON DELETE CASCADE,
  name TEXT NOT NULL, kind "AttachmentKind" NOT NULL, "contentType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL, "r2Key" TEXT UNIQUE NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "TicketEvent" (
  id TEXT PRIMARY KEY, "ticketId" TEXT NOT NULL REFERENCES "Ticket"(id) ON DELETE CASCADE,
  label TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "VerifiedNumber" (phone_number, name, email, "empID") VALUES
  ('10001', 'Test Employee', 'employee@example.test', 'EMP-1'),
  ('10002', 'Test Finance', 'finance@example.test', 'FIN-1'),
  ('10003', 'Other Employee', 'other@example.test', 'EMP-2');
INSERT INTO "Employee" ("empID") VALUES ('EMP-1'), ('FIN-1'), ('EMP-2');
