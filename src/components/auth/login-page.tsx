"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Mail, ShieldCheck } from "lucide-react";
import { getBrowserClient } from "@/lib/supabase/client";
import { useAuth } from "./auth-provider";
export function LoginPage() {
  const auth = useAuth(),
    router = useRouter(),
    [email, setEmail] = useState(""),
    [code, setCode] = useState(""),
    [sent, setSent] = useState(false),
    [codeMode, setCodeMode] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [cooldown, setCooldown] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!auth.configured || busy) return;
    setBusy(true);
    setError("");
    try {
      const client = getBrowserClient();
      if (!sent) {
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
        router.push("/captain/");
        router.refresh();
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
        <h1>Welcome back, captain.</h1>
        <p>
          Use your invited email. We’ll send a secure sign-in link to get you
          back to the match.
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
        ) : auth.user ? (
          <>
            <p>You’re already signed in.</p>
            <Link className="button" href="/captain/">
              Open captain’s area <ArrowRight size={15} />
            </Link>
          </>
        ) : (
          <form onSubmit={submit}>
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
            {(!sent || codeMode) && (
              <button className="button" disabled={busy}>
                {busy
                  ? "Please wait…"
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
