import { PlayerProfile } from "@/components/season-pages";
import { players } from "@/lib/sample-data";
import { liveMode } from "@/lib/supabase/config";
export function generateStaticParams() {
  if (liveMode)
    return process.env.MAUVE_STATIC_EXPORT === "true"
      ? [{ id: "unavailable" }]
      : [];
  return players.map((p) => ({ id: p.id }));
}
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return { title: players.find((p) => p.id === id)?.name || "Player" };
}
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PlayerProfile id={id} />;
}
