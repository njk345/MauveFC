import { CaptainAccess } from "@/components/auth/captain-access";
import { CaptainSeason } from "@/components/captain-season";

export const metadata = { title: "Season settings" };
export default function Page() {
  return <CaptainAccess><CaptainSeason /></CaptainAccess>;
}
