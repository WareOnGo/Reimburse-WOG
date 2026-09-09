import { redirect } from "next/navigation";
import Image from "next/image";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

const ERROR_MESSAGES: Record<string, string> = {
  oauth_failed: "Could not complete sign-in. Please try again.",
  oauth_not_configured: "Google sign-in isn't configured yet.",
  missing_code: "Google sign-in was cancelled.",
  invalid_state: "Sign-in session expired. Please try again.",
  token_exchange_failed: "Could not complete Google sign-in.",
  no_access_token: "Could not complete Google sign-in.",
  userinfo_failed: "Could not read your Google profile.",
  email_not_verified: "Your Google email is not verified.",
  not_on_file: "No employee record on file for this email. Ask an admin to add you.",
  inactive: "Your account is inactive. Contact admin.",
  access_denied: "You declined the Google sign-in prompt.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  if (user) redirect(user.isAdmin ? "/admin" : "/dashboard");

  const sp = await searchParams;
  const rawErr = typeof sp.error === "string" ? sp.error : null;
  const email = typeof sp.email === "string" ? sp.email : null;
  const err = rawErr
    ? `${ERROR_MESSAGES[rawErr] ?? "Sign-in failed."}${email ? ` (${email})` : ""}`
    : null;

  return (
    <main className="auth-wrap">
      <div className="auth-card">
        <div className="auth-brand">
          <Image
            src="/wareongo-logo.webp"
            alt="WareOnGo"
            width={120}
            height={85}
            priority
            className="auth-logo"
          />
        </div>

        <h1 className="auth-title">Reimbursement Portal</h1>
        <p className="auth-sub">
          Sign in with your Google account to raise and track reimbursement tickets.
        </p>

        {err && (
          <div className="alert" style={{ borderColor: "var(--bad)", color: "var(--bad)" }}>
            {err}
          </div>
        )}

        <a href="/api/auth/google" className="btn btn-primary btn-block google-btn">
          <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"/>
            <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"/>
            <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"/>
            <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.571.001-.001.002-.001.003-.002l6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"/>
          </svg>
          Continue with Google
        </a>

        <p className="auth-hint">
          Only employees registered in the portal can sign in. If your account isn&apos;t recognised, contact an admin.
        </p>
      </div>
    </main>
  );
}
