import { formations } from "./formations";
import type { LineupPayload, Match, Player } from "./types";
import { date, time } from "./format";

// Render only in the signed-in browser. No player information is uploaded.
export async function createLineupImage(
  match: Match,
  payload: LineupPayload,
  players: Player[],
  label: string,
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 1720;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Image export is unavailable in this browser.");
  const text = (
    value: string,
    x: number,
    y: number,
    size: number,
    color: string,
    maxWidth: number,
    align: CanvasTextAlign = "left",
  ) => {
    ctx.textAlign = align;
    ctx.fillStyle = color;
    ctx.font = `600 ${size}px Arial, sans-serif`;
    while (ctx.measureText(value).width > maxWidth && size > 14) {
      size--;
      ctx.font = `600 ${size}px Arial, sans-serif`;
    }
    ctx.fillText(value, x, y, maxWidth);
  };
  ctx.fillStyle = "#faf8f2";
  ctx.fillRect(0, 0, 1200, 1720);
  text("MAUVE FC", 60, 75, 40, "#38273f", 1080);
  text(label.toUpperCase(), 60, 118, 19, "#806481", 1080);
  text(`vs ${match.opponent}`, 60, 180, 36, "#38273f", 1080);
  text(
    `MD ${match.round} · ${date(match.kickoff, "long")} · ${time(match.kickoff)}`,
    60,
    222,
    22,
    "#715e74",
    1080,
  );
  const px = 60,
    py = 260,
    pw = 1080,
    ph = 1050;
  ctx.fillStyle = "#44344f";
  ctx.beginPath();
  ctx.roundRect(px, py, pw, ph, 20);
  ctx.fill();
  ctx.strokeStyle = "#b8a9bc";
  ctx.lineWidth = 2;
  ctx.strokeRect(px + 24, py + 24, pw - 48, ph - 48);
  ctx.beginPath();
  ctx.moveTo(px + 24, py + ph / 2);
  ctx.lineTo(px + pw - 24, py + ph / 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(px + pw / 2, py + ph / 2, 115, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeRect(px + pw * 0.25, py + 24, pw * 0.5, 120);
  ctx.strokeRect(px + pw * 0.25, py + ph - 144, pw * 0.5, 120);
  formations[payload.formation].forEach((slot, i) => {
    const x = px + (pw * slot.x) / 100,
      y = py + (ph * slot.y) / 100;
    const player = players.find((p) => p.id === payload.starters[i]);
    text(slot.label, x, y - 58, 20, "#ded5e1", 260, "center");
    ctx.fillStyle = "#e3edb8";
    ctx.beginPath();
    ctx.roundRect(x - 31, y - 40, 62, 58, 12);
    ctx.fill();
    text(String(player?.number ?? "—"), x, y + 1, 31, "#38273f", 55, "center");
    ctx.fillStyle = "#faf8f2";
    ctx.beginPath();
    ctx.roundRect(x - 140, y + 29, 280, 54, 10);
    ctx.fill();
    text(player?.name || "Unassigned", x, y + 64, 24, "#38273f", 258, "center");
  });
  text(`FORMATION ${payload.formation}`, 60, 1360, 22, "#806481", 1080);
  text("SUBSTITUTES", 60, 1410, 20, "#806481", 1080);
  const names = payload.bench
    .map((id) => players.find((p) => p.id === id))
    .filter((p): p is Player => Boolean(p))
    .map((p) => `#${p.number} ${p.name}`);
  // Wrap a full bench without cropping longer names or overflowing the image.
  let row = "",
    y = 1454;
  ctx.font = "600 24px Arial, sans-serif";
  const lines: string[] = [];
  for (const name of names) {
    const next = row ? `${row}  ·  ${name}` : name;
    if (ctx.measureText(next).width > 1080 && row) {
      lines.push(row);
      row = name;
    } else row = next;
  }
  lines.push(row || "No substitutes named.");
  const lineHeight = Math.min(38, 180 / lines.length);
  lines.forEach((line) => {
    text(line, 60, y, Math.min(24, lineHeight - 3), "#38273f", 1080);
    y += lineHeight;
  });
  text("TEAM LINEUP · MAUVE FC", 60, 1680, 17, "#806481", 1080);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error("The formation image could not be created.")),
      "image/png",
    ),
  );
}
