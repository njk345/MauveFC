import { formations } from "./formations";
import { formationRows, positionSubstitutes, sheetName } from "./lineup-sheet";
import type { LineupPayload, Match, Player } from "./types";
import { date, time } from "./format";

// Render in the signed-in browser only. Row heights include every position sub.
export async function createLineupImage(
  match: Match,
  payload: LineupPayload,
  players: Player[],
  label: string,
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Image export is unavailable in this browser.");
  const firstNames = payload.firstNamesOnly ?? false;
  const hideNumbers = payload.hideNumbers ?? false;
  const nameTop = hideNumbers ? 36 : 110;
  function wrap(value: string, size: number, width: number) {
    ctx!.font = `600 ${size}px Arial, sans-serif`;
    const lines: string[] = [];
    let line = "";
    for (const word of value.split(/\s+/)) {
      if (ctx!.measureText(line ? `${line} ${word}` : word).width <= width) {
        line = line ? `${line} ${word}` : word;
        continue;
      }
      if (line) {
        lines.push(line);
        line = "";
      }
      for (const char of word) {
        if (ctx!.measureText(line + char).width > width && line) {
          lines.push(line);
          line = "";
        }
        line += char;
      }
    }
    if (line) lines.push(line);
    return lines.length ? lines : [""];
  }
  const rows = formationRows(payload.formation).map((row) => {
    const cells = row.map((slot) => {
      const player = players.find((p) => p.id === payload.starters[slot.index]);
      const nameLines = wrap(
        player ? sheetName(player, firstNames) : "Unassigned",
        24,
        252,
      );
      const nameHeight = Math.max(54, nameLines.length * 30 + 18);
      const subs = positionSubstitutes(payload, slot.index, players).map(
        (sub) => {
          const lines = wrap(sheetName(sub, firstNames), 20, 248);
          return { player: sub, lines, height: 34 + lines.length * 26 };
        },
      );
      const height =
        nameTop +
        nameHeight +
        subs.reduce((sum, sub) => sum + sub.height + 8, 0);
      return { slot, player, nameLines, nameHeight, subs, height };
    });
    return { cells, height: Math.max(...cells.map((cell) => cell.height)) };
  });
  const px = 60,
    py = 260,
    pw = 1080;
  const ph = Math.max(
    hideNumbers ? 780 : 1050,
    rows.reduce((sum, row) => sum + row.height, 0) +
      72 +
      (rows.length - 1) * 40,
  );
  const bench = payload.bench
    .map((id) => players.find((p) => p.id === id))
    .filter((p): p is Player => Boolean(p));
  const benchText =
    bench
      .map((p) => {
        const index = payload.benchPositions?.[p.id];
        return `${hideNumbers ? "" : `#${p.number} `}${sheetName(p, firstNames)}${index !== undefined ? ` (${formations[payload.formation][index].label})` : ""}`;
      })
      .join("  ·  ") || "No substitutes named.";
  const benchLines = wrap(benchText, 24, 1080);
  canvas.height = Math.max(
    hideNumbers ? 1450 : 1720,
    py + ph + 195 + benchLines.length * 36 + 100,
  );
  const text = (
    value: string,
    x: number,
    y: number,
    size: number,
    color: string,
    align: CanvasTextAlign = "left",
  ) => {
    ctx.textAlign = align;
    ctx.fillStyle = color;
    ctx.font = `600 ${size}px Arial, sans-serif`;
    ctx.fillText(value, x, y);
  };
  const box = (
    x: number,
    y: number,
    width: number,
    height: number,
    fill: string,
    radius = 10,
  ) => {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, radius);
    ctx.fill();
  };
  ctx.fillStyle = "#faf8f2";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  text("MAUVE FC", 60, 75, 40, "#38273f");
  text(label.toUpperCase(), 60, 118, 19, "#806481");
  const opponent = `vs ${match.opponent}`;
  let opponentSize = 36;
  ctx.font = `600 ${opponentSize}px Arial, sans-serif`;
  while (ctx.measureText(opponent).width > 1080 && opponentSize > 14) {
    opponentSize--;
    ctx.font = `600 ${opponentSize}px Arial, sans-serif`;
  }
  text(opponent, 60, 180, opponentSize, "#38273f");
  text(
    `MD ${match.round} · ${date(match.kickoff, "long")} · ${time(match.kickoff)}`,
    60,
    222,
    22,
    "#715e74",
  );
  box(px, py, pw, ph, "#44344f", 20);
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
  const rowGap =
    (ph - 72 - rows.reduce((sum, row) => sum + row.height, 0)) /
    (rows.length - 1);
  let top = py + 36;
  for (const row of rows) {
    for (const cell of row.cells) {
      const x = px + (pw * cell.slot.x) / 100;
      text(cell.slot.label, x, top + 20, 20, "#ded5e1", "center");
      if (!hideNumbers) {
        box(x - 31, top + 36, 62, 58, "#e3edb8", 12);
        text(
          String(cell.player?.number ?? "—"),
          x,
          top + 76,
          31,
          "#38273f",
          "center",
        );
      }
      box(
        x - 140,
        top + nameTop,
        280,
        cell.nameHeight,
        hideNumbers ? "#e3edb8" : "#faf8f2",
      );
      cell.nameLines.forEach((line, i) =>
        text(line, x, top + nameTop + 34 + i * 30, 24, "#38273f", "center"),
      );
      let subTop = top + nameTop + cell.nameHeight + 8;
      for (const sub of cell.subs) {
        box(x - 140, subTop, 280, sub.height, "#65516c", 9);
        text(
          hideNumbers ? "SUB" : `SUB · #${sub.player.number}`,
          x,
          subTop + 20,
          14,
          "#e6d8e9",
          "center",
        );
        sub.lines.forEach((line, i) =>
          text(line, x, subTop + 45 + i * 26, 20, "#fff8ff", "center"),
        );
        subTop += sub.height + 8;
      }
    }
    top += row.height + rowGap;
  }
  text(`FORMATION ${payload.formation}`, 60, py + ph + 50, 22, "#806481");
  text("SUBSTITUTES", 60, py + ph + 100, 20, "#806481");
  benchLines.forEach((line, i) =>
    text(line, 60, py + ph + 144 + i * 36, 24, "#38273f"),
  );
  text("TEAM LINEUP · MAUVE FC", 60, canvas.height - 40, 17, "#806481");
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
