import type { NextConfig } from "next";
const config: NextConfig = {
  distDir:process.env.MAUVE_BUILD_DIR||".next",
  output: process.env.MAUVE_STATIC_EXPORT === "true" ? "export" : undefined,
  trailingSlash: true,
  images: { unoptimized: true },
};
export default config;
