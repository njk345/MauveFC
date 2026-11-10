import { CaptainPage } from "@/components/captain-page";
import { CaptainAccess } from "@/components/auth/captain-access";
export const metadata = { title: "Captain’s area" };
export default function Page() {
  return (
    <CaptainAccess>
      <CaptainPage />
    </CaptainAccess>
  );
}
