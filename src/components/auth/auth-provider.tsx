"use client";
import {
  createContext,
  useContext,
  useEffect,
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
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null),
    [captain, setCaptain] = useState(false),
    [member, setMember] = useState(false),
    [playerId, setPlayerId] = useState<string | null>(null),
    [passwordSetup, setPasswordSetup] = useState(false),
    [loading, setLoading] = useState(configured),
    [error, setError] = useState("");
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
    async function check() {
      const current = ++sequence;
      setLoading(true);
      setCaptain(false);
      setMember(false);
      setPlayerId(null);
      setError("");
      try {
        const {
          data: { user },
          error: authError,
        } = await client.auth.getUser();
        if (!active || current !== sequence) return;
        if (authError && authError.name !== "AuthSessionMissingError")
          throw authError;
        setUser(user);
        if (user) {
          const { data, error } = await client.rpc("get_team_access", {
            p_club_id: clubId,
          });
          if (error) throw error;
          if (active && current === sequence) {
            setCaptain(data?.role === "captain");
            setMember(Boolean(data?.member));
            setPlayerId(data?.playerId || null);
          }
        }
      } catch {
        if (active && current === sequence) {
          setUser(null);
          setCaptain(false);
          setMember(false);
          setPlayerId(null);
          setError("We could not verify your session. Please sign in again.");
        }
      } finally {
        if (active && current === sequence) setLoading(false);
      }
    }
    void check();
    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setPasswordSetup(true);
      setTimeout(() => {
        if (active) void check();
      }, 0);
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);
  async function signOut() {
    const { error } = await getBrowserClient().auth.signOut();
    if (error) throw new Error("Could not sign out. Please try again.");
    setUser(null);
    setCaptain(false);
    setMember(false);
    setPlayerId(null);
    setPasswordSetup(false);
  }
  async function refreshAccess() {
    const { data, error } = await getBrowserClient().rpc("get_team_access", {
      p_club_id: clubId,
    });
    if (error) throw new Error("Team access could not be verified.");
    setMember(Boolean(data?.member));
    setCaptain(data?.role === "captain");
    setPlayerId(data?.playerId || null);
  }
  return (
    <Context.Provider
      value={{
        user,
        captain,
        member,
        playerId,
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
