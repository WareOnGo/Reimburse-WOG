// Lightweight Resend email helper. Talks to the Resend HTTP API directly so we don't
// pull in an SDK. Every send is best-effort: a missing API key or a transport error is
// logged and the promise resolves `false` — it never throws — so request handlers can
// notify users without risking the main response.

const RESEND_ENDPOINT = "https://api.resend.com/emails";

function fmtINR(n: number): string {
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

type SendArgs = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

/** Sends one email via Resend. Returns true on a 2xx, false otherwise (never throws). */
export async function sendEmail({ to, subject, html, text }: SendArgs): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  if (!apiKey || !from) {
    console.warn(`[email] RESEND_API_KEY/RESEND_FROM not configured — skipping send to ${to}`);
    return false;
  }
  if (!to) return false;

  const replyTo = process.env.RESEND_REPLY_TO;
  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from,
        to,
        subject,
        html,
        text,
        ...(replyTo ? { reply_to: replyTo } : {}),
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[email] Resend responded ${res.status} for ${to}: ${body}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[email] send failed:", err);
    return false;
  }
}

export type PartialApprovalEmail = {
  to: string;
  name: string;
  shortCode: string;
  title: string;
  requestedAmount: number;
  approvedAmount: number;
};

/** Builds and sends the "your reimbursement was partially approved" notification. */
export async function sendPartialApprovalEmail(d: PartialApprovalEmail): Promise<boolean> {
  const requested = fmtINR(d.requestedAmount);
  const approved = fmtINR(d.approvedAmount);
  const notApproved = fmtINR(Math.max(0, d.requestedAmount - d.approvedAmount));
  const subject = `Reimbursement ${d.shortCode} partially approved — ${approved}`;

  const base = (process.env.APP_BASE_URL ?? "").replace(/\/$/, "");
  const link = base ? `${base}/dashboard` : "";

  const text = [
    `Hi ${d.name},`,
    ``,
    `Your reimbursement request ${d.shortCode} ("${d.title}") has been partially approved by Finance.`,
    ``,
    `Requested:      ${requested}`,
    `Approved:       ${approved}`,
    `Not approved:   ${notApproved}`,
    ``,
    link ? `View details: ${link}` : ``,
    ``,
    `— Wareongo Reimbursements`,
  ]
    .filter((l) => l !== undefined)
    .join("\n");

  const html = `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0a2239;max-width:520px;margin:0 auto;padding:8px">
    <p style="font-size:15px;margin:0 0 12px">Hi ${escapeHtml(d.name)},</p>
    <p style="font-size:15px;line-height:1.5;margin:0 0 16px">
      Your reimbursement request <strong>${escapeHtml(d.shortCode)}</strong>
      (&ldquo;${escapeHtml(d.title)}&rdquo;) has been
      <strong>partially approved</strong> by Finance.
    </p>
    <table style="border-collapse:collapse;font-size:14px;margin:0 0 18px">
      <tr>
        <td style="padding:4px 16px 4px 0;color:#6c757d">Requested</td>
        <td style="padding:4px 0;font-weight:700">${requested}</td>
      </tr>
      <tr>
        <td style="padding:4px 16px 4px 0;color:#6c757d">Approved</td>
        <td style="padding:4px 0;font-weight:700;color:#1d6fc4">${approved}</td>
      </tr>
      <tr>
        <td style="padding:4px 16px 4px 0;color:#6c757d">Not approved</td>
        <td style="padding:4px 0;font-weight:700;color:#b32d2d">${notApproved}</td>
      </tr>
    </table>
    ${
      link
        ? `<p style="margin:0 0 18px"><a href="${link}" style="display:inline-block;background:#0a2239;color:#fff;text-decoration:none;padding:9px 16px;border-radius:6px;font-size:14px">View in portal</a></p>`
        : ""
    }
    <p style="font-size:13px;color:#6c757d;margin:0">&mdash; Wareongo Reimbursements</p>
  </div>`;

  return sendEmail({ to: d.to, subject, html, text });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
