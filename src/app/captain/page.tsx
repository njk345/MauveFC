import { CaptainPage } from "@/components/captain-page";
import { CaptainAccess } from "@/components/auth/captain-access";
import { Suspense } from "react";
export const metadata = { title: "Captain’s area" };
export default function Page() {
  return (
    <CaptainAccess>
      <Suspense fallback={<p role="status">Loading result editor…</p>}>
        <CaptainPage />
      </Suspense>
    </CaptainAccess>
  );
}
