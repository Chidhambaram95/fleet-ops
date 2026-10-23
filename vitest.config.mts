import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = (path: string) => fileURLToPath(new URL(`./src/${path}`, import.meta.url));

// Unit tests for the pure rules in src/domain. Run with `npm test` when asked;
// they are not part of the build or of any automatic check.
export default defineConfig({
  resolve: {
    alias: {
      "@domain": src("domain"),
      "@data": src("data"),
      "@": src(""),
    },
  },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
  },
});
