"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowUpRight, Check, Download, Share, Smartphone } from "lucide-react";
import { useInstall, type InstallPlatform } from "./install-provider";
import { PageHeading } from "./season-pages";

export function InstallPage() {
  const { installed, platform, available, busy, message, install } =
    useInstall();
  const [selected, setSelected] = useState<InstallPlatform>(platform);
  useEffect(() => setSelected(platform), [platform]);
  return (
    <div className="section page-section install-page">
      <PageHeading
        eyebrow="MAUVE FC / ON YOUR HOME SCREEN"
        title="Your club. One tap away."
        description="Keep the next match, your RSVP, and the match plan close. Add Mauve FC to your phone or computer."
      />
      <div className="install-grid">
        <aside className="install-preview">
          <img
            src="/icons/icon-192.png"
            width={96}
            height={96}
            alt="Mauve FC app icon"
          />
          <h2>Mauve FC</h2>
          <span className="eyebrow">THURSDAY NIGHTS. MAUVE FOREVER.</span>
          <p>A little club football on your home screen.</p>
          <ul>
            <li>
              <Check size={16} />
              Opens straight into the Team area
            </li>
            <li>
              <Check size={16} />
              Your fixtures, RSVPs and lineups
            </li>
            <li>
              <Check size={16} />
              Same invited account and sign-in
            </li>
          </ul>
          <p className="help-text">
            An internet connection is needed for fixtures and team tools.
            Private areas still require your invited account.
          </p>
        </aside>
        <section
          className="install-instructions"
          aria-labelledby="install-title"
        >
          {installed ? (
            <>
              <span className="install-ready">
                <Check size={18} />
                READY FOR KICKOFF
              </span>
              <h2 id="install-title">You’re all set.</h2>
              <p>
                Open Mauve FC from your home screen or apps. Your team is just a
                tap away.
              </p>
              <Link className="button" href="/team/">
                Open Team area <ArrowUpRight size={16} />
              </Link>
            </>
          ) : (
            <>
              <span className="eyebrow">
                <Smartphone size={16} /> TAKE THE CLUB WITH YOU
              </span>
              <h2 id="install-title">Add Mauve FC.</h2>
              {available && (
                <div className="install-native">
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() => void install()}
                  >
                    <Download size={16} />
                    {busy ? "Opening installer…" : "Install Mauve FC"}
                  </button>
                  <p className="help-text">
                    Your browser will ask before adding the app.
                  </p>
                </div>
              )}
              <div
                className="tabs install-tabs"
                aria-label="Installation device"
              >
                {(
                  [
                    ["ios", "iPhone / iPad"],
                    ["android", "Android"],
                    ["desktop", "Computer"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    className={selected === id ? "selected" : ""}
                    aria-pressed={selected === id}
                    onClick={() => setSelected(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {selected === "ios" ? (
                <ol className="install-steps">
                  <li>
                    <strong>Open Mauve FC in Safari.</strong>
                    <span>
                      If you’re in a chat app’s browser, use its menu to open
                      this site in Safari first.
                    </span>
                  </li>
                  <li>
                    <strong>
                      Tap Share <Share size={16} aria-label="Share icon" />.
                    </strong>
                    <span>
                      Find Share in Safari’s toolbar or menu, then choose{" "}
                      <b>Add to Home Screen</b>. You may need to scroll through
                      the actions.
                    </span>
                  </li>
                  <li>
                    <strong>Keep “Open as Web App” on, if shown.</strong>
                    <span>
                      Tap <b>Add</b>. Look for the Mauve FC crest on your home
                      screen.
                    </span>
                  </li>
                </ol>
              ) : selected === "android" ? (
                <ol className="install-steps">
                  <li>
                    <strong>Open Mauve FC in Chrome.</strong>
                    <span>
                      Use the full browser rather than a chat app’s built-in
                      browser.
                    </span>
                  </li>
                  <li>
                    <strong>Open the three-dot menu.</strong>
                    <span>
                      Choose <b>Add to Home screen</b> or <b>Install app</b>. If
                      the Install Mauve FC button appears above, you can use
                      that instead.
                    </span>
                  </li>
                  <li>
                    <strong>Confirm Install or Add.</strong>
                    <span>
                      Launch Mauve FC from its crest on your home screen or app
                      list.
                    </span>
                  </li>
                </ol>
              ) : (
                <ol className="install-steps">
                  <li>
                    <strong>Open Mauve FC in Chrome, Edge or Safari.</strong>
                    <span>
                      Installation options depend on your browser and operating
                      system.
                    </span>
                  </li>
                  <li>
                    <strong>Use your browser’s install option.</strong>
                    <span>
                      In Chrome or Edge, look for the install icon in the
                      address bar or the browser menu. In Safari on Mac, choose{" "}
                      <b>File → Add to Dock</b>, when available.
                    </span>
                  </li>
                  <li>
                    <strong>Confirm, then open Mauve FC from your apps.</strong>
                    <span>
                      If your browser has no install option, bookmark the Team
                      area for quick access.
                    </span>
                  </li>
                </ol>
              )}
              <Link className="text-link" href="/team/">
                Go to the Team area <ArrowUpRight size={14} />
              </Link>
            </>
          )}
          {message && (
            <p className="install-status" role="status">
              {message}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
