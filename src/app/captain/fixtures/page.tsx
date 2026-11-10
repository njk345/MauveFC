import { CaptainAccess } from "@/components/auth/captain-access";
import { FixtureManagement } from "@/components/captain-management";
export const metadata = { title: "Manage fixtures" };
export default function Page() {
  return (
    <CaptainAccess>
      <FixtureManagement />
    </CaptainAccess>
  );
}
