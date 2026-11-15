"use client";
import { useEffect, useRef, useState } from "react";
import { Download, Share2, X } from "lucide-react";
import { createLineupImage } from "@/lib/lineup-image";
import type { LineupPayload, Match, Player } from "@/lib/types";

export function LineupExport({
  match,
  payload,
  players,
  label,
}: {
  match: Match;
  payload: LineupPayload;
  players: Player[];
  label: string;
}) {
  const [file, setFile] = useState<File | null>(null),
    [url, setUrl] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!file) return;
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    dialog.current?.showModal();
    return () => {
      URL.revokeObjectURL(objectUrl);
      dialog.current?.close();
    };
  }, [file]);
  async function prepare() {
    setBusy(true);
    setError("");
    try {
      const blob = await createLineupImage(match, payload, players, label);
      setFile(
        new File([blob], `mauve-fc-md${match.round}-${payload.formation}.png`, {
          type: "image/png",
        }),
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not export this lineup.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function share() {
    if (!file) return;
    try {
      await navigator.share({ files: [file], title: "Mauve FC lineup" });
    } catch (e) {
      if (!(e instanceof Error && e.name === "AbortError"))
        setError(
          "Sharing is unavailable here. Use Download PNG or save the image below.",
        );
    }
  }
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="button secondary small"
        disabled={busy}
        onClick={() => void prepare()}
      >
        <Download size={15} />
        {busy ? "Creating image…" : "Export image"}
      </button>
      {!file && error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}
      <dialog
        ref={dialog}
        className="lineup-export-dialog"
        aria-labelledby="lineup-export-title"
        onCancel={() => setFile(null)}
        onClose={() => trigger.current?.focus({ preventScroll: true })}
      >
        <div className="lineup-export-heading">
          <h3 id="lineup-export-title">Your formation image.</h3>
          <button
            type="button"
            className="text-link"
            aria-label="Close image export"
            onClick={() => setFile(null)}
          >
            <X size={22} />
          </button>
        </div>
        <p className="help-text">
          This image includes player names. On mobile, touch and hold it to save
          to Photos, or use Share image.
        </p>
        <div className="button-row">
          <a className="button small" href={url} download={file?.name}>
            <Download size={15} />
            Download PNG
          </a>
          {file &&
            typeof navigator.canShare === "function" &&
            navigator.canShare({ files: [file] }) && (
              <button
                type="button"
                className="button secondary small"
                onClick={() => void share()}
              >
                <Share2 size={15} />
                Share image
              </button>
            )}
        </div>
        {error && (
          <p className="auth-error" role="alert">
            {error}
          </p>
        )}
        {url && (
          <img
            className="lineup-export-image"
            src={url}
            alt={`${label}: ${payload.formation} formation for Mauve FC versus ${match.opponent}`}
          />
        )}
      </dialog>
    </>
  );
}
