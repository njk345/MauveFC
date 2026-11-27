"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { User } from "@supabase/supabase-js";
import { getBrowserClient } from "@/lib/supabase/client";
import { clubId, configured, liveMode } from "@/lib/supabase/config";
type Auth = {
  user: User | null;
  captain: boolean;
  member: boolean;
  playerId: string | null;
  passwordSetup: boolean;
  startPasswordSetup: () => void;
  finishPasswordSetup: () => void;
  refreshAccess: () => Promise<void>;
  loading: boolean;
  error: string;
  live: boolean;
  configured: boolean;
  signOut: () => Promise<void>;
};
const Context = createContext<Auth | null>(null);
type VerifiedAccess = Pick<Auth, "captain" | "member" | "playerId"> & {
  user: User;
};

function isTemporaryFailure(status: number) {
  return status === 0 || status === 429 || status >= 500;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [access, setAccess] = useState<VerifiedAccess | null>(null),
    [passwordSetup, setPasswordSetup] = useState(false),
    [loading, setLoading] = useState(configured),
    [error, setError] = useState("");
  const checkAccess = useRef<(() => Promise<void>) | null>(null);
  const refreshAccess = useCallback(async () => {
    if (!checkAccess.current)
      throw new Error("Team access could not be verified.");
    await checkAccess.current();
  }, []);
  useEffect(() => {
    if (!configured) return;
    const callbackType = new URLSearchParams(window.location.hash.slice(1)).get(
      "type",
    );
    if (
      ["invite", "recovery"].includes(callbackType || "") &&
      !new URLSearchParams(window.location.hash.slice(1)).has("token_hash")
    )
      setPasswordSetup(true);
    const client = getBrowserClient();
    let active = true,
      sequence = 0;
    let verifiedUserId: string | undefined;
    let pendingCheck: ReturnType<typeof setTimeout> | undefined;
    function clearAccess() {
      verifiedUserId = undefined;
      setAccess(null);
    }
    async function check() {
      clearTimeout(pendingCheck);
      const current = ++sequence;
      let temporaryFailure = false;
      try {
        const {
          data: { user },
          error: authError,
        } = await client.auth.getUser();
        if (!active || current !== sequence) return;
        if (authError && authError.name !== "AuthSessionMissingError") {
          temporaryFailure =
            authError.name === "AuthRetryableFetchError" ||
            isTemporaryFailure(authError.status ?? 400);
          throw authError;
        }
        if (!user) {
          clearAccess();
          setError("");
          return;
        }
        if (user.id !== verifiedUserId) {
          clearAccess();
          setLoading(true);
        }
        const {
          data,
          error: accessError,
          status,
        } = await client.rpc("get_team_access", {
          p_club_id: clubId,
        });
        if (!active || current !== sequence) return;
        if (accessError) {
          temporaryFailure = isTemporaryFailure(status);
          throw accessError;
        }
        verifiedUserId = user.id;
        setAccess({
          user,
          captain: data?.role === "captain",
          member: Boolean(data?.member),
          playerId: data?.playerId || null,
        });
        setError("");
      } catch {
        if (!active || current !== sequence) return;
        // Keep the current workspace through a network interruption for the
        // same verified account. The backend still authorizes each request.
        if (!temporaryFailure || !verifiedUserId) {
          clearAccess();
          setError("We could not verify your session. Please sign in again.");
        }
        throw new Error("Team access could not be verified.");
      } finally {
        if (active && current === sequence) setLoading(false);
      }
    }
    checkAccess.current = check;
    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      clearTimeout(pendingCheck);
      sequence++;
      if (!session) {
        clearAccess();
        setLoading(false);
        setError("");
        if (event === "SIGNED_OUT") setPasswordSetup(false);
        return;
      }
      if (session.user.id !== verifiedUserId) {
        clearAccess();
        setLoading(true);
      }
      if (event === "PASSWORD_RECOVERY") setPasswordSetup(true);
      // SIGNED_IN also fires when a tab regains focus. Recheck access without
      // returning an already verified user to the initial loading screen.
      pendingCheck = setTimeout(() => {
        if (active) void check().catch(() => {});
      }, 0);
    });
    return () => {
      active = false;
      clearTimeout(pendingCheck);
      checkAccess.current = null;
      subscription.unsubscribe();
    };
  }, []);
  async function signOut() {
    const { error } = await getBrowserClient().auth.signOut();
    if (error) throw new Error("Could not sign out. Please try again.");
  }
  return (
    <Context.Provider
      value={{
        user: access?.user ?? null,
        captain: access?.captain ?? false,
        member: access?.member ?? false,
        playerId: access?.playerId ?? null,
        passwordSetup,
        startPasswordSetup: () => setPasswordSetup(true),
        finishPasswordSetup: () => setPasswordSetup(false),
        refreshAccess,
        loading,
        error,
        live: liveMode,
        configured,
        signOut,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useAuth() {
  const auth = useContext(Context);
  if (!auth) throw new Error("Auth provider missing");
  return auth;
}
