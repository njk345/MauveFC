"use client";
import { useEffect, useState } from "react";
import { PlayerProfile } from "@/components/season-pages";
export default function Page() {
  const [id, setId] = useState("");
  useEffect(
    () => setId(new URLSearchParams(window.location.search).get("id") || ""),
    [],
  );
  return id ? (
    <PlayerProfile id={id} />
  ) : (
    <div className="section page-section" role="status">
      Loading player…
    </div>
  );
}
