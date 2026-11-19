import { CaptainAccess } from "@/components/auth/captain-access";
import { CaptainPlayerStats } from "@/components/captain-player-stats";
export const metadata = { title: "Player stats" };
export default function Page() {
  return (
    <CaptainAccess>
      <CaptainPlayerStats />
    </CaptainAccess>
  );
}
