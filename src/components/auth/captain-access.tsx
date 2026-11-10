"use client";
import Link from "next/link";
import { ShieldCheck, LogOut } from "lucide-react";
import { useAuth } from "./auth-provider";
import { usePrototype } from "../prototype-provider";
import type { ReactNode } from "react";
import { LeagueConnectionPanel } from "../league-connection";
export function CaptainAccess({ children }: { children: ReactNode }) {
  const auth = useAuth(),
    { setNotice } = usePrototype();
  if (auth.live) {
    if (!auth.configured)
      return (
        <div className="section page-section">
          <div className="access-panel">
            <ShieldCheck />
            <h1>Captain sign-in</h1>
            <p>Team sign-in is being connected. Please check back shortly.</p>
            <Link className="button secondary" href="/">
              Back to the club
            </Link>
          </div>
        </div>
      );
    if (auth.loading)
      return (
        <div className="section page-section" role="status">
          Checking captain access…
        </div>
      );
    if (!auth.user)
      return (
        <div className="section page-section">
          <div className="access-panel">
            <ShieldCheck />
            <h1>The captain’s corner.</h1>
            <p>
              Sign in with your invited email to manage the squad and publish
              results.
            </p>
            <Link href="/login/" className="button">
              Captain sign-in
            </Link>
          </div>
        </div>
      );
    if (!auth.captain)
      return (
        <div className="section page-section">
          <div className="access-panel">
            <ShieldCheck />
            <h1>You’re signed in.</h1>
            <p>
              Your account doesn’t have captain access for this club. Ask an
              existing captain to arrange an invitation.
            </p>
            <button
              className="button secondary"
              onClick={() =>
                void auth.signOut().catch((e) => setNotice(e.message))
              }
            >
              Sign out
            </button>
          </div>
        </div>
      );
  }
  return (
    <>
      <div className="section captain-navigation">
        <nav aria-label="Captain tools">
          <Link href="/captain/">Results</Link>
          <Link href="/captain/fixtures/">Fixtures</Link>
          <Link href="/captain/roster/">Roster</Link>
        </nav>
        {auth.live ? (
          <button
            className="text-link"
            onClick={() =>
              void auth.signOut().catch((e) => setNotice(e.message))
            }
          >
            <LogOut size={14} />
            Sign out
          </button>
        ) : (
          <Link className="text-link" href="/login/">
            <ShieldCheck size={14} />
            Captain sign-in
          </Link>
        )}
      </div>
      {auth.live && <LeagueConnectionPanel />}
      {children}
    </>
  );
}
