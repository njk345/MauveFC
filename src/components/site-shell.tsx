"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  FlaskConical,
  Menu,
  RotateCcw,
  ShieldCheck,
  X,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { Modal } from "./modal";
import { Crest } from "./brand";
import { usePrototype } from "./prototype-provider";
const nav = [
  ["Home", "/"],
  ["Schedule", "/schedule/"],
  ["Results", "/results/"],
  ["Players", "/players/"],
  ["Stats", "/stats/"],
];
export function SiteShell({ children }: { children: ReactNode }) {
  const pathname = usePathname(),
    {
      seasonId,
      setSeasonId,
      reset,
      notice,
      seasons,
      live,
      ready,
      loadError,
      refresh,
    } = usePrototype();
  const [menu, setMenu] = useState(false),
    [confirm, setConfirm] = useState(false);
  return (
    <>
      <div className="sample-strip">
        <span>
          <FlaskConical size={13} /> THE CLUB, IN PROGRESS{" "}
          <span className="strip-divider">/</span>{" "}
          <span>
            {live
              ? "Mauve FC · Club football"
              : "Interactive prototype · fictional sample data"}
          </span>
        </span>
        {!live && (
          <button onClick={() => setConfirm(true)}>
            <RotateCcw size={12} /> Reset demo
          </button>
        )}
      </div>
      <header className="site-header">
        <div className="header-inner">
          <Link href="/" className="wordmark" onClick={() => setMenu(false)}>
            <Crest small />
            <span>
              MAUVE<span className="wordmark-fc"> FC</span>
              <small>BROOKLYN, NEW YORK</small>
            </span>
          </Link>
          <nav className="desktop-nav" aria-label="Main navigation">
            {nav.map(([label, href]) => (
              <Link
                key={href}
                href={href}
                className={
                  pathname === href || pathname === href.slice(0, -1)
                    ? "active"
                    : ""
                }
              >
                {label}
              </Link>
            ))}
          </nav>
          <div className="header-actions">
            <label className="season-select">
              <span className="sr-only">Season</span>
              <select
                aria-label="Season"
                value={seasonId}
                onChange={(e) => setSeasonId(e.target.value)}
              >
                {seasons.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <ChevronDown size={13} />
            </label>
            <Link
              href="/captain/"
              className={`captain-link ${pathname.includes("captain") ? "active" : ""}`}
            >
              <ShieldCheck size={15} />
              <span>Captain’s area</span>
              <ArrowUpRight size={14} />
            </Link>
            <button
              className="menu-button icon-button"
              aria-label={menu ? "Close navigation" : "Open navigation"}
              aria-expanded={menu}
              onClick={() => setMenu(!menu)}
            >
              {menu ? <X /> : <Menu />}
            </button>
          </div>
        </div>
        {menu && (
          <nav className="mobile-nav" aria-label="Mobile navigation">
            {nav.map(([label, href]) => (
              <Link onClick={() => setMenu(false)} key={href} href={href}>
                {label}
                <ArrowUpRight size={17} />
              </Link>
            ))}
            <Link onClick={() => setMenu(false)} href="/captain/">
              Captain’s area <ShieldCheck size={17} />
            </Link>
          </nav>
        )}
      </header>
      <main id="main-content">
        {live &&
        pathname !== "/login/" &&
        pathname !== "/login" &&
        (!ready || loadError || !seasons.length) ? (
          <div className="section page-section">
            <div className="access-panel" role="status">
              <h1>
                {!ready
                  ? "Loading the club…"
                  : loadError
                    ? "We couldn’t load the club."
                    : "A new season awaits."}
              </h1>
              <p>
                {loadError ||
                  (!ready
                    ? "One moment, please."
                    : "Your captain is preparing the first season.")}
              </p>
              {loadError && (
                <button
                  className="button"
                  onClick={() => void refresh().catch(() => {})}
                >
                  Try again
                </button>
              )}
            </div>
          </div>
        ) : (
          children
        )}
      </main>
      <footer>
        <div className="footer-main">
          <Link href="/" className="footer-brand">
            <Crest small />
            <span>
              THURSDAY NIGHTS.
              <br />
              MAUVE FOREVER.
            </span>
          </Link>
          <p>
            A club for the love of the game.
            <br />
            Made in Brooklyn. Best enjoyed together.
          </p>
          <div className="footer-links">
            <a
              href="https://www.nycsoccer.com/"
              target="_blank"
              rel="noreferrer"
            >
              Our league <ArrowUpRight size={14} />
            </a>
            <Link href="/captain/">
              Captain’s area <ArrowUpRight size={14} />
            </Link>
          </div>
        </div>
        <div className="footer-bottom">
          <span>© 2026 Mauve FC{!live && " · Sample-data prototype"}</span>
          <span>
            {live
              ? "For the love of the game."
              : "All players, fixtures & statistics are fictional."}
          </span>
          <span className="footer-dot">
            BROOKLYN, NY <span>●</span>
          </span>
        </div>
      </footer>
      {notice && (
        <div className="toast" role="status">
          <Check size={18} />
          {notice}
        </div>
      )}
      {confirm && (
        <Modal onClose={() => setConfirm(false)}>
          <section
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reset-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              autoFocus
              className="dialog-close icon-button"
              aria-label="Close reset dialog"
              onClick={() => setConfirm(false)}
            >
              <X />
            </button>
            <RotateCcw size={28} />
            <h2 id="reset-title">A fresh kickoff?</h2>
            <p>
              This clears your saved sample edits and restores the original demo
              season.
            </p>
            <div className="button-row">
              <button
                className="button secondary"
                onClick={() => setConfirm(false)}
              >
                Keep my edits
              </button>
              <button
                className="button"
                onClick={() => {
                  reset();
                  setConfirm(false);
                }}
              >
                Reset demo
              </button>
            </div>
          </section>
        </Modal>
      )}
    </>
  );
}
