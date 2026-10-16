import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { InputError } from "@/lib/validation";
import { ticketExportRange } from "@/lib/ticket-export";
import { ticketExportPreview, ticketExportStream } from "@/lib/ticket-export-data";

export const runtime = "nodejs";
export const maxDuration = 300;
const headers = { "Cache-Control": "private, no-store" };

async function handle(req: Request, head: boolean) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers });
  if (!user.isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403, headers });

  try {
    const params = new URL(req.url).searchParams;
    const format = params.get("format") ?? "csv";
    if (format !== "csv" && format !== "preview") throw new InputError("Invalid export format.");
    const range = ticketExportRange(params);
    if (format === "preview") {
      return head ? new Response(null, { headers }) : NextResponse.json(await ticketExportPreview(range), { headers });
    }

    const from = params.get("from") || "all";
    const to = params.get("to") || "latest";
    return new Response(head ? null : await ticketExportStream(range, req.signal), {
      headers: {
        ...headers,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="ticket-history_${from}_${to}.csv"`,
        "X-Content-Type-Options": "nosniff",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    if (error instanceof InputError) return NextResponse.json({ error: error.message }, { status: 400, headers });
    throw error;
  }
}

export async function GET(req: Request) { return handle(req, false); }
// Cheap authorization/validation before handing the GET to the browser's native
// download manager. Never generate or buffer the CSV during a HEAD request.
export async function HEAD(req: Request) { return handle(req, true); }
