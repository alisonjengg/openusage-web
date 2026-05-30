"use client";

import { useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";

export default function Nav() {
  const router = useRouter();
  const path = usePathname();
  const [open, setOpen] = useState(false);

  async function logout() {
    setOpen(false);
    await fetch("/api/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="nav">
      <Link className="brand" href="/" onClick={() => setOpen(false)}>
        openusage
      </Link>
      <nav className="nav-links">
        <Link href="/" className={path === "/" ? "active" : undefined}>
          Dashboard
        </Link>
        <Link
          href="/accounts"
          className={path === "/accounts" ? "active" : undefined}
        >
          Accounts
        </Link>
        <button type="button" onClick={logout}>
          Sign out
        </button>
      </nav>
      <div className="nav-menu">
        <button
          type="button"
          className="icon-btn menu-btn"
          aria-label="Open navigation menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span />
          <span />
          <span />
        </button>
        {open && (
          <nav className="menu-panel">
            <Link
              href="/"
              className={path === "/" ? "active" : undefined}
              onClick={() => setOpen(false)}
            >
              Dashboard
            </Link>
            <Link
              href="/accounts"
              className={path === "/accounts" ? "active" : undefined}
              onClick={() => setOpen(false)}
            >
              Accounts
            </Link>
            <button type="button" onClick={logout}>
              Sign out
            </button>
          </nav>
        )}
      </div>
    </header>
  );
}
