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
    [loading, setLoading] = useState(configured),
    [error, setError] = useState("");
  useEffect(() => {
    if (!configured) return;
    const client = getBrowserClient();
    let active = true,
      sequence = 0;
    async function check() {
      const current = ++sequence;
      setLoading(true);
      setCaptain(false);
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
          const { data, error } = await client
            .from("club_memberships")
            .select("role")
            .eq("club_id", clubId)
            .eq("user_id", user.id)
            .maybeSingle();
          if (error) throw error;
          if (active && current === sequence)
            setCaptain(data?.role === "captain");
        }
      } catch {
        if (active && current === sequence) {
          setUser(null);
          setCaptain(false);
          setError("We could not verify your session. Please sign in again.");
        }
      } finally {
        if (active && current === sequence) setLoading(false);
      }
    }
    void check();
    const {
      data: { subscription },
    } = client.auth.onAuthStateChange(() => {
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
  }
  return (
    <Context.Provider
      value={{
        user,
        captain,
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
