"use client";
import { useEffect, useRef, useState } from "react";
import { Download, ImageDown, Share2, X } from "lucide-react";
import { createLineupImage } from "@/lib/lineup-image";
import type { LineupPayload, Match, Player } from "@/lib/types";
import { useInstall } from "./install-provider";

type ImageInput = {
  match: Match;
  payload: LineupPayload;
  players: Player[];
  label: string;
};
type ImageWriter = {
  write: (data: Blob) => Promise<void>;
  close: () => Promise<void>;
  abort: () => Promise<void>;
};
type SaveWindow = Window & {
  showSaveFilePicker?: (options: {
    suggestedName: string;
    startIn: "pictures";
    types: { description: string; accept: Record<string, string[]> }[];
  }) => Promise<{ createWritable: () => Promise<ImageWriter> }>;
};
function canShareImage(file: File) {
  try {
    return (
      typeof navigator.share === "function" &&
      typeof navigator.canShare === "function" &&
      navigator.canShare({ files: [file] })
    );
  } catch {
    return false;
  }
}
function cancelled(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError"
  );
}

export function LineupExport({ match, payload, players, label }: ImageInput) {
  const { platform } = useInstall();
  const input = JSON.stringify({ match, payload, players, label });
  const [prepared, setPrepared] = useState<{
      input: string;
      file: File;
    } | null>(null),
    [attempt, setAttempt] = useState(0),
    [url, setUrl] = useState(""),
    [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [status, setStatus] = useState("");
  const file = prepared?.input === input ? prepared.file : null;
  const dialog = useRef<HTMLDialogElement>(null),
    returnFocus = useRef<HTMLElement | null>(null);
  // Prepare after changes settle. Native share/save dialogs must be called from
  // the click itself, without awaiting canvas generation and losing activation.
  useEffect(() => {
    let active = true;
    setOpen(false);
    setError("");
    setStatus("");
    const timer = window.setTimeout(async () => {
      try {
        const snapshot = JSON.parse(input) as ImageInput;
        const blob = await createLineupImage(
          snapshot.match,
          snapshot.payload,
          snapshot.players,
          snapshot.label,
        );
        if (active)
          setPrepared({
            input,
            file: new File(
              [blob],
              `mauve-fc-md${snapshot.match.round}-${snapshot.payload.formation}.png`,
              { type: "image/png" },
            ),
          });
      } catch (e) {
        if (active)
          setError(
            e instanceof Error
              ? e.message
              : "The formation image could not be prepared.",
          );
      }
    }, 120);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [input, attempt]);
  useEffect(() => {
    if (!file) {
      setUrl("");
      return;
    }
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  useEffect(() => {
    if (open && file) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open, file]);
  function preview() {
    if (!open)
      returnFocus.current = document.activeElement as HTMLElement | null;
    setOpen(true);
  }
  async function share() {
    if (!file) return;
    setBusy(true);
    setError("");
    setStatus("");
    try {
      // Pass only the PNG so the phone offers image actions such as Save Image.
      await navigator.share({ files: [file] });
    } catch (e) {
      if (!cancelled(e)) {
        setError(
          "Your browser couldn’t open the image menu. You can save the preview below instead.",
        );
        preview();
      }
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (!file || busy) return;
    setError("");
    setStatus("");
    if (platform !== "desktop" && canShareImage(file)) {
      await share();
      return;
    }
    const picker = (window as SaveWindow).showSaveFilePicker;
    if (typeof picker === "function") {
      setBusy(true);
      let writer: ImageWriter | undefined;
      try {
        const handle = await picker.call(window, {
          suggestedName: file.name,
          startIn: "pictures",
          types: [
            { description: "PNG image", accept: { "image/png": [".png"] } },
          ],
        });
        writer = await handle.createWritable();
        await writer.write(file);
        await writer.close();
        setStatus("Image saved.");
      } catch (e) {
        if (writer)
          try {
            await writer.abort();
          } catch {
            /* the writer may already be closed */
          }
        if (!cancelled(e)) {
          setError(
            "The save dialog isn’t available here. You can save the preview below instead.",
          );
          preview();
        }
      } finally {
        setBusy(false);
      }
      return;
    }
    if (canShareImage(file)) {
      await share();
      return;
    }
    preview();
  }
  const shareable = file ? canShareImage(file) : false;
  const nativeSaveAvailable =
    shareable ||
    (file && typeof (window as SaveWindow).showSaveFilePicker === "function");
  const instructions =
    platform === "ios"
      ? shareable
        ? "Tap Save image, then choose Save Image in the iPhone or iPad menu to add it to Photos. You can also touch and hold the preview below."
        : "Touch and hold the preview below, then choose Save Image or Add to Photos when offered by your browser."
      : platform === "android"
        ? shareable
          ? "Tap Save image to choose a photo app from your phone’s image menu. Available destinations depend on your device. You can also touch and hold the preview below."
          : "Touch and hold the preview below to see your browser’s save options. Photo-library destinations depend on your browser and installed apps."
        : "Save image lets you choose a location, starting in Pictures where supported. Otherwise, right-click the preview and choose Save Image As. Import the saved image into Photos if you use a desktop photo library.";
  return (
    <>
      <button
        type="button"
        className="button secondary small"
        disabled={!file || busy}
        onClick={() => void save()}
      >
        <ImageDown size={15} />
        {busy
          ? "Opening save options…"
          : file
            ? "Save image"
            : error
              ? "Image unavailable"
              : "Preparing image…"}
      </button>
      <button
        type="button"
        className="text-link"
        disabled={!file || busy}
        onClick={preview}
      >
        Preview image
      </button>
      {!file && error && (
        <p className="auth-error lineup-image-feedback" role="alert">
          {error}{" "}
          <button
            type="button"
            className="text-link"
            onClick={() => setAttempt((n) => n + 1)}
          >
            Try again
          </button>
        </p>
      )}
      {!open && status && (
        <p className="lineup-image-feedback help-text" role="status">
          {status}
        </p>
      )}
      <dialog
        ref={dialog}
        className="lineup-export-dialog"
        aria-labelledby="lineup-export-title"
        onCancel={() => setOpen(false)}
        onClose={() => {
          setOpen(false);
          returnFocus.current?.focus({ preventScroll: true });
        }}
      >
        <div className="lineup-export-heading">
          <h3 id="lineup-export-title">Save your formation.</h3>
          <button
            type="button"
            className="text-link"
            aria-label="Close image export"
            onClick={() => setOpen(false)}
          >
            <X size={22} />
          </button>
        </div>
        <p className="help-text">{instructions}</p>
        <div className="button-row">
          {nativeSaveAvailable && (
            <button
              type="button"
              className="button small"
              disabled={!file || busy}
              onClick={() => void save()}
            >
              <ImageDown size={15} />
              Save image
            </button>
          )}
          {file && platform === "desktop" && canShareImage(file) && (
            <button
              type="button"
              className="button secondary small"
              disabled={busy}
              onClick={() => void share()}
            >
              <Share2 size={15} />
              Share image
            </button>
          )}
          <a className="text-link" href={url} download={file?.name}>
            <Download size={15} />
            Download PNG
          </a>
        </div>
        {error && (
          <p className="auth-error" role="alert">
            {error}
          </p>
        )}
        {status && (
          <p className="help-text" role="status">
            {status}
          </p>
        )}
        {url && (
          <img
            className="lineup-export-image"
            src={url}
            alt={`${label}: ${payload.formation} formation for Mauve FC versus ${match.opponent}`}
          />
        )}
        <p className="help-text">
          This image includes player names. Your device controls the save
          destination; the site never uploads the image.
        </p>
      </dialog>
    </>
  );
}
