import { CaptainAccess } from "@/components/auth/captain-access";
import { PlayerAccounts } from "@/components/player-accounts";
export default function Page() {
  return (
    <CaptainAccess>
      <PlayerAccounts />
    </CaptainAccess>
  );
}
