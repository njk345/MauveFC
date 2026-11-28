"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Mail, ShieldCheck } from "lucide-react";
import { getBrowserClient } from "@/lib/supabase/client";
import { useAuth } from "./auth-provider";
import { clubId } from "@/lib/supabase/config";
import { matchdayHref } from "@/lib/matchday-link";
export function LoginPage() {
  const auth = useAuth(),
    router = useRouter(),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [confirmPassword, setConfirmPassword] = useState(""),
    [mode, setMode] = useState<"password" | "link">("password"),
    [invitation, setInvitation] = useState<{
      token_hash: string;
      type: "invite" | "recovery";
    } | null>(null),
    [matchdayPath, setMatchdayPath] = useState<string>(),
    [code, setCode] = useState(""),
    [sent, setSent] = useState(false),
    [codeMode, setCodeMode] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [cooldown, setCooldown] = useState(false);
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const match = query.get("match");
    if (match) setMatchdayPath(matchdayHref(match, query.get("view") === "report"));
    const params = new URLSearchParams(window.location.hash.slice(1)),
      token_hash = params.get("token_hash"),
      type = params.get("type");
    if (token_hash && (type === "invite" || type === "recovery"))
      setInvitation({ token_hash, type });
    else if (params.has("error_description")) {
      setError(
        "That sign-in link is invalid or expired. Ask your captain for a new link.",
      );
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);
  async function openWorkspace() {
    const { data, error } = await getBrowserClient().rpc("get_team_access", {
      p_club_id: clubId,
    });
    if (error)
      throw new Error(
        "Your account signed in, but team access could not be checked. Try again.",
      );
    router.push(matchdayPath ?? (data?.role === "captain" ? "/captain/" : "/team/"));
    router.refresh();
  }
  async function acceptInvitation() {
    if (!invitation) return;
    setBusy(true);
    setError("");
    auth.startPasswordSetup();
    window.history.replaceState({}, "", window.location.pathname);
    try {
      const { error } = await getBrowserClient().auth.verifyOtp(invitation);
      if (error)
        throw new Error(
          "That link is invalid or expired. Ask your captain for a new invitation.",
        );
      setInvitation(null);
      setPassword("");
    } catch (e) {
      auth.finishPasswordSetup();
      setError(e instanceof Error ? e.message : "Could not accept invitation.");
    } finally {
      setBusy(false);
    }
  }
  async function setAccountPassword(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password !== confirmPassword) {
      setError("The passwords do not match.");
      return;
    }
    if (password.length < 10) {
      setError("Use at least 10 characters.");
      return;
    }
    setBusy(true);
    try {
      const { error } = await getBrowserClient().auth.updateUser({ password });
      if (error)
        throw new Error(
          "Your password could not be saved. Choose a stronger password or ask your captain for a new link.",
        );
      await auth.refreshAccess();
      auth.finishPasswordSetup();
      setPassword("");
      setConfirmPassword("");
      router.push(matchdayPath ?? "/team/");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save password.");
    } finally {
      setBusy(false);
    }
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!auth.configured || busy) return;
    setBusy(true);
    setError("");
    try {
      const client = getBrowserClient();
      if (mode === "password") {
        const { error } = await client.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error)
          throw new Error(
            "That email and password could not be verified. Check them or ask your captain for an account recovery link.",
          );
        setPassword("");
        await openWorkspace();
      } else if (!sent) {
        const { error } = await client.auth.signInWithOtp({
          email: email.trim(),
          options: {
            shouldCreateUser: false,
            emailRedirectTo: window.location.origin + "/login/",
          },
        });
        if (error)
          throw new Error(
            "We couldn’t send the sign-in email. Check your invited email and try again.",
          );
        setSent(true);
        setCooldown(true);
        setTimeout(() => setCooldown(false), 60000);
      } else {
        const { error } = await client.auth.verifyOtp({
          email: email.trim(),
          token: code.trim(),
          type: "email",
        });
        if (error)
          throw new Error(
            "That code is invalid or expired. Please check it or request a new one.",
          );
        await openWorkspace();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="section page-section login-page">
      <section className="access-panel">
        <ShieldCheck size={30} />
        <span className="eyebrow">PRIVATE TEAM TOOLS</span>
        <h1>
          {invitation
            ? "Your place in the squad."
            : auth.passwordSetup && auth.user
              ? "Set your password."
              : "Welcome to the club."}
        </h1>
        <p>
          {invitation
            ? "Accept your captain’s private invitation, then choose a password."
            : auth.passwordSetup && auth.user
              ? "Choose a password for future team sign-ins."
              : "Sign in to see the private roster, match availability and shared lineups."}
        </p>
        {!auth.configured ? (
          <div className="connection-note">
            <strong>Live sign-in is being connected.</strong>
            <p>
              {auth.live
                ? "Please check back shortly."
                : "The club preview currently uses sample data. You can explore the sample captain tools while live sign-in is set up."}
            </p>
            {!auth.live && (
              <Link className="button" href="/captain/">
                Explore sample workspace <ArrowRight size={15} />
              </Link>
            )}
          </div>
        ) : invitation ? (
          <div>
            <p className="help-text">
              This link signs in its intended player. Keep it private.
            </p>
            {error && (
              <p className="auth-error" role="alert">
                {error}
              </p>
            )}
            <button
              className="button"
              disabled={busy}
              onClick={() => void acceptInvitation()}
            >
              {busy
                ? "Accepting…"
                : invitation.type === "recovery"
                  ? "Continue account setup"
                  : "Accept invitation"}
              <ArrowRight size={15} />
            </button>
          </div>
        ) : auth.passwordSetup && auth.user ? (
          <form onSubmit={setAccountPassword}>
            <p className="help-text">Signed in as {auth.user.email}</p>
            <label className="form-field">
              <span>New password</span>
              <input
                required
                type="password"
                minLength={10}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <label className="form-field">
              <span>Confirm password</span>
              <input
                required
                type="password"
                minLength={10}
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </label>
            {error && (
              <p className="auth-error" role="alert">
                {error}
              </p>
            )}
            <button className="button" disabled={busy}>
              {busy ? "Saving…" : "Save password & open team"}
              <ArrowRight size={15} />
            </button>
          </form>
        ) : auth.user ? (
          <>
            <p>You’re already signed in.</p>
            <Link className="button" href={matchdayPath ?? "/team/"}>
              {matchdayPath ? "Open matchday hub" : "Open team area"} <ArrowRight size={15} />
            </Link>
            {auth.captain && (
              <Link className="text-link" href="/captain/">
                Open captain’s area <ArrowRight size={15} />
              </Link>
            )}
            <button
              className="text-link"
              onClick={() =>
                void auth.signOut().catch((e) => setError(e.message))
              }
            >
              Sign out
            </button>
          </>
        ) : (
          <form onSubmit={submit}>
            <div className="tabs auth-tabs" aria-label="Sign-in method">
              {(
                [
                  ["password", "Password"],
                  ["link", "Email link"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={mode === id ? "selected" : ""}
                  aria-pressed={mode === id}
                  onClick={() => {
                    setMode(id);
                    setSent(false);
                    setError("");
                    setCodeMode(false);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <label className="form-field">
              <span>Invited email</span>
              <input
                required
                type="email"
                autoComplete="email"
                value={email}
                readOnly={sent}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </label>
            {mode === "password" && (
              <label className="form-field">
                <span>Password</span>
                <input
                  required
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
            )}
            {mode === "password" && (
              <p className="help-text">
                New player? Open your captain’s invitation first. For a
                forgotten password, ask your captain for a recovery link.
              </p>
            )}
            {sent && (
              <>
                <p className="help-text" role="status">
                  If this email has an account, a sign-in email is on its way.
                  Open the link in your inbox to continue.
                </p>
                {codeMode ? (
                  <label className="form-field">
                    <span>Email code</span>
                    <input
                      required
                      autoFocus
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      pattern="[0-9]{6,10}"
                      minLength={6}
                      maxLength={10}
                      value={code}
                      onChange={(e) =>
                        setCode(e.target.value.replace(/\D/g, ""))
                      }
                    />
                  </label>
                ) : (
                  <button
                    className="text-link"
                    type="button"
                    onClick={() => setCodeMode(true)}
                  >
                    Use a sign-in code instead
                  </button>
                )}
              </>
            )}
            {error && (
              <p role="alert" className="auth-error">
                {error}
              </p>
            )}
            {(mode === "password" || !sent || codeMode) && (
              <button className="button" disabled={busy}>
                {busy
                  ? "Please wait…"
                  : mode === "password"
                    ? "Sign in"
                    : sent
                      ? "Verify & sign in"
                      : "Send sign-in link"}
                <Mail size={15} />
              </button>
            )}
            {sent && (
              <button
                disabled={busy || cooldown}
                className="text-link"
                type="button"
                onClick={() => {
                  setSent(false);
                  setCodeMode(false);
                  setCode("");
                  setError("");
                }}
              >
                Use another email or request another link
                {cooldown ? " (available in one minute)" : ""}
              </button>
            )}
          </form>
        )}
        <Link className="text-link" href="/">
          Back to the club <ArrowRight size={14} />
        </Link>
      </section>
    </div>
  );
}
