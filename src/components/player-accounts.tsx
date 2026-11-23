"use client";
import { useEffect, useState } from "react";
import { Copy, KeyRound, Link2, UserCheck } from "lucide-react";
import { useAuth } from "./auth/auth-provider";
import { usePrototype } from "./prototype-provider";
import { PageHeading } from "./season-pages";
import {
  createPlayerInvite,
  readPlayerAccounts,
  revokePlayerAccess,
  linkCaptainProfile,
} from "@/lib/supabase/repository";
import type { PlayerAccount } from "@/lib/types";
export function PlayerAccounts() {
  const auth = useAuth(),
    { players, live, setNotice, refresh: refreshClub } = usePrototype(),
    [accounts, setAccounts] = useState<PlayerAccount[]>([]),
    [selected, setSelected] = useState(""),
    [email, setEmail] = useState(""),
    [ownProfile, setOwnProfile] = useState(auth.playerId || ""),
    [link, setLink] = useState(""),
    [existingAccount, setExistingAccount] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [loaded, setLoaded] = useState(false);
  async function refresh() {
    const next = await readPlayerAccounts();
    setAccounts(next);
    setLoaded(true);
  }
  useEffect(() => {
    if (!live) return;
    let active = true;
    void readPlayerAccounts()
      .then((next) => {
        if (active) {
          setAccounts(next);
          setLoaded(true);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [live]);
  function choose(id: string) {
    setSelected(id);
    setEmail(
      accounts.find((a) => a.playerId === id)?.email ||
        players.find((p) => p.id === id)?.captainDetails?.email ||
        "",
    );
    setLink("");
    setError("");
  }
  async function invite(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setBusy(true);
    setError("");
    setLink("");
    try {
      const data = await createPlayerInvite(selected, email);
      setLink(data.link);
      setExistingAccount(
        Boolean((data as { existingAccount?: boolean }).existingAccount),
      );
      await Promise.all([refresh(), refreshClub()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create invite.");
    } finally {
      setBusy(false);
    }
  }
  async function revoke(id: string) {
    if (
      !window.confirm(
        "Revoke this player’s team access and cancel pending invitations? Their roster profile, stats and RSVP history will remain.",
      )
    )
      return;
    setBusy(true);
    setError("");
    setLink("");
    try {
      await revokePlayerAccess(id);
      await refresh();
      setNotice("Player access revoked.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not revoke access.");
    } finally {
      setBusy(false);
    }
  }
  async function linkSelf() {
    if (!ownProfile) return;
    setBusy(true);
    setError("");
    try {
      await linkCaptainProfile(ownProfile);
      await auth.refreshAccess();
      await refresh();
      setNotice("Your captain account is linked to your player profile.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not link profile.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="section page-section account-management">
      <PageHeading
        eyebrow="CAPTAIN / PLAYER ACCOUNTS"
        title="Bring the squad inside."
        description="Invite each player to their own account. Their team membership is separate from their public profile."
      />
      {!live ? (
        <div className="team-empty">
          <h2>Player accounts need live sign-in.</h2>
          <p>Real invitations are only available in the connected club.</p>
        </div>
      ) : (
        <>
          <div className="account-grid">
            <section className="management-form">
              <KeyRound size={25} />
              <h2>A private invitation.</h2>
              <p className="account-intro">
                Choose the player and their email. Copy the invitation and share
                it directly with that person. No email is sent automatically.
              </p>
              <form className="account-form" onSubmit={invite}>
                <label className="form-field">
                  <span>Player</span>
                  <select
                    required
                    value={selected}
                    onChange={(e) => choose(e.target.value)}
                  >
                    <option value="">Choose a player</option>
                    {players.map((p) => (
                      <option value={p.id} key={p.id}>
                        #{p.number} {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="form-field">
                  <span>Player email</span>
                  <input
                    type="email"
                    required
                    autoComplete="off"
                    maxLength={254}
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      setLink("");
                    }}
                  />
                </label>
                <p className="help-text">
                  The invitation email is saved to this player’s captain-only
                  contact details. Existing accounts keep their sign-in email.
                </p>
                <button
                  className="button"
                  disabled={busy || !loaded || !selected}
                >
                  {busy
                    ? "Creating…"
                    : accounts.find((a) => a.playerId === selected)?.status ===
                        "active"
                      ? "Create recovery link"
                      : "Create private invite"}
                  <Link2 size={15} />
                </button>
              </form>
              {link && (
                <div className="invite-result" role="status">
                  <h3>
                    {existingAccount
                      ? "Account already exists"
                      : "Your private link is ready"}
                  </h3>
                  <p>
                    {existingAccount
                      ? "This player should sign in with their existing account. This invitation does not reset their password."
                      : "The player opens this once, accepts the invitation and chooses a password. Share it privately; the sign-in link expires according to your Auth settings."}
                  </p>
                  <label className="form-field">
                    <span>Private invitation link</span>
                    <input
                      readOnly
                      value={link}
                      onFocus={(e) => e.target.select()}
                    />
                  </label>
                  <button
                    className="button secondary small"
                    onClick={() =>
                      void navigator.clipboard
                        .writeText(link)
                        .then(() =>
                          setNotice("Private invitation link copied."),
                        )
                        .catch(() =>
                          setError(
                            "Copy is unavailable. Select and copy the link above.",
                          ),
                        )
                    }
                  >
                    <Copy size={14} />
                    Copy link
                  </button>
                </div>
              )}
            </section>
            <section className="management-form">
              <UserCheck size={25} />
              <h2>Your place on the roster.</h2>
              <p className="account-intro">
                Link your captain account to yourself so you can RSVP without a
                second account.
              </p>
              <div className="account-form">
                <label className="form-field">
                  <span>Your roster profile</span>
                  <select
                    value={ownProfile}
                    onChange={(e) => setOwnProfile(e.target.value)}
                  >
                    <option value="">Choose your name</option>
                    {players.map((p) => (
                      <option value={p.id} key={p.id}>
                        #{p.number} {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="button secondary"
                  disabled={busy || !ownProfile}
                  onClick={() => void linkSelf()}
                >
                  Link my profile
                </button>
                <p className="help-text">
                  Only choose your own profile. Captain permissions stay in
                  place.
                </p>
              </div>
            </section>
          </div>
          {error && (
            <p className="auth-error" role="alert">
              {error}
            </p>
          )}
          <section className="account-list" aria-label="Player access">
            <div className="section-heading">
              <div>
                <span className="eyebrow">MEMBERSHIP</span>
                <h2>Who has access?</h2>
              </div>
            </div>
            <div className="account-list-head" aria-hidden="true">
              <span>Player</span>
              <span>Status</span>
              <span>Access</span>
            </div>
            {!loaded && !error ? (
              <p role="status">Loading accounts…</p>
            ) : (
              players.map((p) => {
                const account = accounts.find((a) => a.playerId === p.id);
                return (
                  <article key={p.id}>
                    <div className="account-identity">
                      <strong>
                        #{p.number} {p.name}
                      </strong>
                      <span>{account?.email || "No account linked"}</span>
                    </div>
                    <span
                      className={`account-status status-${account?.status || "unlinked"}`}
                    >
                      {account?.status === "active"
                        ? "Active"
                        : account?.status === "invited"
                          ? "Invitation ready"
                          : account?.status === "expired"
                            ? "Invitation expired"
                            : "Not invited"}
                      {account?.role === "captain" ? " · Captain" : ""}
                    </span>
                    <div className="account-actions">
                      <button
                        className="text-link"
                        disabled={busy}
                        onClick={() => choose(p.id)}
                      >
                        {account?.status === "active"
                          ? "Recovery link"
                          : "Invite player"}
                      </button>
                      {account?.status &&
                        account.status !== "unlinked" &&
                        account.role !== "captain" && (
                          <button
                            className="text-link revoke-access"
                            disabled={busy}
                            onClick={() => void revoke(p.id)}
                          >
                            Revoke access
                          </button>
                        )}
                    </div>
                  </article>
                );
              })
            )}
          </section>
        </>
      )}
    </div>
  );
}
