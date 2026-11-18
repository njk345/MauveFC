"use client";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};
export type InstallPlatform = "ios" | "android" | "desktop";
type InstallState = {
  installed: boolean;
  platform: InstallPlatform;
  available: boolean;
  busy: boolean;
  message: string;
  install: () => Promise<void>;
};
const Context = createContext<InstallState | null>(null);

export function InstallProvider({ children }: { children: ReactNode }) {
  const [installed, setInstalled] = useState(false),
    [platform, setPlatform] = useState<InstallPlatform>("desktop"),
    [prompt, setPrompt] = useState<InstallEvent | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  useEffect(() => {
    const mode = window.matchMedia("(display-mode: standalone)");
    const checkMode = () =>
      setInstalled(
        mode.matches ||
          (navigator as Navigator & { standalone?: boolean }).standalone ===
            true,
      );
    checkMode();
    const ua = navigator.userAgent;
    setPlatform(
      /iPad|iPhone|iPod/.test(ua) ||
        (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
        ? "ios"
        : /Android/.test(ua)
          ? "android"
          : "desktop",
    );
    const ready = (event: Event) => {
      event.preventDefault();
      setPrompt(event as InstallEvent);
      setMessage("");
    };
    const complete = () => {
      setInstalled(true);
      setPrompt(null);
      setMessage(
        "Mauve FC is installed. Open it from your home screen or apps.",
      );
    };
    window.addEventListener("beforeinstallprompt", ready);
    window.addEventListener("appinstalled", complete);
    mode.addEventListener("change", checkMode);
    return () => {
      window.removeEventListener("beforeinstallprompt", ready);
      window.removeEventListener("appinstalled", complete);
      mode.removeEventListener("change", checkMode);
    };
  }, []);
  async function install() {
    if (!prompt || busy) return;
    setBusy(true);
    setMessage("");
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      setMessage(
        choice.outcome === "accepted"
          ? "Installation requested. Your browser will finish adding Mauve FC."
          : "No problem. You can add Mauve FC later from your browser menu.",
      );
    } catch {
      setMessage(
        "Use the browser steps below to add Mauve FC to your home screen.",
      );
    } finally {
      // An install event can be used once. A later browser event enables retry.
      setPrompt(null);
      setBusy(false);
    }
  }
  return (
    <Context.Provider
      value={{
        installed,
        platform,
        available: Boolean(prompt) && !installed,
        busy,
        message,
        install,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useInstall() {
  const context = useContext(Context);
  if (!context) throw new Error("InstallProvider is missing.");
  return context;
}
