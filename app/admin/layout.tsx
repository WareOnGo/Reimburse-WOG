import Link from "next/link";
import UserMenu from "../_components/UserMenu";
import Brand from "../_components/Brand";
import { requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAdmin();

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="inner">
          <Brand href="/admin" subtitle="Admin" />
          <nav className="nav">
            <Link href="/admin" className="nav-link active">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 3l8 3v6c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V6l8-3z" />
              </svg>
              <span>Review</span>
            </Link>
            <Link href="/dashboard" className="nav-link">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 12L12 4l9 8" />
                <path d="M5 10v10h14V10" />
              </svg>
              <span>Employee view</span>
            </Link>
          </nav>
          <div className="nav-end">
            <UserMenu
              name={user.name}
              empID={user.empID}
              email={user.email}
              isAdmin={user.isAdmin}
            />
          </div>
        </div>
      </header>
      <main className="app-main">{children}</main>
      <footer className="app-footer">© {new Date().getFullYear()} Reimbursement Portal</footer>
    </div>
  );
}
