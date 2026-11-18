import sharp from "sharp";
// All artwork fits within the maskable icon's central safe circle.
for (const [name, size] of [
  ["icon-192.png", 192],
  ["icon-512.png", 512],
  ["maskable-512.png", 512],
  ["apple-touch-icon.png", 180],
]) {
  await sharp("public/icons/app-icon.svg")
    .resize(size, size)
    .png()
    .toFile(`public/icons/${name}`);
}
