import { CaptainAccess } from "@/components/auth/captain-access";
import { RosterManagement } from "@/components/captain-management";
export const metadata = { title: "Manage roster" };
export default function Page() {
  return (
    <CaptainAccess>
      <RosterManagement />
    </CaptainAccess>
  );
}
