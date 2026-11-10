import type { Metadata } from "next";
import { PrototypeProvider } from "@/components/prototype-provider";
import { SiteShell } from "@/components/site-shell";
import "./globals.css";
import { AuthProvider } from "@/components/auth/auth-provider";
import { configured, liveMode } from "@/lib/supabase/config";
import { readPublicClub } from "@/lib/supabase/repository";
import { connection } from "next/server";
export const metadata: Metadata = {
  title: {
    default: "Mauve FC — Thursday nights. Mauve forever.",
    template: "%s · Mauve FC",
  },
  description:
    "Mauve FC: a Brooklyn football club. Fixtures, results, the squad, and season stats.",
  icons: { icon: "/icon.svg" },
};
export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let bootstrap = null;
  if (liveMode) {
    if (process.env.MAUVE_STATIC_EXPORT !== "true") await connection();
    if (configured)
      try {
        bootstrap = await readPublicClub(
          process.env.MAUVE_STATIC_EXPORT === "true",
        );
      } catch {
        /* Provider presents a retry state. */
      }
  }
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        <AuthProvider>
          <PrototypeProvider bootstrap={bootstrap}>
            <SiteShell>{children}</SiteShell>
          </PrototypeProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
