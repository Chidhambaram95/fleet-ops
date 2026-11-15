import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    // Server logs must not carry user or company ids. Errors may be logged.
    files: ["src/**/*.{ts,tsx}"],
    rules: { "no-console": ["error", { allow: ["error", "warn"] }] },
  },
];

export default eslintConfig;
