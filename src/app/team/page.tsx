import { TeamPage } from "@/components/team-page";
import { Suspense } from "react";
export const metadata = { title: "Matchday hub" };
export default function Page() {
  return (
    <Suspense fallback={<p className="section page-section" role="status">Loading the dressing room…</p>}>
      <TeamPage />
    </Suspense>
  );
}
